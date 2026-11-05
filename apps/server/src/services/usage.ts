import { badRequest, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { periodKey } from '../lib/time.ts';
import { int, str } from '../lib/validate.ts';
import type { Actor, Ctx, CustomerRow, FeatureRow, LicenseRow, PlanRow } from '../types.ts';
import { loadCatalog, resolveFeature, resolveProduct } from './catalog.ts';
import { ensureCustomer } from './customers.ts';
import { snapshotForCustomer, snapshotForLicense, type EntitlementSnapshot, type FeatureEntitlement } from './entitlements.ts';
import { getLicenseByKey, loadLicenseContext } from './licenses.ts';
import { audit } from './audit.ts';
import { bump } from './stats.ts';

/**
 * Metered usage. `recordUsage` checks the limit and consumes units in one atomic step,
 * so two concurrent requests can never both take the last unit. Idempotency keys make
 * retries safe: replaying a key returns the original outcome without counting twice.
 */

export type UsageCode = 'ok' | 'limit_exceeded' | 'not_included' | 'license_invalid';

export interface UsageResult {
  allowed: boolean;
  code: UsageCode;
  message: string;
  replayed: boolean;
  feature: FeatureEntitlement;
  snapshot: EntitlementSnapshot;
}

export interface UsageInput {
  customer?: unknown;
  licenseKey?: unknown;
  product?: unknown;
  feature?: unknown;
  quantity?: unknown;
  idempotencyKey?: unknown;
}

export function recordUsage(ctx: Ctx, projectId: string, input: UsageInput, actor: Actor): UsageResult {
  const customerRef = str(input.customer, 'customer', { max: 200 });
  const licenseKey = str(input.licenseKey, 'license_key', { max: 200 });
  if (!customerRef && !licenseKey) {
    throw badRequest('parameter_missing', 'Provide customer (your user ID) or license_key.', 'customer');
  }
  const featureKey = str(input.feature, 'feature', { required: true, max: 63 });
  const quantity = int(input.quantity, 'quantity', { min: 1, max: 1_000_000 }) ?? 1;
  const idempotencyKey = str(input.idempotencyKey, 'idempotency_key', { max: 255 });

  return ctx.db.transaction(() => {
    // 1. Who is consuming, and which plan applies?
    let snapshot: EntitlementSnapshot;
    let customer: CustomerRow | null = null;
    let license: LicenseRow | null = null;
    if (licenseKey) {
      license = getLicenseByKey(ctx, projectId, licenseKey);
      if (!license) throw notFound('License key', 'license_not_found');
      const context = loadLicenseContext(ctx, license);
      const productRef = str(input.product, 'product');
      if (productRef && productRef !== context.product.id && productRef !== context.product.key) {
        throw badRequest('product_mismatch', `This license is for "${context.product.name}", not "${productRef}".`, 'product');
      }
      snapshot = snapshotForLicense(ctx, context);
      customer = context.customer;
      if (!context.state.valid) {
        const feature = snapshot.features[resolveFeature(ctx, context.product, featureKey).key] as FeatureEntitlement;
        bump(ctx, projectId, 'usage_denied');
        return { allowed: false, code: 'license_invalid', message: context.state.message, replayed: false, feature, snapshot };
      }
    } else {
      const product = resolveProduct(ctx, projectId, str(input.product, 'product'));
      customer = ensureCustomer(ctx, projectId, customerRef as string, actor);
      snapshot = snapshotForCustomer(ctx, loadCatalog(ctx, product), customer);
    }

    const definition: FeatureRow = resolveFeature(ctx, snapshot.product, featureKey);
    if (definition.type !== 'metered') {
      throw badRequest(
        'feature_not_metered',
        `"${definition.key}" is an on/off feature. Use the entitlements check endpoint instead of recording usage.`,
        'feature',
      );
    }
    const subjectId = snapshot.subjectId as string;

    // 2. Idempotent replay?
    if (idempotencyKey) {
      const previous = ctx.db.get<{ id: string; feature_id: string; subject_id: string; quantity: number }>(
        'SELECT id, feature_id, subject_id, quantity FROM usage_events WHERE project_id = ? AND idempotency_key = ?',
        projectId,
        idempotencyKey,
      );
      if (previous) {
        if (previous.feature_id !== definition.id || previous.subject_id !== subjectId || previous.quantity !== quantity) {
          throw badRequest(
            'idempotency_key_reused',
            'This idempotency key was already used for a different usage record.',
            'idempotency_key',
          );
        }
        const feature = snapshot.features[definition.key] as FeatureEntitlement;
        return { allowed: true, code: 'ok', message: 'Already recorded (idempotent replay).', replayed: true, feature, snapshot };
      }
    }

    // 3. Check the limit and consume atomically.
    const feature = snapshot.features[definition.key] as FeatureEntitlement;
    if (!feature.enabled) {
      bump(ctx, projectId, 'usage_denied');
      return {
        allowed: false,
        code: 'not_included',
        message: `${definition.name} is not included in the ${planLabel(snapshot.plan)} plan.`,
        replayed: false,
        feature,
        snapshot,
      };
    }
    if (feature.limit !== null && feature.limit !== undefined && (feature.used ?? 0) + quantity > feature.limit) {
      bump(ctx, projectId, 'usage_denied');
      return {
        allowed: false,
        code: 'limit_exceeded',
        message: `${definition.name} limit reached (${feature.used} of ${feature.limit}${definition.unit ? ` ${definition.unit}` : ''} used).`,
        replayed: false,
        feature,
        snapshot,
      };
    }

    const now = ctx.now();
    const period = periodKey(definition.reset_period, now);
    ctx.db.run(
      `INSERT INTO usage_counters (project_id, subject_id, feature_id, period_key, used, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (subject_id, feature_id, period_key) DO UPDATE SET used = used + excluded.used, updated_at = excluded.updated_at`,
      projectId,
      subjectId,
      definition.id,
      period,
      quantity,
      now.toISOString(),
    );
    ctx.db.insert('usage_events', {
      id: newId('use'),
      project_id: projectId,
      subject_id: subjectId,
      customer_id: customer?.id ?? null,
      license_id: license?.id ?? snapshot.license?.id ?? null,
      feature_id: definition.id,
      quantity,
      period_key: period,
      idempotency_key: idempotencyKey ?? null,
      created_at: now.toISOString(),
    });
    bump(ctx, projectId, 'usage_recorded', quantity);

    const used = (feature.used ?? 0) + quantity;
    const updated: FeatureEntitlement = {
      ...feature,
      used,
      remaining: feature.limit === null || feature.limit === undefined ? null : Math.max(0, feature.limit - used),
    };
    snapshot.features[definition.key] = updated;
    return { allowed: true, code: 'ok', message: 'Usage recorded.', replayed: false, feature: updated, snapshot };
  });
}

function planLabel(plan: PlanRow | null): string {
  return plan ? plan.name : 'current';
}

export interface UsageEventView {
  id: string;
  feature_key: string;
  feature_name: string;
  quantity: number;
  created_at: string;
}

export function recentUsage(ctx: Ctx, subjectId: string, limit = 20): UsageEventView[] {
  return ctx.db.all<UsageEventView>(
    `SELECT usage_events.id, features.key AS feature_key, features.name AS feature_name, usage_events.quantity, usage_events.created_at
     FROM usage_events JOIN features ON features.id = usage_events.feature_id
     WHERE usage_events.subject_id = ? ORDER BY usage_events.id DESC LIMIT ?`,
    subjectId,
    limit,
  );
}

/** Reset a subject's counter for the current period (dashboard support action). */
export function resetUsage(ctx: Ctx, projectId: string, subjectId: string, feature: FeatureRow, actor: Actor): void {
  const period = periodKey(feature.reset_period, ctx.now());
  const result = ctx.db.run(
    'DELETE FROM usage_counters WHERE project_id = ? AND subject_id = ? AND feature_id = ? AND period_key = ?',
    projectId,
    subjectId,
    feature.id,
    period,
  );
  if (result.changes > 0) {
    audit(ctx, projectId, actor, 'usage.reset', { type: subjectId.startsWith('lic_') ? 'license' : 'customer', id: subjectId }, {
      feature: feature.key,
      period,
    });
  }
}
