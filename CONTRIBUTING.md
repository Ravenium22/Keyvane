# Contributing to Keyvane

Thanks for helping. Bug reports, docs fixes, examples for other frameworks and new SDKs are all welcome.

## Getting set up

```bash
npm install          # also builds the SDK
npm run seed:demo    # optional: demo data
npm run dev          # http://localhost:8787
npm test
npm run typecheck
```

Requirements: Node.js 22.18+. There is no database server to install (Keyvane uses `node:sqlite`) and no build step for the server (Node runs the TypeScript directly).

## Where things live

```text
apps/server/src
├── services/        domain logic (entitlements, licenses, usage, Stripe sync…), pure functions taking a Ctx
├── api/             REST API v1 routes and JSON serializers
├── web/             server-rendered landing page, docs and dashboard
├── db/              SQLite wrapper and append-only migrations
└── lib/             small helpers (validation, crypto, ids, html escaping)
apps/server/test     node:test suites (engine, Stripe, API, dashboard)
packages/sdk         @keyvane/sdk
examples/            runnable integration examples
docs/                Markdown docs, rendered at /docs
```

## Guidelines

- **Tests first for access logic.** Anything that changes who gets access (license evaluation, Stripe handling, usage) needs a test. Use the `TestClock` in `apps/server/test/helpers.ts` to travel in time.
- **Migrations are append-only.** Never edit a shipped migration in `db/migrations.ts`; add a new one.
- **Keep the server dependency-free where practical.** Prefer the Node standard library.
- **Erasable TypeScript only.** No enums, namespaces or parameter properties (Node strips types at runtime). Use `import type` for types.
- **Escape by default.** Render HTML with the `html` tagged template; use `raw()` only for trusted content.
- **Copy:** short, specific, sentence case. Say what happened and what to do next.

## Pull requests

1. Open an issue first for larger changes so we can agree on the approach.
2. Keep PRs focused; include tests and docs updates.
3. Run `npm run typecheck && npm test` before pushing.

## Licensing of contributions

By contributing, you agree that your contribution is licensed under the license of the directory you change: MIT for `packages/`, `examples/` and `docs/`, and FSL-1.1-MIT (converting to MIT after two years) for `apps/server/`. You confirm you have the right to submit it.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
