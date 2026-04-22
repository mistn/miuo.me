# Cloudflare Workers Deploy

This site deploys as Cloudflare Workers Static Assets with a small Worker API for
the message form.

## One-time setup

```sh
pnpm install
pnpm exec wrangler login
```

Create a Resend API key, then set the Worker secrets:

```sh
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put MESSAGE_FROM
pnpm exec wrangler secret put MESSAGE_TO
```

Use these values:

```txt
MESSAGE_FROM=hi@miuo.me
MESSAGE_TO=your-email@example.com
```

`MESSAGE_TO` is stored as a Cloudflare Worker secret. Visitors submit messages
to `/api/message`; they do not see the recipient address in the page source.

Turnstile is required for production message submissions.

```sh
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
```

Also set this Worker variable so the page can render the widget:

```txt
PUBLIC_TURNSTILE_SITE_KEY=<your Turnstile site key>
```

Create a KV namespace for rate limiting and bind it to the Worker:

```txt
Binding name: MESSAGE_RATE_LIMIT
```

The checked-in `wrangler.jsonc` includes this binding. Wrangler can create the
namespace during deploy, or you can add it in the Cloudflare dashboard under
Settings > Bindings.

The message endpoint uses:

```txt
Turnstile required on every message
Same-site Origin/Host checks for miuo.me and www.miuo.me
Same IP: 3 messages per 10 minutes
Same IP: 20 messages per day
Duplicate message suppression for 24 hours
Honeypot field and message length limits
```

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill in local values, then run:

```sh
pnpm run worker:dev
```

## Deploy

```sh
pnpm run deploy
```
