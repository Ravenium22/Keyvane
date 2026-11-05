# REST API reference

Base URL: your Keyvane deployment, e.g. `https://keyvane.example.com/v1`.

The API is plain JSON over HTTPS, so any language works. The [JavaScript SDK](sdk.md) wraps every endpoint below.

## Conventions

**Authentication.** Send an API key as a bearer token:

```bash
curl https://keyvane.example.com/v1/products -H "Authorization: Bearer kv_sk_..."
```

Secret keys (`kv_sk_…`) can call every endpoint. Publishable keys (`kv_pk_…`) can only call the three license endpoints marked **publishable**.

**Request bodies** can be JSON (`Content-Type: application/json`) or form-encoded (`curl -d key=value`).

**Errors** use HTTP status codes and a consistent body:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "parameter_missing",
    "message": "customer is required.",
    "param": "customer"
  }
}
```

| Status | `type` | Typical `code`s |
|---|---|---|
| 400 | `invalid_request_error` | `parameter_missing`, `parameter_invalid`, `invalid_json`, `feature_not_metered`, `idempotency_key_reused` |
| 401 | `authentication_error` | `invalid_api_key` |
| 403 | `permission_error` | `secret_key_required` |
| 404 | `not_found_error` | `customer_not_found`, `product_not_found`, `plan_not_found`, `feature_not_found`, `license_not_found`, `route_not_found` |
| 409 | `conflict_error` | `license_revoked`, `managed_by_stripe`, `key_taken` |
| 413 | `invalid_request_error` | `payload_too_large` (bodies are limited to 1 MB) |
| 429 | `rate_limit_error` | `rate_limited` |
| 500 | `api_error` | `internal_error` |

Every response carries an `X-Request-Id` header. Include it when you report a problem.

**Business outcomes are not errors.** A usage limit being reached, a feature not in the plan, or an invalid license key all return `200` with `allowed: false` / `valid: false` and a `code`.

**Pagination.** List endpoints accept `limit` (1–100, default 20) and `starting_after` (the last `id` you received) and return:

```json
{ "object": "list", "data": [ ... ], "has_more": true }
```

**Idempotency.** `POST /v1/usage` accepts an `idempotency_key` (body) or `Idempotency-Key` header. Replays return the original outcome with `"replayed": true` and are not counted again.

**Rate limits.** 1,200 requests per minute per secret key; 120 per minute per publishable key and client IP on license endpoints (both configurable when self-hosting). Responses include `X-RateLimit-Remaining`; `429` responses include `Retry-After`.

**IDs and references.** Objects have prefixed IDs (`cust_…`, `lic_…`, `prd_…`, `pln_…`). Wherever you pass a customer you can use **your own user ID** (`external_id`) instead; wherever you pass a product or plan you can use its **key** (`pdf-analyzer`, `pro`). `product` is optional when the project has exactly one product.

---

## Entitlements

### Get a customer's entitlements

`GET /v1/entitlements?customer={customer}&product={product}`

Returns what the customer may do right now. Unknown customers get the product's default plan (no customer record is created).

```bash
curl "https://keyvane.example.com/v1/entitlements?customer=user_42" -H "Authorization: Bearer kv_sk_..."
```

```json
{
  "object": "entitlements",
  "customer": { "id": "cust_01jc…", "external_id": "user_42", "email": "alex@example.com" },
  "product": { "id": "prd_01jc…", "key": "pdf-analyzer", "name": "AI PDF Analyzer" },
  "plan": { "id": "pln_01jc…", "key": "pro", "name": "Pro" },
  "source": "license",
  "license": { "id": "lic_01jc…", "status": "active", "access_until": null },
  "subscription": {
    "provider": "stripe",
    "id": "sub_1Q…",
    "status": "active",
    "current_period_end": "2026-12-05T10:00:00.000Z",
    "cancel_at_period_end": false,
    "canceled_at": null,
    "price_ids": ["price_1Q…"]
  },
  "features": {
    "pdf_analysis": {
      "name": "PDF analyses",
      "type": "metered",
      "enabled": true,
      "limit": 500,
      "used": 12,
      "remaining": 488,
      "reset_period": "month",
      "resets_at": "2026-12-01T00:00:00.000Z",
      "unit": "analyses"
    },
    "export": { "name": "Export to Markdown", "type": "boolean", "enabled": true }
  },
  "checked_at": "2026-11-05T10:00:00.000Z"
}
```

`source` is `license`, `default_plan` or `none`. For metered features, `limit` and `remaining` are `null` when unlimited.

### Check a single feature

`GET /v1/entitlements/check?customer={customer}&feature={feature}&quantity={n}`

```json
{
  "object": "entitlement_check",
  "allowed": false,
  "code": "not_included",
  "message": "Export to Markdown is not included in the Free plan.",
  "feature": { "key": "export", "name": "Export to Markdown", "type": "boolean", "enabled": false },
  "plan": { "id": "pln_…", "key": "free", "name": "Free" },
  "customer": { "id": "cust_…", "external_id": "user_42", "email": null }
}
```

`code` is `ok`, `not_included` or `limit_exceeded`. Unknown feature keys return `404 feature_not_found`, which catches typos early.

---

## Usage

### Record usage

`POST /v1/usage`

| Parameter | Required | Description |
|---|---|---|
| `customer` | one of | Your user ID (the customer is created if new) |
| `license_key` | one of | Meter against a license key instead |
| `feature` | yes | A metered feature key |
| `quantity` | no | Units to consume (default 1, max 1,000,000) |
| `product` | no | Product id or key |
| `idempotency_key` | no | Makes retries safe (also accepted as the `Idempotency-Key` header) |

The limit check and the increment happen atomically. Denied attempts are not counted.

```bash
curl https://keyvane.example.com/v1/usage -H "Authorization: Bearer kv_sk_..." \
  -d customer=user_42 -d feature=pdf_analysis -d idempotency_key=job_123
```

```json
{
  "object": "usage",
  "allowed": true,
  "code": "ok",
  "message": "Usage recorded.",
  "replayed": false,
  "feature": { "key": "pdf_analysis", "name": "PDF analyses", "type": "metered", "enabled": true, "limit": 500, "used": 13, "remaining": 487, "reset_period": "month", "resets_at": "2026-12-01T00:00:00.000Z", "unit": "analyses" },
  "plan": { "id": "pln_…", "key": "pro", "name": "Pro" },
  "customer": { "id": "cust_…", "external_id": "user_42", "email": "alex@example.com" }
}
```

`code` is `ok`, `limit_exceeded`, `not_included` or `license_invalid`. Recording usage for an on/off feature returns `400 feature_not_metered`.

---

## Customers

### Create or update a customer

`POST /v1/customers`. Upserts by `external_id`. Returns `201` when created, `200` when updated.

| Parameter | Description |
|---|---|
| `external_id` | Your user ID (letters, numbers and `_ . : @ \| + -`, max 200) |
| `email`, `name` | Optional |
| `metadata` | Up to 50 keys. Merged into existing metadata; set a key to `null` to remove it |

```json
{
  "object": "customer",
  "id": "cust_01jc…",
  "external_id": "user_42",
  "email": "alex@example.com",
  "name": "Alex",
  "stripe_customer_id": "cus_Q…",
  "metadata": {},
  "last_seen_at": "2026-11-05T09:58:00.000Z",
  "created_at": "2026-11-01T12:00:00.000Z",
  "updated_at": "2026-11-05T09:58:00.000Z"
}
```

### Retrieve, update, list

- `GET /v1/customers/{id_or_external_id}`
- `PATCH /v1/customers/{id_or_external_id}`: `external_id`, `email`, `name`, `metadata` (merged)
- `GET /v1/customers`: filters `external_id`, `email`, `query` (search), plus pagination

---

## Licenses

### Create a license

`POST /v1/licenses` (secret key)

| Parameter | Description |
|---|---|
| `plan` | **Required.** Plan key or id |
| `product` | Product key or id (optional with one product) |
| `customer` | Your user ID; created if new. Omit for a standalone key |
| `expires_at` | ISO date/time, or `YYYY-MM-DD` (end of that day, UTC) |
| `duration_days` | Alternative to `expires_at` |
| `max_activations` | Device limit (defaults to the plan's) |
| `metadata` | Returned to your app on validation |
| `note` | Internal note, never returned to publishable keys |

```json
{
  "object": "license",
  "id": "lic_01jc…",
  "key": "KV-7K2QD-9XWMN-4RT8H-PZ3VB",
  "valid": true,
  "status": "active",
  "status_message": "License is active.",
  "access_until": "2027-11-05T10:00:00.000Z",
  "product": { "id": "prd_…", "key": "pdf-analyzer", "name": "AI PDF Analyzer" },
  "plan": { "id": "pln_…", "key": "pro", "name": "Pro" },
  "customer": { "id": "cust_…", "external_id": "user_42", "email": null },
  "source": "api",
  "expires_at": "2027-11-05T10:00:00.000Z",
  "max_activations": 3,
  "activations": 0,
  "subscription": null,
  "metadata": {},
  "note": "AppSumo #1234",
  "last_validated_at": null,
  "created_at": "2026-11-05T10:00:00.000Z",
  "updated_at": "2026-11-05T10:00:00.000Z"
}
```

`status` is the **effective** status: `active`, `trialing`, `past_due`, `canceled`, `expired`, `inactive`, `suspended` or `revoked`. `valid` says whether it currently grants access.

### Retrieve, list, update

- `GET /v1/licenses/{id}`
- `GET /v1/licenses`: filters `customer`, `product`, `status` (`active`, `suspended`, `revoked`), plus pagination
- `PATCH /v1/licenses/{id}`: `plan`, `expires_at` (`null` = never), `max_activations` (`null` = unlimited), `metadata`, `note`. Changing the plan of a Stripe-managed license returns `409 managed_by_stripe`.

### Suspend, reinstate, revoke

- `POST /v1/licenses/{id}/suspend` with an optional `reason`. Reversible.
- `POST /v1/licenses/{id}/reinstate`
- `POST /v1/licenses/{id}/revoke` with an optional `reason`. Permanent: reinstating returns `409 license_revoked`.

### Validate a key

`POST /v1/licenses/validate` (**publishable** or secret key, CORS enabled)

| Parameter | Description |
|---|---|
| `key` | **Required.** The license key |
| `fingerprint` | If given, the device must be activated |
| `product` | If given, the key must belong to this product |

```json
{
  "object": "license_validation",
  "valid": true,
  "code": "valid",
  "message": "License is active.",
  "license": { "object": "license", "key": "KV-…", "status": "active", "...": "..." },
  "activation": null,
  "entitlements": { "object": "entitlements", "plan": { "key": "pro" }, "features": { "...": "..." } }
}
```

`code` is one of `valid`, `not_found`, `expired`, `suspended`, `revoked`, `subscription_canceled`, `payment_overdue`, `subscription_inactive`, `product_mismatch`, `not_activated`. `entitlements` is `null` when the key is not valid.

### Activate a device

`POST /v1/licenses/activate` (**publishable** or secret key)

`key` and `fingerprint` (1–200 printable characters) are required; `name` and `product` are optional. Idempotent per fingerprint. When the license is full, it returns `valid: false` with `code: "activation_limit_reached"`. The response has the same shape as validation, with `activation` filled in.

### Deactivate a device

`POST /v1/licenses/deactivate` (**publishable** or secret key) with `key` and `fingerprint`:

```json
{ "object": "license_deactivation", "deactivated": true }
```

---

## Products

- `GET /v1/products`: all products with their plans, features and entitlement matrix
- `GET /v1/products/{id_or_key}`

```json
{
  "object": "product",
  "id": "prd_…",
  "key": "pdf-analyzer",
  "name": "AI PDF Analyzer",
  "default_plan": "free",
  "cancellation_policy": "immediate",
  "grace_period_days": 7,
  "plans": [
    {
      "object": "plan",
      "key": "pro",
      "name": "Pro",
      "rank": 10,
      "price": { "amount": 1200, "currency": "usd", "interval": "month" },
      "max_activations": 3,
      "stripe_price_ids": ["price_1Q…"],
      "is_default": false,
      "entitlements": { "pdf_analysis": { "enabled": true, "limit": 500 }, "export": { "enabled": true } }
    }
  ],
  "features": [
    { "object": "feature", "key": "pdf_analysis", "name": "PDF analyses", "type": "metered", "reset_period": "month", "unit": "analyses" }
  ]
}
```

Products, plans and features are managed in the dashboard. A management API is on the [roadmap](roadmap.md).

---

## Stripe webhooks

`POST /v1/webhooks/stripe/{project_id}` is called by Stripe, not by you. It is authenticated by the `Stripe-Signature` header. See [Stripe integration](stripe.md).
