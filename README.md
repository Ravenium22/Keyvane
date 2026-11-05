# Keyvane

[![CI](https://github.com/Ravenium22/keyvane/actions/workflows/ci.yml/badge.svg)](https://github.com/Ravenium22/keyvane/actions/workflows/ci.yml)
[![SDK: MIT](https://img.shields.io/badge/SDK-MIT-0f766e)](packages/sdk/LICENSE)
[![Platform: FSL-1.1-MIT](https://img.shields.io/badge/platform-FSL--1.1--MIT-c2410c)](apps/server/LICENSE)
[![Node.js 22.18+](https://img.shields.io/badge/node-%E2%89%A522.18-15151c)](.nvmrc)

**Licenses, plans and usage limits for software you sell, kept in sync with Stripe.**

Keyvane is the monetization access layer for independent software products. Your payment provider collects the money; Keyvane turns its subscription events into product access and answers one question for your app: *what may this customer do right now?*

```ts
import { Keyvane } from '@keyvane/sdk';

const keyvane = new Keyvane(); // KEYVANE_URL + KEYVANE_SECRET_KEY

const access = await keyvane.entitlements.get({ customer: user.id });
if (!access.can('export')) return showUpgrade('Export is on Pro');

const usage = await keyvane.usage.record({ customer: user.id, feature: 'pdf_analysis' });
if (!usage.allowed) return showUpgrade(usage.message);
```

## What you get

- **Plans and entitlements.** Free / Pro / Business with on/off features and metered limits, edited in one matrix.
- **License keys.** Expiry, suspension, revocation and per-device activation limits for desktop apps, CLIs and APIs. A publishable key makes validation safe to ship in clients.
- **Usage limits.** Atomic, idempotent metering with daily, monthly, yearly or lifetime resets.
- **Stripe sync.** Signed, idempotent, order-safe webhook processing. Grace periods for failed payments, a cancellation policy you choose, and one-click replay of failed events.
- **Customer access view and audit log.** Every customer's plan, usage, licenses and history.
- **Simple to run.** One Node.js process and SQLite, with no build step and no external services.

Keyvane is not a payment processor or Merchant of Record. Stripe keeps charging cards, invoicing and handling taxes.

## Quick start

Requires Node.js 22.18+.

```bash
git clone https://github.com/Ravenium22/keyvane.git && cd Keyvane
npm install
npm run seed:demo     # demo account, project, API keys and example .env files
npm run dev           # http://localhost:8787 (log in with the printed credentials)
```

Then simulate a purchase without a Stripe account:

```bash
npm run stripe:simulate -- subscribe --customer user_42 --plan pro
curl "http://localhost:8787/v1/entitlements?customer=user_42" -H "Authorization: Bearer <secret key from seed:demo>"
```

Continue with the [quickstart](docs/getting-started.md).

## Repository layout

| Path | What | License |
|---|---|---|
| [`apps/server`](apps/server) | The platform: landing page, dashboard, REST API, entitlement engine, Stripe sync | FSL-1.1-MIT |
| [`packages/sdk`](packages/sdk) | `@keyvane/sdk`, the zero-dependency TypeScript SDK | MIT |
| [`packages/python`](packages/python) | `keyvane`, the zero-dependency Python SDK | MIT |
| [`examples/pdf-analyzer`](examples/pdf-analyzer) | Web app with plans, a metered feature, a Pro-only feature and Stripe upgrades | MIT |
| [`examples/license-cli`](examples/license-cli) | CLI licensed with keys, device activations and an offline grace period | MIT |
| [`docs`](docs) | Documentation (also served at `/docs` by the server) | MIT |

## Documentation

- [Quickstart](docs/getting-started.md) · [Core concepts](docs/concepts.md) · [Stripe integration](docs/stripe.md) · [License keys](docs/license-keys.md)
- Guides: [Next.js](docs/nextjs.md) · [Express](docs/express.md) · [Electron](docs/electron.md) · [Stripe webhook edge cases](docs/stripe-webhook-edge-cases.md)
- [JavaScript SDK](docs/sdk.md) · [Python SDK](docs/python.md) · [REST API](docs/api-reference.md) · [AI coding agents](docs/agents.md)
- [Self-hosting](docs/self-hosting.md) · [Security & reliability](docs/security.md)
- [Pricing & licensing](docs/pricing-and-licensing.md) · [Roadmap](docs/roadmap.md)

The server also publishes `/llms.txt`, `/llms-full.txt`, Markdown versions of every docs page (`/docs/<page>.md`), `/openapi.json`, `/SKILL.md` for coding agents, `/sitemap.xml` and structured data on every public page.

## Brand and design

Product context, voice and messaging live in [PRODUCT.md](PRODUCT.md); the visual system (Bricolage Grotesque, IBM Plex, ink and burnt-orange OKLCH palette) in [DESIGN.md](DESIGN.md). Brand images are generated with `node scripts/generate-brand-assets.cjs`.

## Development

```bash
npm test             # server and SDK tests (node:test)
python3 -m unittest discover -s packages/python/tests   # Python SDK
npm run typecheck    # TypeScript, no emit
npm run dev          # server with --watch
```

The server runs TypeScript directly with Node's type stripping and uses the built-in `node:sqlite` driver, so there is nothing to compile and no native module to install. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Open core: the SDK, examples and docs are [MIT](LICENSE). The platform in `apps/server` is [FSL-1.1-MIT](apps/server/LICENSE): free to self-host for your own products, and each release becomes MIT after two years. Details in [Pricing & licensing](docs/pricing-and-licensing.md).
