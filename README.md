# linear-matti

Self-hosted issue tracker replacing Linear for personal use. The source of truth is [`tracker-spec.md`](tracker-spec.md).

## Layout

- `apps/api`: Hono service (REST, MCP, attachments)
- `apps/web`: dashboard placeholder (Next.js comes in P8)
- `packages/shared`: shared schemas, types, constants
- `docs/`: project docs

## Local dev

Requires Node 22 (`nvm use`) and pnpm 10 (via corepack).

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter api dev   # serves http://localhost:3000/healthz
pnpm format             # apply Biome formatting
```
