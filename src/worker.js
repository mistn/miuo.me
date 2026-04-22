const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_DAY_SECONDS = 24 * 60 * 60;
const RATE_LIMIT_WINDOW_MAX = 3;
const RATE_LIMIT_DAY_MAX = 20;
const DUPLICATE_TTL_SECONDS = 24 * 60 * 60;
const ALLOWED_HOSTS = new Set(["miuo.me", "www.miuo.me"]);
const SUCCESS_MESSAGE = "Thanks, your message was sent.";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function turnstileSiteKey(env) {
  return (
    env.PUBLIC_TURNSTILE_SITE_KEY ||
    env.TURNSTILE_SITE_KEY ||
    env.CF_TURNSTILE_SITE_KEY ||
    ""
  ).trim();
}

function turnstileSecretKey(env) {
  return (env.TURNSTILE_SECRET_KEY || "").trim();
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function sameSiteRequest(request) {
  const url = new URL(request.url);
  if (!ALLOWED_HOSTS.has(url.hostname)) return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === "https:" && ALLOWED_HOSTS.has(originUrl.hostname);
  } catch {
    return false;
  }
}

async function verifyTurnstile(request, env, token) {
  const secretKey = turnstileSecretKey(env);

  if (!secretKey) {
    return {
      ok: false,
      status: 503,
      message: "Message protection is not configured yet.",
    };
  }

  if (!token) {
    return {
      ok: false,
      status: 400,
      message: "Please complete the verification.",
    };
  }

  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);

  const remoteIp = clientIp(request);
  if (remoteIp) formData.append("remoteip", remoteIp);

  let result;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      },
    );
    if (!response.ok) throw new Error("Turnstile verification failed.");
    result = await response.json();
  } catch {
    return {
      ok: false,
      status: 503,
      message: "Message verification is temporarily unavailable.",
    };
  }

  if (!result.success) {
    return {
      ok: false,
      status: 400,
      message: "Please complete the verification.",
    };
  }

  if (result.hostname && !ALLOWED_HOSTS.has(result.hostname)) {
    return {
      ok: false,
      status: 403,
      message: "Forbidden.",
    };
  }

  return { ok: true };
}

async function getCounter(namespace, key) {
  const value = await namespace.get(key);
  return Number.parseInt(value || "0", 10) || 0;
}

async function incrementCounter(namespace, key, ttl) {
  const current = await getCounter(namespace, key);
  await namespace.put(String(key), String(current + 1), {
    expirationTtl: ttl,
  });
  return current + 1;
}

async function rateLimit(request, env, payload) {
  if (!env.MESSAGE_RATE_LIMIT) {
    return {
      ok: false,
      status: 503,
      message: "Message rate limiting is not configured yet.",
    };
  }

  const ipHash = await sha256(clientIp(request));
  const contentHash = await sha256(
    `${payload.email.toLowerCase()}:${payload.message.toLowerCase()}`,
  );
  const windowKey = `rl:${ipHash}:10m`;
  const dayKey = `rl:${ipHash}:24h`;
  const duplicateKey = `dup:${ipHash}:${contentHash}`;

  const [windowCount, dayCount, duplicate] = await Promise.all([
    getCounter(env.MESSAGE_RATE_LIMIT, windowKey),
    getCounter(env.MESSAGE_RATE_LIMIT, dayKey),
    env.MESSAGE_RATE_LIMIT.get(duplicateKey),
  ]);

  if (
    windowCount >= RATE_LIMIT_WINDOW_MAX ||
    dayCount >= RATE_LIMIT_DAY_MAX ||
    duplicate
  ) {
    return { ok: false, silent: true };
  }

  await Promise.all([
    incrementCounter(env.MESSAGE_RATE_LIMIT, windowKey, RATE_LIMIT_WINDOW_SECONDS),
    incrementCounter(env.MESSAGE_RATE_LIMIT, dayKey, RATE_LIMIT_DAY_SECONDS),
    env.MESSAGE_RATE_LIMIT.put(duplicateKey, "1", {
      expirationTtl: DUPLICATE_TTL_SECONDS,
    }),
  ]);

  return { ok: true };
}

async function sendEmail(env, payload) {
  if (!env.RESEND_API_KEY || !env.MESSAGE_TO || !env.MESSAGE_FROM) {
    return {
      ok: false,
      status: 503,
      message: "Message delivery is not configured yet.",
    };
  }

  const subjectName = payload.name || payload.email;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MESSAGE_FROM,
      to: [env.MESSAGE_TO],
      reply_to: payload.email,
      subject: `New homepage message from ${subjectName}`,
      text: [
        `Name: ${payload.name || "Anonymous"}`,
        `Email: ${payload.email}`,
        "",
        payload.message,
      ].join("\n"),
    }),
  });

  if (response.ok) return { ok: true };

  return {
    ok: false,
    status: 502,
    message: "Message delivery failed. Please try again later.",
  };
}

async function handleMessage(request, env) {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  if (!sameSiteRequest(request)) {
    return json({ message: "Forbidden." }, 403);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return json({ message: "Expected a JSON request." }, 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Invalid message body." }, 400);
  }

  if (cleanString(body.website)) {
    return json({ message: SUCCESS_MESSAGE });
  }

  const name = cleanString(body.name).slice(0, MAX_NAME_LENGTH);
  const email = cleanString(body.email).slice(0, MAX_EMAIL_LENGTH);
  const message = cleanString(body.message).slice(0, MAX_MESSAGE_LENGTH);
  const turnstileToken = cleanString(body.turnstileToken);

  if (!validEmail(email)) {
    return json({ message: "Please enter a valid email address." }, 400);
  }

  if (message.length < 2) {
    return json({ message: "Please write a message first." }, 400);
  }

  const verification = await verifyTurnstile(request, env, turnstileToken);
  if (!verification.ok) {
    return json({ message: verification.message }, verification.status);
  }

  const limit = await rateLimit(request, env, { email, message });
  if (!limit.ok) {
    if (limit.silent) return json({ message: SUCCESS_MESSAGE });
    return json({ message: limit.message }, limit.status);
  }

  const delivery = await sendEmail(env, { name, email, message });
  if (!delivery.ok) {
    return json({ message: delivery.message }, delivery.status);
  }

  return json({ message: SUCCESS_MESSAGE });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return json({
        turnstileSiteKey: turnstileSiteKey(env),
        configured: {
          turnstileSiteKey: Boolean(turnstileSiteKey(env)),
          turnstileSecret: Boolean(turnstileSecretKey(env)),
          rateLimit: Boolean(env.MESSAGE_RATE_LIMIT),
        },
      });
    }

    if (url.pathname === "/api/message") {
      return handleMessage(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
