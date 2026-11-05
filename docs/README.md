# Keyvane documentation

Keyvane is the **monetization access layer** for independent software. It sits between your payment provider and your product and answers one question reliably: *what is this customer allowed to do right now?*

- **Plans and entitlements.** Free, Pro, Business… each with on/off features and usage limits.
- **License keys.** Expiry, suspension, revocation and per-device activation limits for desktop apps, CLIs and APIs.
- **Usage limits.** Atomic, idempotent metering with daily, monthly, yearly or lifetime resets.
- **Stripe subscription sync.** Purchases, upgrades, failed payments and cancellations update access automatically.
- **Customer access view and audit log.** See every customer's plan, usage and history in one place.

```text
 ┌──────────────┐  signed webhooks   ┌──────────────┐   SDK / REST API   ┌──────────────┐
 │    Stripe    │ ─────────────────▶ │  Keyvane   │ ◀───────────────── │   Your app   │
 │ payments,    │                    │ plans, keys, │   "can user_42     │ web, API,    │
 │ invoices,    │                    │ entitlements,│    export?"        │ desktop, CLI │
 │ taxes        │                    │ usage, audit │                    │              │
 └──────────────┘                    └──────────────┘                    └──────────────┘
```

Keyvane is **not** a payment processor, Merchant of Record or tax engine. Your payment provider keeps doing that job. Keyvane turns its commercial events into product access.

## Start here

1. [Quickstart](getting-started.md): run Keyvane, define plans and make your first entitlement check in about 10 minutes.
2. [Core concepts](concepts.md): projects, products, plans, features, customers, licenses and how access is decided.
3. [Stripe integration](stripe.md): connect a webhook, map prices to plans and tell Keyvane who paid.
4. [License keys & devices](license-keys.md): sell desktop software and CLIs with keys and activation limits.

## Guides by stack

- [Next.js](nextjs.md): server components and route handlers
- [Express & Node APIs](express.md): middleware for plan checks and usage limits
- [Electron & desktop apps](electron.md): activation, device limits and offline grace
- Article: [Seven Stripe webhook edge cases that silently break access](stripe-webhook-edge-cases.md)

## Reference

- [JavaScript SDK](sdk.md) (`@keyvane/sdk`, MIT)
- [Python SDK](python.md) (`keyvane`, MIT)
- [REST API](api-reference.md) for any language, with an [OpenAPI spec](https://keyvane.example.com/openapi.json)
- [AI coding agents](agents.md): `llms.txt`, Markdown docs and a `SKILL.md` for Claude Code, Cursor and others
- [Self-hosting](self-hosting.md) with one Node.js process and SQLite
- [Security & reliability](security.md)
- [Pricing & licensing](pricing-and-licensing.md): what is open source and what is commercial
- [Roadmap](roadmap.md)

## Examples in this repository

| Example | What it shows |
|---|---|
| [`examples/pdf-analyzer`](../examples/pdf-analyzer) | A web app with Free / Pro / Business plans, a metered feature, a Pro-only feature and Stripe upgrades |
| [`examples/license-cli`](../examples/license-cli) | A CLI licensed with keys, device activations and an offline grace period |
