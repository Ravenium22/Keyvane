# Quickstart

This guide takes you from zero to a working integration. You will:

1. Run Keyvane (or use your hosted instance).
2. Define a product with Free, Pro and Business plans.
3. Check a customer's entitlements and record usage from your code.
4. Simulate a Stripe purchase and watch access change.

You need **Node.js 22.18 or newer**.

## 1. Run Keyvane

```bash
git clone https://github.com/Ravenium22/keyvane.git
cd Keyvane
npm install
npm run seed:demo   # creates a demo account, project, API keys and example .env files
npm run dev         # http://localhost:8787
```

Open <http://localhost:8787/login> and sign in with the credentials that `seed:demo` printed (`demo@keyvane.local` / `keyvane-demo`).

> Using a hosted Keyvane instance instead? Sign up, create a project and tick **“Add the example product”**. Everything below works the same with your instance's URL instead of `http://localhost:8787`.

## 2. Look at the product

Open **Products & plans → AI PDF Analyzer**. The demo product mirrors a typical indie product:

| Plan | Price | `pdf_analysis` (metered, monthly) | `export` | `priority_processing` |
|---|---:|---:|:---:|:---:|
| Free (default) | $0 | 10 | — | — |
| Pro | $12 / month | 500 | ✓ | — |
| Business | $39 / month | 3,000 | ✓ | ✓ |

- **Plans** are what you sell. The **default plan** is what customers get without a license.
- **Features** are what your code checks. *On/off* features are switches. *Metered* features have a limit that resets every day, month or year (or never).
- The **matrix** at the bottom decides which plan unlocks what. Change a cell, save, and it applies to every customer immediately.

## 3. Create an API key

Go to **API keys → Create a key**, choose **Secret**, and copy the key (it is shown once). Use it only on your server:

```bash
export KEYVANE_URL=http://localhost:8787
export KEYVANE_SECRET_KEY=kv_sk_...
```

Every project also has a **publishable key** (`kv_pk_…`). It can only validate and activate license keys, so it is safe to ship inside desktop apps. See [License keys](license-keys.md).

## 4. Check entitlements from your code

```bash
npm install @keyvane/sdk
```

```ts
import { Keyvane } from '@keyvane/sdk';

const keyvane = new Keyvane(); // reads KEYVANE_URL and KEYVANE_SECRET_KEY

// Register customers when they sign up, using YOUR user ID.
await keyvane.customers.upsert({ externalId: user.id, email: user.email });

// What may this user do right now?
const access = await keyvane.entitlements.get({ customer: user.id });

access.plan?.key;                  // 'free'
access.can('export');              // false: Pro only
access.remaining('pdf_analysis');  // 10

// Consume usage. The limit check and the increment are one atomic step.
const usage = await keyvane.usage.record({
  customer: user.id,
  feature: 'pdf_analysis',
  idempotencyKey: job.id, // retries never count twice
});

if (!usage.allowed) {
  // 'limit_exceeded' or 'not_included': show an upgrade prompt
  return res.status(402).json({ error: usage.message });
}
```

Prefer plain HTTP? The same calls with `curl`:

```bash
curl "$KEYVANE_URL/v1/entitlements?customer=user_42" \
  -H "Authorization: Bearer $KEYVANE_SECRET_KEY"

curl "$KEYVANE_URL/v1/usage" \
  -H "Authorization: Bearer $KEYVANE_SECRET_KEY" \
  -d customer=user_42 -d feature=pdf_analysis
```

## 5. Simulate a purchase

You can try the whole subscription lifecycle without a Stripe account. `seed:demo` configured a webhook secret for the demo project, and the simulator sends correctly signed Stripe events to your server:

```bash
npm run stripe:simulate -- subscribe --customer user_42 --plan pro
```

Ask for the entitlements again: `user_42` is now on **Pro** with 500 analyses and export enabled. Then try:

```bash
npm run stripe:simulate -- upgrade   --customer user_42 --plan business
npm run stripe:simulate -- past-due  --customer user_42   # grace period keeps access
npm run stripe:simulate -- recover   --customer user_42
npm run stripe:simulate -- cancel    --customer user_42   # back to Free
```

Every event shows up under **Stripe → Events** and in the customer's history.

When you are ready for the real thing, follow the [Stripe integration guide](stripe.md).

## 6. Run the example app

```bash
npm run dev --workspace pdf-analyzer-example   # http://localhost:3000
```

Sign in as any username, analyze the sample PDF, hit the Free limit, then simulate an upgrade:

```bash
npm run stripe:simulate -- subscribe --customer user_<username> --plan pro
```

Reload the app: the limit is now 500 and **Export to Markdown** is unlocked.

## Next steps

- Understand how access is decided: [Core concepts](concepts.md)
- Connect real payments: [Stripe integration](stripe.md)
- Ship a desktop app or CLI: [License keys & devices](license-keys.md)
- Deploy Keyvane: [Self-hosting](self-hosting.md)
