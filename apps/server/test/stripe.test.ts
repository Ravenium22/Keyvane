import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCustomerEntitlements } from '../src/services/entitlements.ts';
import { upsertCustomer } from '../src/services/customers.ts';
import { updatePlan, updateProduct } from '../src/services/catalog.ts';
import { signStripePayload, verifyStripeSignature } from '../src/services/stripe/signature.ts';
import { listWebhookEvents, receiveStripeWebhook, reprocessWebhookEvent } from '../src/services/stripe/webhooks.ts';
import type { LicenseRow, SubscriptionRow } from '../src/types.ts';
import {
  createTestCtx,
  seed,
  signedRequest,
  stripeEvent,
  stripeSubscription,
  systemActor,
  WEBHOOK_SECRET,
  type Seeded,
  type SubscriptionOptions,
  type TestCtx,
} from './helpers.ts';

function deliver(ctx: TestCtx, s: Seeded, event: unknown) {
  const { payload, signature } = signedRequest(ctx, event);
  return receiveStripeWebhook(ctx, s.project.id, payload, signature);
}

function subscriptionEvent(ctx: TestCtx, type: string, opts: SubscriptionOptions = {}, created?: number) {
  return stripeEvent(ctx, `customer.subscription.${type}`, stripeSubscription(ctx, opts), created ? { created } : {});
}

function planOf(ctx: TestCtx, s: Seeded, customer: string) {
  return resolveCustomerEntitlements(ctx, s.project.id, { customer }).plan?.key;
}

describe('stripe signature verification', () => {
  const payload = JSON.stringify({ id: 'evt_1' });
  const now = new Date('2026-11-05T12:00:00Z');
  const ts = Math.floor(now.getTime() / 1000);

  it('accepts a valid signature', () => {
    assert.deepEqual(verifyStripeSignature(payload, signStripePayload(payload, WEBHOOK_SECRET, ts), WEBHOOK_SECRET, { now }), {
      ok: true,
      timestamp: ts,
    });
  });

  it('accepts any matching v1 signature (secret rotation)', () => {
    const good = signStripePayload(payload, WEBHOOK_SECRET, ts).split(',')[1];
    const header = `t=${ts},v1=${'0'.repeat(64)},${good}`;
    assert.equal(verifyStripeSignature(payload, header, WEBHOOK_SECRET, { now }).ok, true);
  });

  it('rejects wrong secrets, tampered payloads, stale timestamps and junk headers', () => {
    const header = signStripePayload(payload, WEBHOOK_SECRET, ts);
    assert.equal(verifyStripeSignature(payload, header, 'whsec_other', { now }).ok, false);
    assert.equal(verifyStripeSignature(payload + ' ', header, WEBHOOK_SECRET, { now }).ok, false);
    const old = signStripePayload(payload, WEBHOOK_SECRET, ts - 301);
    assert.match(String((verifyStripeSignature(payload, old, WEBHOOK_SECRET, { now }) as { reason: string }).reason), /tolerance/);
    assert.equal(verifyStripeSignature(payload, 'garbage', WEBHOOK_SECRET, { now }).ok, false);
    assert.equal(verifyStripeSignature(payload, null, WEBHOOK_SECRET, { now }).ok, false);
  });
});

describe('stripe webhook endpoint', () => {
  it('rejects bad signatures and unconnected projects', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const event = subscriptionEvent(ctx, 'created');
    const { payload } = signedRequest(ctx, event);
    const bad = receiveStripeWebhook(ctx, s.project.id, payload, signStripePayload(payload, 'whsec_wrong', ctx.clock.unix()));
    assert.equal(bad.status, 400);
    assert.equal((bad.body.error as { code: string }).code, 'invalid_signature');
    assert.equal(receiveStripeWebhook(ctx, 'proj_missing', payload, 'x').status, 404);
    // Nothing was stored for rejected requests.
    assert.equal(listWebhookEvents(ctx, s.project.id).data.length, 0);
  });

  it('creates a license on purchase and updates access on upgrade, downgrade and cancellation', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    upsertCustomer(ctx, s.project.id, { externalId: 'user_42', email: 'alex@example.com' }, systemActor);
    const meta = { keyvane_customer_id: 'user_42' };

    assert.equal(planOf(ctx, s, 'user_42'), 'free');
    let res = deliver(ctx, s, subscriptionEvent(ctx, 'created', { metadata: meta }));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'processed');
    assert.equal(planOf(ctx, s, 'user_42'), 'pro');

    const license = ctx.db.get<LicenseRow>('SELECT * FROM licenses');
    assert.equal(license?.source, 'stripe');
    assert.equal(license?.max_activations, 3);

    ctx.clock.advanceSeconds(60);
    res = deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, price: 'price_demo_business_monthly' }));
    assert.equal(res.body.status, 'processed');
    assert.equal(planOf(ctx, s, 'user_42'), 'business');
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses')?.n, 1, 'upgrade reuses the license');

    ctx.clock.advanceSeconds(60);
    deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, price: 'price_demo_pro_yearly' }));
    assert.equal(planOf(ctx, s, 'user_42'), 'pro');

    ctx.clock.advanceSeconds(60);
    deliver(ctx, s, subscriptionEvent(ctx, 'deleted', { metadata: meta, status: 'canceled', canceledAt: ctx.clock.unix(), endedAt: ctx.clock.unix() }));
    assert.equal(planOf(ctx, s, 'user_42'), 'free', 'immediate policy: access ends with the subscription');
  });

  it('is idempotent for duplicate deliveries', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const event = subscriptionEvent(ctx, 'created', { metadata: { keyvane_customer_id: 'user_1' } });
    assert.equal(deliver(ctx, s, event).body.status, 'processed');
    const again = deliver(ctx, s, event);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses')?.n, 1);
    assert.equal(listWebhookEvents(ctx, s.project.id).data.length, 1);
  });

  it('ignores out-of-order snapshots and never resurrects a canceled subscription', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const meta = { keyvane_customer_id: 'user_1' };
    const t0 = ctx.clock.unix();
    const created = subscriptionEvent(ctx, 'created', { metadata: meta }, t0);
    const updated = subscriptionEvent(ctx, 'updated', { metadata: meta, price: 'price_demo_business_monthly' }, t0 + 10);
    const deleted = subscriptionEvent(ctx, 'deleted', { metadata: meta, status: 'canceled', endedAt: t0 + 20, canceledAt: t0 + 20 }, t0 + 20);

    ctx.clock.advanceSeconds(30);
    deliver(ctx, s, updated);
    assert.equal(planOf(ctx, s, 'user_1'), 'business');
    const stale = deliver(ctx, s, created);
    assert.equal(stale.body.status, 'ignored');
    assert.match(String(stale.body.message), /Out-of-order/);
    assert.equal(planOf(ctx, s, 'user_1'), 'business', 'older snapshot must not downgrade');

    deliver(ctx, s, deleted);
    assert.equal(planOf(ctx, s, 'user_1'), 'free');
    const late = deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, status: 'active' }, t0 + 15));
    assert.equal(late.body.status, 'ignored');
    assert.equal(planOf(ctx, s, 'user_1'), 'free');
  });

  it('resolves same-second races by lifecycle order (incomplete → active)', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const meta = { keyvane_customer_id: 'user_1' };
    const t = ctx.clock.unix();
    deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, status: 'active' }, t));
    const created = deliver(ctx, s, subscriptionEvent(ctx, 'created', { metadata: meta, status: 'incomplete' }, t));
    assert.equal(created.body.status, 'ignored');
    assert.equal(planOf(ctx, s, 'user_1'), 'pro');
  });

  it('keeps access during the grace period after a failed payment', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const meta = { keyvane_customer_id: 'user_1' };
    deliver(ctx, s, subscriptionEvent(ctx, 'created', { metadata: meta }));
    ctx.clock.advanceSeconds(60);
    deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, status: 'past_due' }));
    assert.equal(planOf(ctx, s, 'user_1'), 'pro');
    const snap = resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' });
    assert.equal(snap.licenseState?.status, 'past_due');

    ctx.clock.advanceDays(6);
    deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, status: 'past_due' }));
    assert.equal(planOf(ctx, s, 'user_1'), 'pro', 'grace period counts from the first failure');
    ctx.clock.advanceDays(2);
    assert.equal(planOf(ctx, s, 'user_1'), 'free', 'grace period (7 days) is over');

    deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, status: 'active' }));
    assert.equal(planOf(ctx, s, 'user_1'), 'pro', 'payment recovered');
    const sub = ctx.db.get<SubscriptionRow>('SELECT * FROM subscriptions');
    assert.equal(sub?.past_due_since, null);
  });

  it('honours the period_end cancellation policy, except after failed payments', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    updateProduct(ctx, s.project.id, s.product.id, { cancellationPolicy: 'period_end' }, systemActor);
    const meta = { keyvane_customer_id: 'user_1' };
    const start = ctx.clock.unix();
    const end = start + 30 * 86400;
    deliver(ctx, s, subscriptionEvent(ctx, 'created', { metadata: meta, periodStart: start, periodEnd: end }));
    ctx.clock.advanceDays(10);
    deliver(
      ctx,
      s,
      subscriptionEvent(ctx, 'deleted', { metadata: meta, status: 'canceled', periodStart: start, periodEnd: end, endedAt: ctx.clock.unix() }),
    );
    assert.equal(planOf(ctx, s, 'user_1'), 'pro', 'paid-for period continues');
    ctx.clock.advanceDays(21);
    assert.equal(planOf(ctx, s, 'user_1'), 'free');

    // Second customer: payment failed, then Stripe canceled → no extra access.
    const meta2 = { keyvane_customer_id: 'user_2' };
    const start2 = ctx.clock.unix();
    const sub2 = { id: 'sub_test_2', customer: 'cus_test_2', metadata: meta2, periodStart: start2, periodEnd: start2 + 30 * 86400 };
    deliver(ctx, s, subscriptionEvent(ctx, 'created', sub2));
    ctx.clock.advanceSeconds(60);
    deliver(ctx, s, subscriptionEvent(ctx, 'updated', { ...sub2, status: 'past_due' }));
    ctx.clock.advanceSeconds(60);
    deliver(ctx, s, subscriptionEvent(ctx, 'deleted', { ...sub2, status: 'canceled', endedAt: ctx.clock.unix() }));
    assert.equal(planOf(ctx, s, 'user_2'), 'free');
  });

  it('stops access at the scheduled end even if the final event never arrives', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const meta = { keyvane_customer_id: 'user_1' };
    const end = ctx.clock.unix() + 5 * 86400;
    deliver(ctx, s, subscriptionEvent(ctx, 'updated', { metadata: meta, cancelAtPeriodEnd: true, periodEnd: end }));
    assert.equal(planOf(ctx, s, 'user_1'), 'pro');
    ctx.clock.advanceDays(6);
    assert.equal(planOf(ctx, s, 'user_1'), 'free');
  });

  it('supports the legacy subscription shape (billing period on the subscription)', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    deliver(ctx, s, subscriptionEvent(ctx, 'created', { metadata: { keyvane_customer_id: 'u' }, periodOnItems: false }));
    const sub = ctx.db.get<SubscriptionRow>('SELECT * FROM subscriptions');
    assert.ok(sub?.current_period_end);
    assert.equal(sub?.amount, 1200);
    assert.equal(sub?.billing_interval, 'month');
  });

  it('links Payment Link checkouts via client_reference_id, in either order', async () => {
    for (const order of ['checkout-first', 'subscription-first'] as const) {
      const ctx = createTestCtx();
      const s = await seed(ctx);
      // The app registered its user before checkout and the user had used the free plan.
      upsertCustomer(ctx, s.project.id, { externalId: 'user_7' }, systemActor);
      const checkout = stripeEvent(ctx, 'checkout.session.completed', {
        id: 'cs_test_1',
        object: 'checkout.session',
        mode: 'subscription',
        customer: 'cus_test_1',
        subscription: 'sub_test_1',
        client_reference_id: 'user_7',
        customer_details: { email: 'buyer@example.com', name: 'Buyer' },
      });
      const created = subscriptionEvent(ctx, 'created'); // no metadata, like a Payment Link
      if (order === 'checkout-first') {
        deliver(ctx, s, checkout);
        deliver(ctx, s, created);
      } else {
        deliver(ctx, s, created);
        deliver(ctx, s, checkout);
      }
      assert.equal(planOf(ctx, s, 'user_7'), 'pro', order);
      const customers = ctx.db.all<{ external_id: string | null; email: string | null; stripe_customer_id: string | null }>(
        'SELECT external_id, email, stripe_customer_id FROM customers',
      );
      assert.equal(customers.length, 1, `${order}: duplicate customers were merged`);
      assert.deepEqual({ ...customers[0] }, { external_id: 'user_7', email: 'buyer@example.com', stripe_customer_id: 'cus_test_1' });
    }
  });

  it('marks events with unmapped prices as ignored and lets you reprocess them after mapping', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const res = deliver(ctx, s, subscriptionEvent(ctx, 'created', { metadata: { keyvane_customer_id: 'u' }, price: 'price_unknown' }));
    assert.equal(res.body.status, 'ignored');
    assert.match(String(res.body.message), /No Keyvane plan is mapped to Stripe price price_unknown/);
    assert.equal(planOf(ctx, s, 'u'), 'free');

    updatePlan(ctx, s.project.id, s.plans.business.id, { stripePriceIds: ['price_demo_business_monthly', 'price_unknown'] }, systemActor);
    const event = listWebhookEvents(ctx, s.project.id).data[0];
    assert.ok(event);
    const result = reprocessWebhookEvent(ctx, s.project.id, event.id, systemActor);
    assert.equal(result.status, 'processed');
    assert.equal(planOf(ctx, s, 'u'), 'business');
    assert.throws(() => reprocessWebhookEvent(ctx, s.project.id, event.id, systemActor), /already processed/);
  });

  it('records failures (HTTP 500) so Stripe retries', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const res = deliver(ctx, s, stripeEvent(ctx, 'customer.subscription.created', { object: 'subscription' }));
    assert.equal(res.status, 500);
    const [event] = listWebhookEvents(ctx, s.project.id).data;
    assert.equal(event?.status, 'failed');
    assert.equal(event?.attempts, 1);
  });

  it('acknowledges events Keyvane does not use', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const res = deliver(ctx, s, stripeEvent(ctx, 'payment_intent.created', { id: 'pi_1', object: 'payment_intent' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ignored');
  });

  it('tracks revenue from paid invoices', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    deliver(ctx, s, stripeEvent(ctx, 'invoice.paid', { id: 'in_1', object: 'invoice', customer: 'cus_x', amount_paid: 1200, currency: 'usd' }));
    const row = ctx.db.get<{ value: number }>("SELECT value FROM daily_stats WHERE metric = 'revenue_usd'");
    assert.equal(row?.value, 1200);
  });
});

describe('failure alerts', () => {
  it('emails the project owner when an event fails, at most once an hour', async () => {
    const { testOutbox } = await import('../src/services/mailer.ts');
    testOutbox.length = 0;
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const broken = () => stripeEvent(ctx, 'customer.subscription.updated', { object: 'subscription' });
    assert.equal(deliver(ctx, s, broken()).status, 500);
    assert.equal(deliver(ctx, s, broken()).status, 500);
    assert.equal(testOutbox.length, 1, 'second failure within the hour is not emailed');
    assert.equal(testOutbox[0]?.to, s.user.email);
    assert.match(testOutbox[0]?.text ?? '', /reprocess it here:\nhttp:\/\/keyvane\.test\/app\/p\/proj_/);
    ctx.clock.advanceSeconds(3601);
    deliver(ctx, s, broken());
    assert.equal(testOutbox.length, 2);
  });
});
