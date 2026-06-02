# minimal-personal-homepage

Personal homepage built with [Astro](https://astro.build) and deployed on Cloudflare Workers.

Site: [miuo.me](https://miuo.me)

## Tech Stack

- **Astro 5** — static site generation
- **Cloudflare Workers** — API endpoints + static asset hosting
- **TypeScript** — type-safe worker logic
- **Wrangler** — CLI for Cloudflare Workers

## Project Structure

```
├── src/                  # Astro pages & Worker API
│   ├── pages/            # Page components (index.astro)
│   └── worker.js         # Cloudflare Worker entry (message form API)
├── public/               # Static assets (images, favicon)
├── .dev.vars.example     # Environment variable template
├── astro.config.mjs      # Astro config
├── wrangler.jsonc        # Wrangler config
├── DEPLOY.md             # Deployment guide
└── package.json
```

## Getting Started

```sh
pnpm install
pnpm run dev           # Astro dev server
pnpm run worker:dev    # Local Worker with Wrangler
```

## Deployment

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions.

Quick deploy:

```sh
pnpm run deploy
```

## License

MIT
