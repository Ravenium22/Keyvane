# Core concepts

Keyvane has a small number of building blocks. Once you know how they fit together, every API response and dashboard screen will make sense.

```text
Project ─┬─ API keys (secret / publishable)
         ├─ Stripe connection (webhook secret)
         ├─ Products ─┬─ Plans ────┐
         │            └─ Features ─┴─ Entitlement matrix (plan × feature)
         ├─ Customers ─── Licenses ─── Subscriptions (from Stripe)
         └─ Audit log, usage counters, daily stats
```

## Projects

A **project** is an isolated workspace with its own API keys, Stripe connection, products, customers and licenses. Most developers use one project per company plus a second one for testing (e.g. *Acme* and *Acme (test)*) connected to Stripe's test mode.

## Products

A **product** is something you sell: a SaaS app, an API, a desktop tool. Each product has a stable **key** such as `pdf-analyzer` that you use in code. When a project has exactly one product you can omit `product` in API calls.

Product settings that affect access:

| Setting | Default | Meaning |
|---|---|---|
| Default plan | Free (if created from the template) | What customers get when they have no valid license. With no default plan, unknown customers get nothing. |
| Cancellation policy | `immediate` | When Stripe ends a subscription, access ends. `period_end` keeps access until the end of the period the customer paid for. |
| Grace period | 7 days | How long access continues after a failed payment while Stripe retries. |

## Plans

**Plans** (Free, Pro, Business…) are what customers buy. A plan has:

- a **key** (`pro`) used in code,
- a **rank**: when a customer holds several valid licenses, the highest-ranked plan wins,
- an optional display **price** (Keyvane does not charge it; your payment provider does),
- optional **Stripe price IDs**: subscriptions to these prices grant this plan,
- an optional **device limit** applied to new licenses on this plan.

## Features

**Features** are what your code checks. There are two types:

- **On/off** (`boolean`), e.g. `export`. `access.can('export')` is true or false.
- **Metered** (`metered`), e.g. `pdf_analysis`, has a limit per plan and a **reset period**: `day`, `month`, `year` or `never` (lifetime). Periods are calendar periods in **UTC**. A monthly feature resets at 00:00 UTC on the 1st.

## The entitlement matrix

For every plan × feature pair you decide whether the plan includes the feature and, for metered features, the limit (empty = unlimited). This matrix is the single source of truth: change it and every customer on that plan is affected immediately, with no deploy needed.

## Customers

A **customer** is one of your users. Keyvane identifies customers by **your own user ID** (`external_id`), so you never store Keyvane IDs in your database:

```ts
await keyvane.entitlements.get({ customer: user.id });
```

Customers are created when you call `customers.upsert`, when you record usage for a new ID, when you issue a license to them, or when they buy through Stripe. Reading entitlements for an unknown ID does **not** create a customer; it returns the default plan.

## Licenses

A **license** grants a customer (or an anonymous key holder) a plan of a product. Every license has a human-friendly **key** such as `KV-7K2QD-9XWMN-4RT8H-PZ3VB`.

| Source | Created by |
|---|---|
| `stripe` | A Stripe subscription (one license per subscription and product, updated as the subscription changes) |
| `dashboard` | You, in the dashboard (beta testers, lifetime deals, support credits) |
| `api` | Your server, via `POST /v1/licenses` |

You can **suspend** (reversible), **reinstate**, **revoke** (permanent), set an **expiry date** and a **device limit**. Admin actions always win over the subscription state: a suspended license stays suspended even if its subscription renews.

## How access is decided

When your app asks for a customer's entitlements, Keyvane:

1. collects the customer's licenses for the product,
2. evaluates each one *at the current moment* (see the table below),
3. picks the valid license with the **highest-ranked plan** (ties go to the newest),
4. falls back to the product's **default plan** if no license is valid,
5. combines that plan's row of the matrix with the customer's usage in the current period.

A license is valid unless:

| Condition | Status | Code |
|---|---|---|
| Revoked by you | `revoked` | `revoked` |
| Suspended by you | `suspended` | `suspended` |
| Past its expiry date | `expired` | `expired` |
| Subscription `past_due` and the grace period is over | `past_due` | `payment_overdue` |
| Subscription `unpaid` | `past_due` | `payment_overdue` |
| Subscription `canceled` and its access window ended | `canceled` | `subscription_canceled` |
| Subscription scheduled to cancel and the date passed | `canceled` | `subscription_canceled` |
| Subscription `incomplete`, `incomplete_expired` or `paused` | `inactive` | `subscription_inactive` |

Because the decision is computed on every request from stored facts and the current time, expirations, grace periods and period ends take effect exactly on time, with no cron jobs.

## Usage metering

`usage.record` checks the remaining allowance and increments the counter in **one atomic step**, so concurrent requests can never push a customer over the limit. A denied attempt is not counted.

- **Idempotency keys** make retries safe: the same key is never counted twice, and replays return `replayed: true`.
- Usage is counted **per customer, per feature, per period**, so it survives plan changes. A customer who used 10 analyses on Free and upgrades to Pro has 490 left this month.
- For license-key products, usage is counted against the license's customer (or the license itself if it has no customer).

## API keys

| Key | Prefix | Where to use it | Can do |
|---|---|---|---|
| Secret | `kv_sk_` | Your server only | Everything in the API |
| Publishable | `kv_pk_` | Desktop apps, CLIs, browsers | Validate, activate and deactivate license keys |

Secret keys are stored as SHA-256 hashes and shown once. Revoke a key and it stops working immediately.

## Audit log

Every change to licenses, plans, customers, API keys and every applied Stripe event is recorded with **who** did it: you in the dashboard, an API key, Stripe or Keyvane itself. Open **Activity**, or a customer's or license's **History**.
