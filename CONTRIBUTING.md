# Contributing

Traccia is a small, self-hosted issue tracker for one developer and their AI agents. It is open source under MIT, and contributions are welcome.

## Before you start

Open a GitHub issue to describe the change, or send a pull request if it is small and obvious. Planned work is tracked in Traccia, the self-hosted tracker this project builds, so the public backlog is not mirrored on GitHub.

## Development

Node 22 or newer and pnpm 10 are required.

```sh
pnpm install
pnpm check        # Biome lint, TypeScript typecheck and tests
```

`pnpm check` must pass before a pull request. The versioned git hooks run the same checks: lint on commit, the full check on push.

To run the stack locally, follow the Quickstart in [README.md](README.md). The API needs `BASE_URL` and a writable `DATA_DIR`; the dashboard needs `TRACCIA_API_URL` and a `you` token.

Browser tests:

```sh
pnpm --filter web test:e2e
```

## Guidelines

- Keep a change small and focused.
- Match the surrounding code. The judgement calls are in [CODING_STANDARDS.md](CODING_STANDARDS.md).
- Update the documentation a change affects: `README.md`, `apps/web/README.md`, `docs/`, or an ADR.
- Reference the issue in the commit and pull request title when there is one, for example `TRC-123`.
- Write the tests a change needs. Pure logic gets unit tests; anything touching the API, the database or the browser gets an integration test.

## Voice

Product copy follows the brand brief in [docs/brand/brand-brief.md](docs/brand/brand-brief.md): calm, precise, a little playful. No em dashes, no hype.

## License

By contributing you agree that your contribution is licensed under the MIT license in [LICENSE](LICENSE).
