# Coding standards

For the **review** axis (the `code-review` skill's Standards pass). Implementation agents are not expected to read this; they follow the architecture docs below.

**Mechanical rules are enforced by tooling, not here.** Formatting and lint rules run in `pnpm check` (Biome, recommended preset) and in the git hooks. If a rule can be checked by a tool, add it to `biome.json` or a test instead of writing it down here. This file is only for **judgement calls** no guardrail can settle.

## Architecture and boundaries

The detailed, per-package rules live in the docs; treat them as the standard and read the relevant one before reviewing:

- System shape and the one-service-layer rule: [`README.md`](README.md) and [ADR 0006](docs/adr/0006-one-service-layer-stateless-mcp-on-hono.md).
- Dashboard rules (server/client split, data access, components, styling, route groups): [`apps/web/README.md`](apps/web/README.md).
- Vocabulary: [`GLOSSARY.md`](GLOSSARY.md).

Judgement calls the docs assume but do not spell out:

- **One meaning, one place.** When a hunk repeats a block that already exists elsewhere in the diff or the repo (a 404 handler, a guard, a header, a constant), extract one shared helper and call it from both. Duplication in a diff is a review finding.
- **Business rules belong in `apps/api/src/service/`.** REST and MCP are thin adapters; a review that finds validation, authorization or state transitions in an adapter should push them down. Conversely, no `process.env` outside the config module.
- **Web stays server-first.** Reads in server components, writes in server actions, route handlers only for data a client cannot get otherwise. The API token never reaches a client component or a prop. Flag any client component that fetches the API directly.
- **Match the surrounding code.** Naming, file placement and module shape follow the nearest peer, not a personal preference. If the diff invents a new pattern where an established one exists, that is the finding.

## Errors

- The API's error codes and shape are part of the contract: preserve them through adapters and route handlers. `apps/web/README.md` describes the dashboard side (`ApiError`, `conflict`, `toFailure`).
- A stale-write conflict is a real 409 with `currentUpdatedAt`/`expectedUpdatedAt`, not a generic failure. Review that optimistic writes send the last seen `updatedAt` and roll back on conflict.

## Tests

- Test behaviour and the contract, not the implementation. A test that pins private structure without exercising observable behaviour is a finding.
- Pure logic gets unit tests; anything touching the API, the database or the browser gets the appropriate integration test (`vitest`, or Playwright e2e under `apps/web/e2e/`). See `apps/web/README.md` and `README.md` for the runners.
- Config changes update the documented table and its test (the README table is pinned by a test); a config change without the matching test/doc update is a finding.

## Docs and provenance

- Reference issues by identifier (`TRC-nnn`) in commits, PR titles and comments.
- When a change alters documented behaviour, update the doc that describes it (`README.md`, `apps/web/README.md`, `docs/`, an ADR). Contradicting an ADR without saying so is a finding.
