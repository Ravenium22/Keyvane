# Pricing & licensing

Keyvane is **open core**. The parts you build against are open source. The managed service is how the project pays for itself.

## What is open source (MIT)

| Part | Location |
|---|---|
| JavaScript/TypeScript SDK (`@keyvane/sdk`) | [`packages/sdk`](../packages/sdk) |
| Integration examples (web app, CLI) | [`examples/`](../examples) |
| Documentation | [`docs/`](.) |

Use, modify and redistribute them freely, including in closed-source commercial products.

## What is source-available (FSL-1.1-MIT)

The platform in [`apps/server`](../apps/server) (dashboard, REST API, entitlement engine and Stripe sync) is published under the [Functional Source License 1.1 with an MIT future license](../apps/server/LICENSE):

- ✅ Read, run, modify and **self-host it for your own products**, for any internal or commercial use
- ✅ Use it for non-commercial education and research, and to provide professional services to a licensee
- ❌ Offer it to others as a competing hosted service while the FSL applies
- ⏳ **Every release becomes MIT-licensed two years after it is published**

This keeps the code transparent and auditable, which matters for something that decides who has paid, while protecting the hosted service that funds development.

## Keyvane Cloud plans

These prices are the current hypothesis and will be validated with early users during the public beta.

| Plan | Price | For | Includes |
|---|---:|---|---|
| Developer | Free | Trying Keyvane, open-source projects | One product, basic license management, limited active licenses, core integration, community support |
| Indie | $19 / month | Developers earning their first revenue | Multiple products, higher license limits, Stripe subscription sync, feature access control, basic analytics |
| Startup | $59 / month | Growing products and small teams | High license volume, team members, advanced usage tracking, audit log, priority support |
| Business | Custom | Advanced security and contractual needs | Custom limits, contract-based support, security and access options, custom integrations |

- Keyvane charges a subscription, **never a commission on your revenue**. It is not a payment provider.
- During the public beta, plan limits are not enforced and every feature is available on every plan.
- Keyvane Cloud bills its own users with Keyvane: plans, quotas and upgrades run on the same engine you use.
- Self-hosted installations have no plan limits.

## Contributing

Contributions are licensed under the license of the directory they touch: MIT for the SDK, examples and docs, FSL-1.1-MIT for `apps/server`. See [CONTRIBUTING.md](../CONTRIBUTING.md).
