import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../../apps/server/src/app.ts';
import { createTestCtx, seed, signedRequest, stripeEvent, stripeSubscription } from '../../../apps/server/test/helpers.ts';
import {
  Entitlements,
  Keyvane,
  KeyvaneAuthenticationError,
  KeyvaneConnectionError,
  KeyvaneError,
  KeyvaneNotFoundError,
  KeyvanePermissionError,
} from '../src/index.ts';

async function setup() {
  const ctx = createTestCtx();
  const s = await seed(ctx);
  const app = createApp(ctx);
  const fetch = (input: string, init?: RequestInit) => app.request(input, init);
  const server = new Keyvane({ apiKey: s.secretKey, baseUrl: 'http://keyvane.test', fetch });
  const desktop = new Keyvane({ apiKey: s.publishableKey, baseUrl: 'http://keyvane.test/', fetch });
  return { ctx, s, app, server, desktop };
}

describe('SDK against a real Keyvane server', () => {
  it('reads entitlements with friendly helpers', async () => {
    const { server } = await setup();
    await server.customers.upsert({ externalId: 'user_42', email: 'alex@example.com' });
    const access = await server.entitlements.get({ customer: 'user_42' });
    assert.ok(access instanceof Entitlements);
    assert.equal(access.plan?.key, 'free');
    assert.equal(access.isOnPlan('free'), true);
    assert.equal(access.can('export'), false);
    assert.equal(access.can('pdf_analysis'), true);
    assert.equal(access.can('pdf_analysis', 11), false);
    assert.equal(access.remaining('pdf_analysis'), 10);
    assert.equal(access.limit('pdf_analysis'), 10);
    assert.equal(access.remaining('export'), 0);
    assert.equal(access.can('does_not_exist'), false);
  });

  it('records usage until the limit and reports it without throwing', async () => {
    const { server } = await setup();
    const first = await server.usage.record({ customer: 'user_1', feature: 'pdf_analysis', quantity: 10, idempotencyKey: 'job-1' });
    assert.equal(first.allowed, true);
    assert.equal(first.feature.type === 'metered' ? first.feature.remaining : -1, 0);
    const replay = await server.usage.record({ customer: 'user_1', feature: 'pdf_analysis', quantity: 10, idempotencyKey: 'job-1' });
    assert.equal(replay.replayed, true);
    const denied = await server.usage.record({ customer: 'user_1', feature: 'pdf_analysis' });
    assert.equal(denied.allowed, false);
    assert.equal(denied.code, 'limit_exceeded');
    const check = await server.entitlements.check({ customer: 'user_1', feature: 'pdf_analysis' });
    assert.equal(check.allowed, false);
  });

  it('manages and validates license keys (desktop flow with a publishable key)', async () => {
    const { server, desktop } = await setup();
    const license = await server.licenses.create({ plan: 'pro', customer: 'user_9', durationDays: 365, maxActivations: 1, note: 'Desktop beta' });
    assert.equal(license.plan?.key, 'pro');

    const activation = await desktop.licenses.activate({ key: license.key, fingerprint: 'machine-a', name: 'Studio Mac' });
    assert.equal(activation.valid, true);
    assert.equal(activation.license?.note, undefined, 'notes are hidden from publishable keys');
    assert.equal(activation.entitlements?.can('export'), true);

    const second = await desktop.licenses.activate({ key: license.key, fingerprint: 'machine-b' });
    assert.equal(second.valid, false);
    assert.equal(second.code, 'activation_limit_reached');

    const validation = await desktop.licenses.validate({ key: license.key, fingerprint: 'machine-a' });
    assert.equal(validation.valid, true);
    assert.equal((await desktop.licenses.deactivate({ key: license.key, fingerprint: 'machine-a' })).deactivated, true);

    const revoked = await server.licenses.revoke(license.id, { reason: 'chargeback' });
    assert.equal(revoked.status, 'revoked');
    const after = await desktop.licenses.validate({ key: license.key });
    assert.equal(after.valid, false);
    assert.equal(after.code, 'revoked');
    assert.equal(after.entitlements, null);

    const list = await server.licenses.list({ customer: 'user_9' });
    assert.equal(list.data.length, 1);
    assert.equal((await server.products.retrieve('pdf-analyzer')).plans.length, 3);
  });

  it('reflects a Stripe purchase immediately', async () => {
    const { ctx, s, app, server } = await setup();
    const event = stripeEvent(ctx, 'customer.subscription.created', stripeSubscription(ctx, { metadata: { keyvane_customer_id: 'user_77' } }));
    const { payload, signature } = signedRequest(ctx, event);
    const res = await app.request(`/v1/webhooks/stripe/${s.project.id}`, { method: 'POST', headers: { 'stripe-signature': signature, 'content-type': 'application/json' }, body: payload });
    assert.equal(res.status, 200);
    const access = await server.entitlements.get({ customer: 'user_77' });
    assert.equal(access.plan?.key, 'pro');
    assert.equal(access.subscription?.status, 'active');
    assert.equal(access.remaining('pdf_analysis'), 500);
  });

  it('throws typed errors', async () => {
    const { s, app, desktop, server } = await setup();
    await assert.rejects(desktop.entitlements.get({ customer: 'u' }), KeyvanePermissionError);
    const wrong = new Keyvane({ apiKey: 'kv_sk_wrong', baseUrl: 'http://keyvane.test', fetch: (i, init) => app.request(i, init) });
    await assert.rejects(wrong.products.list(), (err: unknown) => {
      assert.ok(err instanceof KeyvaneAuthenticationError);
      assert.equal(err.status, 401);
      assert.match(err.requestId ?? '', /^req_/);
      return true;
    });
    await assert.rejects(server.entitlements.check({ customer: 'u', feature: 'nope' }), (err: unknown) => {
      assert.ok(err instanceof KeyvaneNotFoundError);
      assert.equal(err.code, 'feature_not_found');
      return true;
    });
    assert.ok(s.project.id);
  });
});

describe('SDK transport', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('requires an API key and a base URL', () => {
    assert.throws(() => new Keyvane({ baseUrl: 'http://x' }), KeyvaneError);
    assert.throws(() => new Keyvane({ apiKey: 'kv_sk_x' }), /base URL/);
  });

  it('retries safe requests on 5xx and network errors, then succeeds', async () => {
    let calls = 0;
    const kv = new Keyvane({
      apiKey: 'kv_sk_x',
      baseUrl: 'http://x',
      fetch: async () => {
        calls++;
        if (calls === 1) throw new TypeError('socket hang up');
        if (calls === 2) return ok({ error: { message: 'boom' } }, 503);
        return ok({ object: 'list', data: [], has_more: false });
      },
    });
    const list = await kv.products.list();
    assert.equal(calls, 3);
    assert.deepEqual(list.data, []);
  });

  it('does not retry non-idempotent writes', async () => {
    let calls = 0;
    const kv = new Keyvane({ apiKey: 'kv_sk_x', baseUrl: 'http://x', fetch: async () => (calls++, ok({ error: { message: 'boom' } }, 500)) });
    await assert.rejects(kv.usage.record({ customer: 'u', feature: 'f' }));
    assert.equal(calls, 1);
  });

  it('times out slow requests', async () => {
    const kv = new Keyvane({
      apiKey: 'kv_sk_x',
      baseUrl: 'http://x',
      timeoutMs: 20,
      maxRetries: 0,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    });
    await assert.rejects(kv.products.list(), (err: unknown) => err instanceof KeyvaneConnectionError && /did not respond/.test(err.message));
  });

  it('sends snake_case bodies and caches entitlements when asked', async () => {
    const seen: { url: string; body?: string; headers?: HeadersInit }[] = [];
    const entitlements = { object: 'entitlements', customer: null, product: { id: 'p', key: 'p', name: 'P' }, plan: null, source: 'none', license: null, subscription: null, features: {}, checked_at: '' };
    const kv = new Keyvane({
      apiKey: 'kv_sk_x',
      baseUrl: 'http://x',
      cacheTtlMs: 60_000,
      fetch: async (url, init) => {
        seen.push({ url, body: init?.body as string | undefined, headers: init?.headers });
        return ok(url.includes('/usage') ? { object: 'usage', allowed: true } : entitlements);
      },
    });
    await kv.entitlements.get({ customer: 'u1' });
    await kv.entitlements.get({ customer: 'u1' });
    assert.equal(seen.length, 1, 'second call served from cache');
    await kv.usage.record({ customer: 'u1', feature: 'f', idempotencyKey: 'k1' });
    assert.deepEqual(JSON.parse(seen[1]?.body ?? '{}'), { customer: 'u1', feature: 'f', idempotency_key: 'k1' });
    assert.equal((seen[1]?.headers as Record<string, string>)['Idempotency-Key'], 'k1');
    await kv.entitlements.get({ customer: 'u1' });
    assert.equal(seen.length, 3, 'recording usage invalidates the cache');
    assert.equal(seen[0]?.url, 'http://x/v1/entitlements?customer=u1');
  });
});
