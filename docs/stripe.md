# Stripe integration

Keyvane keeps access in sync with your Stripe subscriptions. Stripe keeps charging cards, sending invoices and handling taxes; Keyvane listens to its webhooks and turns them into licenses and entitlements.

**Keyvane never needs your Stripe API keys.** It only needs the signing secret of one webhook endpoint, and it verifies every event with it.

## Setup (5 minutes)

### 1. Create a webhook endpoint in Stripe

In the Stripe Dashboard, open **Developers → Webhooks → Add endpoint**. Start in **test mode**. Use your project's endpoint URL, which is shown on the **Stripe** page of the Keyvane dashboard:

```text
https://keyvane.example.com/v1/webhooks/stripe/<your project id>
```

Select these events:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.updated
invoice.paid
invoice.payment_failed
```

### 2. Paste the signing secret into Keyvane

On the endpoint page in Stripe, click **Reveal signing secret** (`whsec_…`) and paste it on Keyvane's **Stripe** page. It is stored encrypted.

### 3. Map Stripe prices to plans

Open **Products & plans**, edit each paid plan and add its **Stripe price IDs** (`price_…`). Add both the monthly and the yearly price if you have them. A price can belong to only one plan.

When a subscription contains a mapped price, its customer gets that plan. If a subscription contains prices of several plans, the highest-ranked plan wins.

### 4. Tell Keyvane which of your users paid

Keyvane identifies customers by **your** user ID. Pass it to Stripe in one of these ways:

**Payment Links** (no code): append `client_reference_id` to the link you show a signed-in user.

```text
https://buy.stripe.com/test_abc123?client_reference_id=user_42&prefilled_email=alex%40example.com
```

**Checkout Sessions** (server-side):

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items: [{ price: 'price_pro_monthly', quantity: 1 }],
  client_reference_id: user.id,
  subscription_data: { metadata: { keyvane_customer_id: user.id } },
  success_url: 'https://yourapp.com/billing?success=1',
  cancel_url: 'https://yourapp.com/billing',
});
```

**Subscriptions created with the API**: set `metadata.keyvane_customer_id` on the subscription.

If you pass nothing, Keyvane still creates a license, linked to a customer that is identified only by the Stripe customer ID. That works for license-key products, but entitlement checks by your user ID will not find it.

## Testing

### Without a Stripe account: the simulator

```bash
npm run stripe:simulate -- subscribe --customer user_42 --plan pro
npm run stripe:simulate -- past-due  --customer user_42
npm run stripe:simulate -- cancel    --customer user_42
```

The simulator sends correctly signed, realistic events to your running server. See `npm run stripe:simulate` for all actions.

### With Stripe test mode

1. Create a product and price in Stripe test mode, map the price ID to a plan in Keyvane.
2. Create a Payment Link for that price.
3. Open the link with `?client_reference_id=user_42` and pay with card `4242 4242 4242 4242`.
4. Within seconds, `GET /v1/entitlements?customer=user_42` returns the paid plan.

For local development, the Stripe CLI can forward events to your machine:

```bash
stripe listen --forward-to localhost:8787/v1/webhooks/stripe/<project id>
```

The CLI prints its own signing secret (`whsec_…`). Paste that one into Keyvane while you test locally.

> `stripe trigger customer.subscription.created` creates a subscription with a throwaway price that is not mapped to any plan. Keyvane records the event as **ignored** and tells you which price is missing. Map it and click **Reprocess**.

## How Stripe states become access

| Stripe subscription status | Access |
|---|---|
| `active`, `trialing` | ✅ The mapped plan |
| `active` with `cancel_at_period_end` | ✅ Until the period ends, then ❌ (even if the final event never arrives) |
| `past_due` | ✅ During the product's **grace period** (default 7 days from the first failure), then ❌ |
| `unpaid` | ❌ |
| `canceled` | ❌ immediately (policy `immediate`), or ✅ until the paid period ends (policy `period_end`). Subscriptions canceled after failed payments always lose access immediately. |
| `incomplete`, `incomplete_expired`, `paused` | ❌ |

When access ends, the customer falls back to the product's default plan (for example, Free). Upgrades and downgrades change the plan of the existing license, and usage already counted this period is kept.

## Reliability guarantees

Mistakes in subscription handling cost real money or lock out paying customers, so the sync is built defensively:

- **Verified.** Every request is checked against the `Stripe-Signature` header (HMAC-SHA256) with a 5-minute timestamp tolerance. Unsigned or forged requests are rejected with `400` and never stored.
- **Stored.** Every verified event is saved with its payload and outcome under **Stripe → Events**.
- **Idempotent.** Stripe can deliver an event more than once. Duplicates are acknowledged with `200` and not applied again.
- **Atomic.** Each event is applied in a database transaction: all of its effects land, or none do.
- **Order-safe.** Stripe does not guarantee delivery order. Keyvane applies a subscription snapshot only if it is newer than the last one it applied, breaks same-second ties by lifecycle order (`incomplete` → `active` → `canceled`), and never revives an ended subscription.
- **Retried.** If processing fails, Keyvane responds `500` and Stripe retries with backoff for up to three days. You can also **Reprocess** any failed or ignored event from the dashboard once you have fixed the cause (for example, a missing price mapping).
- **Time-based without cron.** Grace periods, scheduled cancellations and expirations are evaluated at request time, so they take effect even if no further webhook arrives.

## Existing subscribers

Keyvane does not import past subscriptions. Existing subscribers are picked up the next time Stripe sends an event for their subscription (at the latest at renewal). To link them sooner, add `keyvane_customer_id` to each subscription's metadata in Stripe. That sends `customer.subscription.updated`, which links and syncs the subscription right away.

## Limitations in this version

- Only subscriptions are handled. One-time payments (`mode: payment`) are acknowledged but ignored; issue licenses for them with the API or dashboard for now.
- One Stripe account per project. Use separate projects for test mode and live mode.
- Stripe is the only payment provider today. Others are on the [roadmap](roadmap.md). Your app talks to Keyvane's entitlements rather than to the provider, so adding one will not change your code.
