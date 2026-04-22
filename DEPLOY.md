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

Optional Turnstile spam protection:

```sh
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
```

If Turnstile is enabled, also set `PUBLIC_TURNSTILE_SITE_KEY` in the build
environment so Astro can render the widget.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill in local values, then run:

```sh
pnpm run worker:dev
```

## Deploy

```sh
pnpm run deploy
```
