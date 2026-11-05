# Keyvane: product context

Durable facts about the product, its audience and its voice. Design, copy and marketing work starts here. Visual decisions live in [DESIGN.md](DESIGN.md).

## What it is

**Keyvane is an open-core licensing and entitlement platform for independent developers and small SaaS teams.** It connects subscription events from a payment provider (Stripe today) to product access: license keys, plans, feature access and usage limits, through one API.

- Category: monetization access layer / entitlements and licensing infrastructure
- Not: a payment processor, Merchant of Record or tax engine
- Business model: open-core B2B SaaS. MIT SDK, examples and docs; FSL-licensed platform; paid hosted plans (Developer free, Indie $19/mo, Startup $59/mo, Business custom; beta hypothesis, no revenue commission)

## Who it is for

1. **Indie hackers** shipping a product alone or with one or two people, who want their first revenue fast.
2. **Micro-SaaS founders** with a few plans, who need reliable access control rather than enterprise billing.
3. **AI tool builders** whose plans meter requests, credits, analyses or tokens.
4. **Desktop and CLI developers** who sell license keys with device limits (later-stage segment).

Geography: United States, United Kingdom and the EU first, then global. English-language product.

## The job to be done

> "My product works and people want it. I want to charge for it this week, without spending a month on license keys, plan checks, usage counters and Stripe webhook edge cases."

Pain, in their words: separating free and paid users; generating keys; cutting access when a subscription ends; different features per plan; usage and device limits; mirroring Stripe changes; handling upgrades, renewals, cancellations and failed payments.

## Promise and proof

| Promise | Proof in the product |
|---|---|
| One call answers "what may this customer do?" | `GET /v1/entitlements`, `access.can()` in the SDK |
| Access stays correct when Stripe events are late, duplicated or out of order | Signed, stored, idempotent, transactional, order-safe processing with replay (see docs/security.md) |
| Limits cannot be exceeded under concurrency | Atomic check-and-increment, idempotency keys |
| You keep control of your stack | Works on top of your Stripe account; no Stripe API keys needed; self-hostable; MIT SDK |
| Fast to adopt | Default free plan, plan template, simulator, example apps, 10-minute quickstart |

Never claim traction, customers, uptime figures or certifications that do not exist yet.

## Voice

- **Direct and specific.** Say what happens: "When Stripe ends the subscription, access ends." Avoid superlatives ("powerful", "seamless", "revolutionary").
- **Developer to developer.** Show code and real responses early. Use the words developers use: plan, license key, entitlement, usage limit, webhook.
- **Calm about money.** People trust Keyvane with paying customers. Prefer precise, reassuring statements over hype.
- **Plain punctuation.** Short sentences, full stops, sentence-case headings. Use em dashes sparingly and avoid "not X, but Y" slogans.

## Messaging

- Tagline: **Build independently. Launch globally. Monetize simply.**
- Positioning: **The monetization access layer for independent software.**
- One-liner: **Licenses, plans and usage limits for software you sell, kept in sync with Stripe.**
- Short boilerplate (≈25 words): Keyvane gives independent developers license keys, plans, feature access and usage limits in one API, kept in sync with their Stripe subscriptions.
- Long boilerplate (≈60 words): Keyvane is an open-core licensing and entitlement platform for indie developers and small SaaS teams. It turns subscription events from Stripe into license keys, plan-based feature access and usage limits, so founders stop rebuilding monetization infrastructure. Keyvane is not a payment processor: the payment provider keeps charging customers, and Keyvane decides what each customer may use.

## Constraints

- Must stay understandable for a solo developer in ten minutes.
- Every surface must work without JavaScript (server-rendered) and without third-party requests (fonts and assets are self-hosted).
- Accessibility: WCAG 2.2 AA contrast, keyboard access, visible focus.

## Name note

The product was first called LaunchKit. That name is crowded (a `launchkit` npm package, a `launchkit` PyPI package and an earlier open-source app-marketing toolkit), so it was renamed **Keyvane** in November 2026. When the name was chosen, `keyvane.dev`, `keyvane.app`, the npm name `keyvane` and the PyPI name `keyvane` were unregistered; `keyvane.com` was taken. A trademark search (USPTO, TÜRKPATENT) is still to be done.

The name: a **key** (licenses, access) and a **vane** (a weathervane arrow that turns with the wind, the way access follows billing events). The mark shows both: a key whose shaft ends in an arrow.
