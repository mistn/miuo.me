const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 2000;
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
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;

  const formData = new FormData();
  formData.append("secret", env.TURNSTILE_SECRET_KEY);
  formData.append("response", token);

  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) formData.append("remoteip", remoteIp);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData,
    },
  );
  const result = await response.json();

  return Boolean(result.success);
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

  const human = await verifyTurnstile(request, env, turnstileToken);
  if (!human) {
    return json({ message: "Please complete the verification." }, 400);
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

    if (url.pathname === "/api/message") {
      return handleMessage(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
