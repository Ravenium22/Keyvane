import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkFeature, resolveCustomerEntitlements } from '../src/services/entitlements.ts';
import { activateLicense, createLicense, deactivateLicense, setLicenseStatus, validateLicense } from '../src/services/licenses.ts';
import { recordUsage } from '../src/services/usage.ts';
import { upsertCustomer } from '../src/services/customers.ts';
import { createTestCtx, seed, systemActor } from './helpers.ts';

describe('entitlements', () => {
  it('gives unknown customers the default (Free) plan without creating them', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const snap = resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_new' });
    assert.equal(snap.plan?.key, 'free');
    assert.equal(snap.source, 'default_plan');
    assert.equal(snap.customer, null);
    assert.equal(snap.features.pdf_analysis?.limit, 10);
    assert.equal(snap.features.pdf_analysis?.remaining, 10);
    assert.equal(snap.features.export?.enabled, false);
    const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM customers')?.n;
    assert.equal(count, 0);
  });

  it('uses the highest-ranked valid license', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    createLicense(ctx, s.project.id, { plan: 'pro', customer: 'user_1' }, 'api', systemActor);
    let snap = resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' });
    assert.equal(snap.plan?.key, 'pro');
    assert.equal(snap.features.export?.enabled, true);
    assert.equal(snap.features.priority_processing?.enabled, false);

    const business = createLicense(ctx, s.project.id, { plan: 'business', customer: 'user_1', durationDays: 30 }, 'api', systemActor);
    snap = resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' });
    assert.equal(snap.plan?.key, 'business');
    assert.equal(snap.license?.id, business.id);

    // When the Business license expires, the Pro license takes over again.
    ctx.clock.advanceDays(31);
    snap = resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' });
    assert.equal(snap.plan?.key, 'pro');
  });

  it('falls back to the default plan when the license is suspended or revoked', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const license = createLicense(ctx, s.project.id, { plan: 'pro', customer: 'user_1' }, 'api', systemActor);
    setLicenseStatus(ctx, s.project.id, license.id, 'suspend', 'chargeback', systemActor);
    assert.equal(resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' }).plan?.key, 'free');
    setLicenseStatus(ctx, s.project.id, license.id, 'reinstate', null, systemActor);
    assert.equal(resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' }).plan?.key, 'pro');
    setLicenseStatus(ctx, s.project.id, license.id, 'revoke', 'refund', systemActor);
    assert.equal(resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' }).plan?.key, 'free');
    assert.throws(() => setLicenseStatus(ctx, s.project.id, license.id, 'reinstate', null, systemActor), /permanent/);
  });

  it('reports why a feature is not available', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const snap = resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' });
    assert.equal(checkFeature(ctx, snap, 'export').code, 'not_included');
    assert.equal(checkFeature(ctx, snap, 'pdf_analysis', 10).allowed, true);
    assert.equal(checkFeature(ctx, snap, 'pdf_analysis', 11).code, 'limit_exceeded');
    assert.throws(() => checkFeature(ctx, snap, 'nope'), /not found/);
  });
});

describe('usage', () => {
  it('consumes units atomically and stops exactly at the limit', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    for (let i = 0; i < 10; i++) {
      const r = recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis' }, systemActor);
      assert.equal(r.allowed, true, `call ${i + 1} should be allowed`);
      assert.equal(r.feature.remaining, 9 - i);
    }
    const denied = recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis' }, systemActor);
    assert.equal(denied.allowed, false);
    assert.equal(denied.code, 'limit_exceeded');
    assert.equal(denied.feature.used, 10);
    // Denied attempts are not counted.
    assert.equal(resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' }).features.pdf_analysis?.used, 10);
  });

  it('is idempotent with an idempotency key', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const first = recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis', quantity: 3, idempotencyKey: 'job_1' }, systemActor);
    const replay = recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis', quantity: 3, idempotencyKey: 'job_1' }, systemActor);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.feature.used, 3);
    assert.throws(
      () => recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis', quantity: 5, idempotencyKey: 'job_1' }, systemActor),
      /different usage record/,
    );
  });

  it('resets every month and keeps usage across upgrades', async () => {
    const ctx = createTestCtx();
    ctx.clock.set('2026-11-30T23:00:00.000Z');
    const s = await seed(ctx);
    recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis', quantity: 10 }, systemActor);
    assert.equal(recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis' }, systemActor).allowed, false);

    // Upgrading raises the limit; the 10 units already used still count this month.
    createLicense(ctx, s.project.id, { plan: 'pro', customer: 'user_1' }, 'api', systemActor);
    const upgraded = recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis' }, systemActor);
    assert.equal(upgraded.allowed, true);
    assert.equal(upgraded.feature.used, 11);
    assert.equal(upgraded.feature.remaining, 489);
    assert.equal(upgraded.feature.resets_at, '2026-12-01T00:00:00.000Z');

    ctx.clock.set('2026-12-01T00:00:01.000Z');
    const snap = resolveCustomerEntitlements(ctx, s.project.id, { customer: 'user_1' });
    assert.equal(snap.features.pdf_analysis?.used, 0);
    assert.equal(snap.features.pdf_analysis?.resets_at, '2027-01-01T00:00:00.000Z');
  });

  it('rejects usage for on/off features and features outside the plan', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    assert.throws(() => recordUsage(ctx, s.project.id, { customer: 'u', feature: 'export' }, systemActor), /on\/off feature/);
    assert.throws(() => recordUsage(ctx, s.project.id, { customer: 'u', feature: 'unknown' }, systemActor), /not found/);
  });

  it('meters license-key usage against the license', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const license = createLicense(ctx, s.project.id, { plan: 'pro' }, 'api', systemActor);
    const r = recordUsage(ctx, s.project.id, { licenseKey: license.key.toLowerCase(), feature: 'pdf_analysis', quantity: 2 }, systemActor);
    assert.equal(r.allowed, true);
    assert.equal(r.feature.used, 2);
    assert.equal(r.feature.limit, 500);
    setLicenseStatus(ctx, s.project.id, license.id, 'suspend', null, systemActor);
    const denied = recordUsage(ctx, s.project.id, { licenseKey: license.key, feature: 'pdf_analysis' }, systemActor);
    assert.equal(denied.code, 'license_invalid');
  });
});

describe('license keys', () => {
  it('validates keys and explains failures', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const license = createLicense(ctx, s.project.id, { plan: 'pro', durationDays: 365 }, 'dashboard', systemActor);
    assert.match(license.key, /^KV-[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);

    assert.equal(validateLicense(ctx, s.project.id, { key: license.key }).valid, true);
    // Lowercase / spaces / ambiguous characters are normalized.
    assert.equal(validateLicense(ctx, s.project.id, { key: ` ${license.key.toLowerCase()} ` }).valid, true);
    assert.equal(validateLicense(ctx, s.project.id, { key: 'KV-AAAAA-BBBBB-CCCCC-DDDDD' }).code, 'not_found');
    assert.equal(validateLicense(ctx, s.project.id, { key: license.key, product: 'other' }).code, 'product_mismatch');

    ctx.clock.advanceDays(366);
    const expired = validateLicense(ctx, s.project.id, { key: license.key });
    assert.equal(expired.valid, false);
    assert.equal(expired.code, 'expired');
  });

  it('enforces device activation limits', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const license = createLicense(ctx, s.project.id, { plan: 'pro', maxActivations: 2 }, 'api', systemActor);
    const meta = { ip: '127.0.0.1' };
    assert.equal(activateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-1' }, meta, systemActor).valid, true);
    assert.equal(activateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-1' }, meta, systemActor).message, 'Device is already activated.');
    assert.equal(activateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-2' }, meta, systemActor).valid, true);
    const third = activateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-3' }, meta, systemActor);
    assert.equal(third.valid, false);
    assert.equal(third.code, 'activation_limit_reached');

    assert.equal(validateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-2' }).valid, true);
    assert.equal(validateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-3' }).code, 'not_activated');

    assert.equal(deactivateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-1' }, systemActor).deactivated, true);
    assert.equal(activateLicense(ctx, s.project.id, { key: license.key, fingerprint: 'mac-3' }, meta, systemActor).valid, true);
  });

  it('uses the plan default device limit', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const license = createLicense(ctx, s.project.id, { plan: 'pro' }, 'api', systemActor);
    assert.equal(license.max_activations, 3);
  });
});

describe('customers', () => {
  it('upserts by external id', async () => {
    const ctx = createTestCtx();
    const s = await seed(ctx);
    const a = upsertCustomer(ctx, s.project.id, { externalId: 'user_1', email: 'A@Example.com' }, systemActor);
    const b = upsertCustomer(ctx, s.project.id, { externalId: 'user_1', name: 'Ada' }, systemActor);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.customer.id, a.customer.id);
    assert.equal(b.customer.email, 'a@example.com');
    assert.equal(b.customer.name, 'Ada');
  });
});

describe('maintenance', () => {
  it('removes expired sessions and old data, and keeps recent data', async () => {
    const { runMaintenance } = await import('../src/services/maintenance.ts');
    const { createSession } = await import('../src/services/users.ts');
    const ctx = createTestCtx();
    const s = await seed(ctx);
    createSession(ctx, s.user.id);
    ctx.db.run(
      "INSERT INTO webhook_events (id, project_id, provider, provider_event_id, type, status, attempts, payload, received_at) VALUES ('whe_old', ?, 'stripe', 'evt_old', 'invoice.paid', 'processed', 1, '{\"big\":true}', ?)",
      s.project.id,
      ctx.now().toISOString(),
    );
    recordUsage(ctx, s.project.id, { customer: 'user_1', feature: 'pdf_analysis' }, systemActor);
    assert.deepEqual(runMaintenance(ctx), { expiredSessions: 0, passwordResets: 0, trimmedWebhookPayloads: 0, deletedUsageEvents: 0 });

    ctx.clock.advanceDays(401);
    const report = runMaintenance(ctx);
    assert.equal(report.expiredSessions, 1);
    assert.equal(report.trimmedWebhookPayloads, 1);
    assert.equal(report.deletedUsageEvents, 1);
    assert.equal(ctx.db.get<{ payload: string }>("SELECT payload FROM webhook_events WHERE id = 'whe_old'")?.payload, '{"trimmed":true}');
  });
});
