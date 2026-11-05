---
name: keyvane
description: Integrate Keyvane into an app to add plans, feature gates, usage limits, license keys and Stripe subscription sync. Use when the user asks to monetize an app with Keyvane, gate features by plan, limit free-tier usage, or validate license keys with Keyvane.
---

# Integrating Keyvane

Keyvane answers "what may this customer do right now?" for an app, based on plans and Stripe subscriptions. Docs: https://keyvane.example.com/docs · API spec: https://keyvane.example.com/openapi.json

## 1. Gather what you need

- `KEYVANE_URL`: the Keyvane deployment, for example https://keyvane.example.com
- `KEYVANE_SECRET_KEY` (`kv_sk_…`): server-side only. Never put it in client bundles, mobile apps or desktop apps.
- For desktop apps and CLIs: the publishable key (`kv_pk_…`), which can only validate and activate license keys.
- The product key and the feature keys defined in the Keyvane dashboard (Products & plans). Ask the user for them if they are not in the code or `.env` files. Do not invent feature keys.

## 2. Install and create one client

```bash
npm install @keyvane/sdk
```

```ts
import { Keyvane } from '@keyvane/sdk';
export const keyvane = new Keyvane(); // reads KEYVANE_URL and KEYVANE_SECRET_KEY
```

Python: `pip install keyvane`, then `from keyvane import Keyvane` (same methods in snake_case, see /docs/python). Other languages: call the REST API (`Authorization: Bearer <key>`); every SDK method maps to one endpoint in the OpenAPI spec.

## 3. Use the app's own user IDs

Keyvane identifies customers by the app's existing user ID (`customer: user.id`). Do not add Keyvane IDs to the app's database. Register users at sign-up:

```ts
await keyvane.customers.upsert({ externalId: user.id, email: user.email });
```

## 4. Gate features (server-side)

```ts
const access = await keyvane.entitlements.get({ customer: user.id });
if (!access.can('export')) { /* show an upgrade prompt or return 403 */ }
access.plan?.key;                 // e.g. 'free', 'pro'
access.remaining('pdf_analysis'); // null = unlimited
```

## 5. Enforce usage limits

```ts
const usage = await keyvane.usage.record({ customer: user.id, feature: 'pdf_analysis', idempotencyKey: jobId });
if (!usage.allowed) { /* usage.code: 'limit_exceeded' | 'not_included'; return 402 or show upgrade */ }
```

`record` checks and consumes atomically and does not throw when a limit is reached. Pass an idempotency key derived from the job or request so retries are not double-counted.

## 6. Upgrades with Stripe

Payments stay in Stripe. Link purchases to the user with `client_reference_id`:

- Payment Link: `https://buy.stripe.com/...?client_reference_id=<user.id>`
- Checkout Session: `client_reference_id: user.id` and `subscription_data: { metadata: { keyvane_customer_id: user.id } }`

The user must connect the Stripe webhook and map price IDs to plans in the Keyvane dashboard (Stripe page). Tell them; you cannot do it from code.

## 7. License keys (desktop apps, CLIs, APIs)

```ts
const kv = new Keyvane({ apiKey: process.env.KEYVANE_PUBLISHABLE_KEY, baseUrl: process.env.KEYVANE_URL });
const result = await kv.licenses.activate({ key, fingerprint: stableMachineHash, name: hostname });
if (!result.valid) console.error(result.code, result.message); // e.g. 'activation_limit_reached'
```

## 8. Failure handling

Catch `KeyvaneConnectionError` and decide per feature: keep free features working and pause paid ones unless the user specifies otherwise. Do not silently grant paid access on errors.

## 9. Verify

- Without Stripe: `npm run stripe:simulate -- subscribe --customer <user id> --plan pro` in a Keyvane checkout, then call `keyvane.entitlements.get` again.
- Check that the secret key appears only in server code and environment variables.
