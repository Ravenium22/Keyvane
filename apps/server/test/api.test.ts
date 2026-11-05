import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { createTestCtx, seed, signedRequest, stripeEvent, stripeSubscription, type Seeded, type TestCtx } from './helpers.ts';

type Json = Record<string, any>;

async function setup() {
  const ctx = createTestCtx();
  const s = await seed(ctx);
  const app = createApp(ctx);
  const call = async (method: string, path: string, opts: { key?: string | null; body?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const key = opts.key === undefined ? s.secretKey : opts.key;
    if (key) headers.authorization = `Bearer ${key}`;
    let body: string | undefined;
    if (opts.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await app.request(path, { method, headers, body });
    const text = await res.text();
    let json: Json = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json, headers: res.headers };
  };
  return { ctx, s, app, call };
}

describe('REST API: authentication', () => {
  it('requires a valid key and the right key type', async () => {
    const { s, call } = await setup();
    assert.equal((await call('GET', '/v1/products', { key: null })).status, 401);
    const bad = await call('GET', '/v1/products', { key: 'kv_sk_nope' });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error.type, 'authentication_error');
    const publishable = await call('GET', '/v1/entitlements?customer=u', { key: s.publishableKey });
    assert.equal(publishable.status, 403);
    assert.equal(publishable.json.error.code, 'secret_key_required');
    assert.equal((await call('GET', '/v1/products')).status, 200);
  });

  it('returns JSON 404s and request ids', async () => {
    const { call } = await setup();
    const res = await call('GET', '/v1/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, 'route_not_found');
    assert.match(res.headers.get('x-request-id') ?? '', /^req_/);
  });
});

describe('REST API: catalog, customers and entitlements', () => {
  it('lists products with plans, features and the entitlement matrix', async () => {
    const { call } = await setup();
    const res = await call('GET', '/v1/products');
    const product = res.json.data[0];
    assert.equal(product.key, 'pdf-analyzer');
    assert.equal(product.default_plan, 'free');
    assert.deepEqual(product.plans.map((p: Json) => p.key), ['free', 'pro', 'business']);
    assert.deepEqual(product.plans[1].entitlements.pdf_analysis, { enabled: true, limit: 500 });
    assert.equal((await call('GET', '/v1/products/pdf-analyzer')).json.id, product.id);
  });

  it('upserts customers and resolves entitlements by your own user id', async () => {
    const { call } = await setup();
    const created = await call('POST', '/v1/customers', { body: { external_id: 'user_42', email: 'alex@example.com', metadata: { team: 'core' } } });
    assert.equal(created.status, 201);
    const again = await call('POST', '/v1/customers', { body: { external_id: 'user_42', name: 'Alex' } });
    assert.equal(again.status, 200);
    assert.equal(again.json.id, created.json.id);
    assert.equal(again.json.name, 'Alex');
    assert.equal((await call('GET', '/v1/customers/user_42')).json.email, 'alex@example.com');
    assert.equal((await call('GET', '/v1/customers?external_id=user_42')).json.data.length, 1);

    const ent = await call('GET', '/v1/entitlements?customer=user_42');
    assert.equal(ent.json.object, 'entitlements');
    assert.equal(ent.json.plan.key, 'free');
    assert.equal(ent.json.source, 'default_plan');
    assert.deepEqual(ent.json.features.export, { name: 'Export to Markdown', type: 'boolean', enabled: false });
    assert.equal(ent.json.features.pdf_analysis.remaining, 10);

    const unknown = await call('GET', '/v1/entitlements?customer=nobody');
    assert.deepEqual(unknown.json.customer, { id: null, external_id: 'nobody', email: null });

    const check = await call('GET', '/v1/entitlements/check?customer=user_42&feature=export');
    assert.equal(check.json.allowed, false);
    assert.equal(check.json.code, 'not_included');
    const missing = await call('GET', '/v1/entitlements/check?customer=user_42&feature=nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'feature_not_found');
  });

  it('validates input with helpful errors', async () => {
    const { call } = await setup();
    const res = await call('GET', '/v1/entitlements');
    assert.equal(res.status, 400);
    assert.equal(res.json.error.param, 'customer');
    const badJson = await call('POST', '/v1/customers', { body: undefined, headers: { 'content-type': 'application/json' } });
    assert.equal(badJson.status, 400);
  });
});

describe('REST API: customer deletion', () => {
  it('deletes a customer, their licenses and usage', async () => {
    const { call } = await setup();
    await call('POST', '/v1/licenses', { body: { plan: 'pro', customer: 'user_del' } });
    await call('POST', '/v1/usage', { body: { customer: 'user_del', feature: 'pdf_analysis', quantity: 3 } });
    const res = await call('DELETE', '/v1/customers/user_del');
    assert.equal(res.status, 200);
    assert.equal(res.json.deleted, true);
    assert.equal((await call('GET', '/v1/customers/user_del')).status, 404);
    assert.equal((await call('GET', '/v1/licenses?customer=user_del')).json.data.length, 0);
    const fresh = await call('GET', '/v1/entitlements?customer=user_del');
    assert.equal(fresh.json.plan.key, 'free');
    assert.equal(fresh.json.features.pdf_analysis.used, 0);
  });
});

describe('REST API: usage', () => {
  it('meters usage and denies over the limit (JSON and form bodies)', async () => {
    const { call } = await setup();
    const first = await call('POST', '/v1/usage', { body: { customer: 'user_1', feature: 'pdf_analysis', quantity: 9 } });
    assert.equal(first.status, 200);
    assert.equal(first.json.allowed, true);
    assert.equal(first.json.feature.remaining, 1);
    const second = await call('POST', '/v1/usage', { form: { customer: 'user_1', feature: 'pdf_analysis', quantity: '2' } });
    assert.equal(second.json.allowed, false);
    assert.equal(second.json.code, 'limit_exceeded');
    const replay1 = await call('POST', '/v1/usage', { body: { customer: 'user_1', feature: 'pdf_analysis' }, headers: { 'idempotency-key': 'abc' } });
    const replay2 = await call('POST', '/v1/usage', { body: { customer: 'user_1', feature: 'pdf_analysis' }, headers: { 'idempotency-key': 'abc' } });
    assert.equal(replay1.json.replayed, false);
    assert.equal(replay2.json.replayed, true);
    assert.equal(replay2.json.feature.used, 10);
  });
});

describe('REST API: licenses', () => {
  it('creates, validates, activates and revokes license keys', async () => {
    const { s, call } = await setup();
    const created = await call('POST', '/v1/licenses', { body: { plan: 'pro', customer: 'user_9', duration_days: 30, note: 'beta tester', metadata: { edition: 'early' } } });
    assert.equal(created.status, 201);
    const license = created.json;
    assert.equal(license.plan.key, 'pro');
    assert.equal(license.status, 'active');
    assert.equal(license.max_activations, 3);
    assert.equal(license.note, 'beta tester');

    // Publishable key: validate + activate + deactivate, CORS enabled, internal note hidden.
    const validation = await call('POST', '/v1/licenses/validate', { key: s.publishableKey, body: { key: license.key }, headers: { origin: 'https://app.example' } });
    assert.equal(validation.json.valid, true);
    assert.equal(validation.json.license.note, undefined);
    assert.equal(validation.json.entitlements.plan.key, 'pro');
    assert.equal(validation.json.entitlements.features.export.enabled, true);
    assert.equal(validation.headers.get('access-control-allow-origin'), '*');

    const activation = await call('POST', '/v1/licenses/activate', { key: s.publishableKey, body: { key: license.key, fingerprint: 'device-1', name: 'MacBook' } });
    assert.equal(activation.json.valid, true);
    assert.equal(activation.json.activation.fingerprint, 'device-1');
    assert.equal((await call('POST', '/v1/licenses/validate', { key: s.publishableKey, body: { key: license.key, fingerprint: 'device-2' } })).json.code, 'not_activated');
    assert.equal((await call('POST', '/v1/licenses/deactivate', { key: s.publishableKey, body: { key: license.key, fingerprint: 'device-1' } })).json.deactivated, true);

    // Management requires a secret key.
    assert.equal((await call('POST', '/v1/licenses', { key: s.publishableKey, body: { plan: 'pro' } })).status, 403);
    const listed = await call('GET', '/v1/licenses?customer=user_9');
    assert.equal(listed.json.data.length, 1);
    const updated = await call('PATCH', `/v1/licenses/${license.id}`, { body: { plan: 'business', max_activations: 5 } });
    assert.equal(updated.json.plan.key, 'business');
    assert.equal(updated.json.max_activations, 5);

    const revoked = await call('POST', `/v1/licenses/${license.id}/revoke`, { body: { reason: 'refund' } });
    assert.equal(revoked.json.status, 'revoked');
    assert.equal(revoked.json.valid, false);
    const after = await call('POST', '/v1/licenses/validate', { key: s.publishableKey, body: { key: license.key } });
    assert.equal(after.json.valid, false);
    assert.equal(after.json.code, 'revoked');
    assert.equal(after.json.entitlements, null);
    const reinstate = await call('POST', `/v1/licenses/${license.id}/reinstate`);
    assert.equal(reinstate.status, 409);
  });

  it('answers CORS preflight for license endpoints', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/licenses/validate', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('rate-limits publishable-key license checks per client', async () => {
    const ctx = createTestCtx();
    ctx.config.rateLimits.publicLicense = 3;
    const s = await seed(ctx);
    const app = createApp(ctx);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.request('/v1/licenses/validate', {
        method: 'POST',
        headers: { authorization: `Bearer ${s.publishableKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'KV-AAAAA-BBBBB-CCCCC-DDDDD' }),
      });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});

describe('REST API: Stripe webhook endpoint', () => {
  async function post(app: ReturnType<typeof createApp>, ctx: TestCtx, s: Seeded, event: unknown, signature?: string) {
    const signed = signedRequest(ctx, event);
    return app.request(`/v1/webhooks/stripe/${s.project.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature ?? signed.signature },
      body: signed.payload,
    });
  }

  it('accepts signed events over HTTP and rejects forged ones', async () => {
    const { ctx, s, app, call } = await setup();
    const event = stripeEvent(ctx, 'customer.subscription.created', stripeSubscription(ctx, { metadata: { keyvane_customer_id: 'user_5' } }));
    const forged = await post(app, ctx, s, event, 't=1,v1=deadbeef');
    assert.equal(forged.status, 400);
    const ok = await post(app, ctx, s, event);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as Json).status, 'processed');
    const ent = await call('GET', '/v1/entitlements?customer=user_5');
    assert.equal(ent.json.plan.key, 'pro');
    assert.equal(ent.json.subscription.status, 'active');
  });
});
