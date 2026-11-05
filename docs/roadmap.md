# Roadmap

Keyvane is built in three phases. Priorities change with feedback from developers who use it, so [open an issue](https://github.com/Ravenium22/Keyvane/issues) if something here matters to you.

## Phase 1: MVP ✅

- [x] Accounts and projects
- [x] Products with Free / Pro / Business plans
- [x] On/off and metered features, assigned per plan with limits
- [x] License keys: create, validate, suspend, revoke, expire
- [x] Device activation limits for desktop apps and CLIs
- [x] Customer access view (plan, usage, licenses, subscriptions, history)
- [x] Stripe subscription sync (signed, idempotent, order-safe, replayable)
- [x] Grace periods and cancellation policies
- [x] Atomic, idempotent usage metering
- [x] REST API with secret and publishable keys
- [x] Open-source TypeScript SDK
- [x] Example web app and CLI
- [x] Audit log
- [x] Documentation and self-hosting guide
- [x] Password reset by email, customer deletion, data export
- [x] Keyvane Cloud billing on Keyvane itself, operator dashboard, maintenance jobs

## Phase 2: Public beta

- [ ] Second payment provider (Paddle or Lemon Squeezy)
- [ ] Customer portal: end customers see their licenses and manage their devices
- [ ] Subscription history and entitlement analytics
- [ ] Team members and organizations with roles
- [ ] Management API for products, plans and features (infrastructure as code)
- [ ] Outbound webhooks (`license.created`, `entitlements.changed`, …)
- [ ] One-time purchases and lifetime deals through Stripe Checkout
- [ ] Importing existing Stripe subscriptions
- [x] Python SDK
- [ ] More SDKs (Go, PHP) and framework middleware packages (Next.js, Express, Hono)

## Phase 3: Commercial platform

- [ ] Advanced usage limits (rolling windows, overage, credit packs)
- [ ] Multi-product bundles
- [ ] Enterprise licensing (seat pools, floating licenses)
- [ ] Advanced license security: signed offline license files, key rotation
- [ ] Roles and permissions, SSO
- [ ] Revenue and product analytics
- [ ] Priority support and custom integrations
