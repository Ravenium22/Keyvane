# JavaScript / TypeScript SDK

`@keyvane/sdk` is the official, MIT-licensed SDK. It has **zero dependencies**, ships TypeScript types, and runs on Node.js 18+, Bun, Deno, edge runtimes and browsers (with a publishable key).

```bash
npm install @keyvane/sdk
```

## Configure

```ts
import { Keyvane } from '@keyvane/sdk';

const keyvane = new Keyvane({
  apiKey: process.env.KEYVANE_SECRET_KEY,     // kv_sk_… on servers, kv_pk_… in apps
  baseUrl: 'https://keyvane.example.com',     // your Keyvane deployment
  timeoutMs: 10_000,   // default
  maxRetries: 2,       // default, for safe requests only
  cacheTtlMs: 0,       // cache entitlements.get() results (default off)
});
```

With no options, `apiKey` falls back to `KEYVANE_SECRET_KEY` (or `KEYVANE_PUBLISHABLE_KEY`) and `baseUrl` to `KEYVANE_URL`.

Inputs use camelCase (`externalId`, `idempotencyKey`). Responses mirror the [REST API](api-reference.md) exactly (snake_case), so the API reference doubles as the type reference.

## Entitlements

```ts
const access = await keyvane.entitlements.get({ customer: user.id, product: 'pdf-analyzer' });
```

`product` is optional when your project has one product. The result is an `Entitlements` object:

| Member | Returns |
|---|---|
| `access.plan` | `{ id, key, name }` or `null` |
| `access.source` | `'license'`, `'default_plan'` or `'none'` |
| `access.can(key, quantity = 1)` | `true` if the feature is included and, for metered features, `quantity` units remain |
| `access.remaining(key)` | Units left this period. `null` = unlimited, `0` = not included |
| `access.limit(key)` / `access.used(key)` | The metered limit / units used this period |
| `access.isOnPlan('pro', 'business')` | Plan membership check |
| `access.feature(key)` | The raw feature entitlement (with `resets_at`, `unit`, …) |
| `access.subscription`, `access.license` | Billing context, when access comes from a license |
| `access.data` | The full API response |

Server-side single-feature check (handy from other languages or edge functions):

```ts
const check = await keyvane.entitlements.check({ customer: user.id, feature: 'export' });
check.allowed; // boolean
check.code;    // 'ok' | 'not_included' | 'limit_exceeded'
```

## Usage

```ts
const usage = await keyvane.usage.record({
  customer: user.id,        // or licenseKey: 'KV-…'
  feature: 'pdf_analysis',
  quantity: 1,              // default 1
  idempotencyKey: job.id,   // strongly recommended
});

if (!usage.allowed) showUpgrade(usage.message); // usage.code: 'limit_exceeded' | 'not_included' | 'license_invalid'
```

`record` never throws because a limit was reached; that is a normal outcome. It only throws for real errors (invalid key, unknown feature, network). Recording usage invalidates cached entitlements for that customer.

**Charge only for successful work.** Either record first and accept that a failed job consumed a unit, or check with `access.can(feature)` first and record after the work succeeded (two concurrent requests may then both pass the check).

## Customers

```ts
await keyvane.customers.upsert({ externalId: user.id, email: user.email, name: user.name, metadata: { plan_source: 'web' } });
await keyvane.customers.retrieve(user.id);            // by your ID or cust_…
await keyvane.customers.update(user.id, { email: 'new@example.com' });
await keyvane.customers.list({ limit: 20 });
```

## Licenses

```ts
// Secret key
const license = await keyvane.licenses.create({ plan: 'pro', customer: user.id, durationDays: 365 });
await keyvane.licenses.retrieve(license.id);
await keyvane.licenses.list({ customer: user.id, status: 'active' });
await keyvane.licenses.update(license.id, { plan: 'business', maxActivations: 5 });
await keyvane.licenses.suspend(license.id, { reason: 'chargeback' });
await keyvane.licenses.reinstate(license.id);
await keyvane.licenses.revoke(license.id, { reason: 'refund' });

// Publishable or secret key
const result = await keyvane.licenses.validate({ key, fingerprint });
await keyvane.licenses.activate({ key, fingerprint, name: 'Studio Mac' });
await keyvane.licenses.deactivate({ key, fingerprint });
```

`validate` and `activate` return a `LicenseValidation` with `valid`, `code`, `message`, `license`, `activation` and `entitlements` (an `Entitlements` object when valid). See [License keys](license-keys.md).

## Products

```ts
const { data: products } = await keyvane.products.list();
const product = await keyvane.products.retrieve('pdf-analyzer'); // plans, features, matrix
```

Useful for rendering a pricing table from the same source of truth as your access checks.

## Errors

Every error extends `KeyvaneError` and carries `status`, `code`, `type`, `param` and `requestId`:

| Class | When |
|---|---|
| `KeyvaneInvalidRequestError` | 400: missing or invalid parameter |
| `KeyvaneAuthenticationError` | 401: missing, wrong or revoked key |
| `KeyvanePermissionError` | 403: publishable key on a secret-key endpoint |
| `KeyvaneNotFoundError` | 404: unknown customer, license, product, plan or feature |
| `KeyvaneConflictError` | 409: e.g. reinstating a revoked license |
| `KeyvaneRateLimitError` | 429 |
| `KeyvaneApiError` | 5xx |
| `KeyvaneConnectionError` | Network failure or timeout |

## Retries and timeouts

Safe and idempotent requests are retried on network errors, `429` and `5xx` with exponential backoff (honouring `Retry-After`): all GET requests, `customers.upsert`, license validation, activation and deactivation, and usage records **that carry an idempotency key**. Other writes are not retried automatically, because retrying them could duplicate work.

## When Keyvane is unreachable: fail open or closed?

Decide per feature:

```ts
let access;
try {
  access = await keyvane.entitlements.get({ customer: user.id });
} catch (err) {
  if (err instanceof KeyvaneConnectionError) {
    // Fail closed for paid features, keep the free experience working:
    return renderFreeTier();
  }
  throw err;
}
```

A small `cacheTtlMs` (5–30 seconds) also absorbs brief network blips and cuts latency on busy pages.
