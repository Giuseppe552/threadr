# Contributing to threadr

## Reporting bugs

Open an issue. Include steps to reproduce, expected vs actual behavior, and your environment (OS, Docker version, browser).

## Suggesting plugins

Open an issue with:
- What data source the plugin would query
- What node/edge types it would produce
- Whether it requires an API key
- Rate limits of the upstream API

## Pull requests

1. Fork the repo
2. Create a branch from `main`
3. Make your changes
4. Run `npm run lint` and `npm test`
5. Open a PR against `main`

Keep PRs focused. One feature or fix per PR.

## Writing plugins

Plugins live in `apps/worker/src/plugins/`. Each plugin exports a single object implementing the `Plugin` interface from `@threadr/shared`:

```ts
import type { Plugin } from '@threadr/shared'

export const myPlugin: Plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  accepts: ['Email'],
  requiresKey: false,
  rateLimit: { requests: 10, windowMs: 60_000 },
  async run(seed, keys) {
    // query your data source
    // return { nodes: [...], edges: [...] }
  },
}
```

Register it in `apps/worker/src/scan.ts`.

## Code style

- TypeScript strict mode
- No `any` types without justification
- Prefer `const` over `let`
- Error handling: catch, log, return empty results (plugins should not crash scans)

## Security

If you find a security vulnerability, **do not open a public issue**. Email contact@giuseppegiona.com instead.
