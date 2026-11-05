# Seven Stripe webhook edge cases that silently break access

Most subscription bugs are not crashes. A customer pays and still sees the Free plan, or cancels and keeps Pro for months. These seven cases cause most of them. Each section says what happens, why, and how to handle it, whether you build it yourself or use Keyvane.

## 1. Events arrive out of order

Stripe [does not guarantee](https://docs.stripe.com/webhooks) that events arrive in the order they were created. An older `customer.subscription.updated` (status `active`) can land after `customer.subscription.deleted`, and a naive handler resurrects a canceled subscription.

**Handle it:** store the `created` timestamp of the last event you applied per subscription, and ignore older snapshots. Treat `canceled` and `incomplete_expired` as terminal: never move a subscription out of them.

**In Keyvane:** both rules are built in, and same-second ties are resolved by lifecycle order (`incomplete` → `active` → `canceled`).

## 2. The same event is delivered twice

Stripe can deliver an event more than once, for example after a timeout on your side. Handlers that increment counters, send emails or create records do it twice.

**Handle it:** record every `event.id` and acknowledge duplicates with `200` without applying them again. Do the work and the record in one database transaction.

**In Keyvane:** every event is stored. Duplicates return `{"duplicate": true}` and are never re-applied.

## 3. The subscription arrives before you know who paid

With Checkout and Payment Links, `customer.subscription.created` often arrives before `checkout.session.completed`, the only event that carries your `client_reference_id`. If you create the access record on the first event, you do not yet know which user it belongs to.

**Handle it:** create a customer keyed by the Stripe customer ID, and link it to your user when the checkout event arrives, in either order. If both records exist, merge them.

**In Keyvane:** customers are linked and merged automatically in any order. Usage already counted for the user is preserved.

## 4. "Cancel at period end" is not a cancellation yet

When a customer cancels in the Stripe portal, the subscription stays `active` with `cancel_at_period_end: true` until the period ends. Revoking access on that `updated` event takes away time they paid for. Waiting for `deleted` is right, but if that final event never reaches you, access never ends.

**Handle it:** keep access while `active`, and also stop it once `cancel_at` (or the period end) has passed, even without a final event.

**In Keyvane:** access is evaluated at request time, so a scheduled end applies on time with or without the last webhook.

## 5. Failed payments are a process, not a status

A failed renewal moves the subscription to `past_due` while Stripe retries for days, then to `canceled` or `unpaid`. Cutting access on the first failure punishes customers whose card simply expired. Keeping it until the final status gives away weeks of service.

**Handle it:** start a grace period at the **first** `past_due` event (not the latest one) and end access when it runs out. If you grant "access until the end of the paid period" on cancellation, do not apply it to subscriptions that were canceled for non-payment.

**In Keyvane:** a per-product grace period (7 days by default) counts from the first failure, and the `period_end` cancellation policy excludes non-payment.

## 6. The payload changed shape

In API version `2025-03-31`, Stripe moved `current_period_start` and `current_period_end` from the subscription to its items. Handlers written against older payloads read `undefined` and compute wrong renewal dates.

**Handle it:** read the field from the subscription and fall back to the items (or pin your endpoint's API version and test upgrades).

**In Keyvane:** both shapes are supported.

## 7. Signatures fail for reasons that look like bugs

Signature verification needs the **raw** request body. A body parser that re-serializes JSON changes a byte and every event fails. Each endpoint also has its own signing secret, and `stripe listen` prints a different one again.

**Handle it:** verify against the raw bytes with HMAC-SHA256, accept any `v1` signature in the header, reject timestamps older than a few minutes, and log which secret you expected.

**In Keyvane:** verification runs before anything is stored, and the dashboard explains which secret to paste.

## Bonus: unknown prices

A new price created in the Stripe dashboard but not mapped in your code grants nothing, and the event is quietly dropped. Store such events, surface them, and let yourself reprocess them after fixing the mapping. Keyvane marks them **ignored** with the missing price ID and offers a **Reprocess** button.

---

Keyvane implements all of the above so that your app only asks one question: [what may this customer do right now?](getting-started.md) The implementation is open for review in [`apps/server/src/services/stripe/webhooks.ts`](../apps/server/src/services/stripe/webhooks.ts), with tests for every case in [`apps/server/test/stripe.test.ts`](../apps/server/test/stripe.test.ts).
