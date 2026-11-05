import { periodKey, periodResetsAt, type ResetPeriod } from '../lib/time.ts';
import type { Ctx, CustomerRow, FeatureType, LicenseRow, PlanRow, ProductRow, SubscriptionRow } from '../types.ts';
import { cellFor, loadCatalog, resolveFeature, resolveProduct, type Catalog } from './catalog.ts';
import { getCustomer } from './customers.ts';
import { evaluateLicense, type LicenseContext, type LicenseState } from './licenses.ts';

/**
 * Entitlements = what a customer may do right now, derived from:
 *   1. their highest-ranked valid license for the product (manual or Stripe-backed), or
 *   2. the product's default plan (e.g. "Free") when they have none.
 */

export interface FeatureEntitlement {
  key: string;
  name: string;
  type: FeatureType;
  enabled: boolean;
  /** Metered features only. `null` limit = unlimited. */
  limit?: number | null;
  used?: number;
  remaining?: number | null;
  reset_period?: ResetPeriod;
  resets_at?: string | null;
  unit?: string | null;
}

export type EntitlementSource = 'license' | 'default_plan' | 'none';

export interface EntitlementSnapshot {
  product: ProductRow;
  plan: PlanRow | null;
  source: EntitlementSource;
  customer: CustomerRow | null;
  license: LicenseRow | null;
  licenseState: LicenseState | null;
  subscription: SubscriptionRow | null;
  /** Whose usage counters apply: the customer, or the license when it has no customer. */
  subjectId: string | null;
  features: Record<string, FeatureEntitlement>;
  checkedAt: string;
}

export function computeFeatures(
  ctx: Ctx,
  catalog: Catalog,
  plan: PlanRow | null,
  subjectId: string | null,
): Record<string, FeatureEntitlement> {
  const now = ctx.now();
  const usage = new Map<string, number>();
  if (subjectId && catalog.features.some((f) => f.type === 'metered')) {
    const rows = ctx.db.all<{ feature_id: string; period_key: string; used: number }>(
      'SELECT feature_id, period_key, used FROM usage_counters WHERE subject_id = ?',
      subjectId,
    );
    for (const r of rows) usage.set(`${r.feature_id}:${r.period_key}`, r.used);
  }
  const features: Record<string, FeatureEntitlement> = {};
  for (const feature of catalog.features) {
    const cell = plan ? cellFor(catalog, plan.id, feature.id) : undefined;
    const enabled = cell ? cell.enabled === 1 : false;
    if (feature.type === 'boolean') {
      features[feature.key] = { key: feature.key, name: feature.name, type: 'boolean', enabled };
      continue;
    }
    const limit = enabled ? (cell?.limit_value ?? null) : 0;
    const used = usage.get(`${feature.id}:${periodKey(feature.reset_period, now)}`) ?? 0;
    const resetsAt = periodResetsAt(feature.reset_period, now);
    features[feature.key] = {
      key: feature.key,
      name: feature.name,
      type: 'metered',
      enabled,
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      reset_period: feature.reset_period,
      resets_at: resetsAt ? resetsAt.toISOString() : null,
      unit: feature.unit,
    };
  }
  return features;
}

/** Pick the license that grants the best plan. Ties go to the most recently created license. */
export function bestLicense(ctx: Ctx, customerId: string, catalog: Catalog): LicenseContext | null {
  const licenses = ctx.db.all<LicenseRow>(
    `SELECT * FROM licenses WHERE customer_id = ? AND product_id = ? AND status = 'active' ORDER BY id DESC`,
    customerId,
    catalog.product.id,
  );
  const rank = new Map(catalog.plans.map((p) => [p.id, p.rank]));
  let best: LicenseContext | null = null;
  for (const license of licenses) {
    const subscription = license.subscription_id
      ? (ctx.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', license.subscription_id) ?? null)
      : null;
    const state = evaluateLicense(license, catalog.product, subscription, ctx.now());
    if (!state.valid) continue;
    if (!best || (rank.get(license.plan_id) ?? 0) > (rank.get(best.license.plan_id) ?? 0)) {
      const plan = catalog.plans.find((p) => p.id === license.plan_id);
      if (!plan) continue;
      best = { license, product: catalog.product, plan, customer: null, subscription, state, activations: 0 };
    }
  }
  return best;
}

function defaultPlan(catalog: Catalog): PlanRow | null {
  const id = catalog.product.default_plan_id;
  return id ? (catalog.plans.find((p) => p.id === id) ?? null) : null;
}

export function snapshotForCustomer(ctx: Ctx, catalog: Catalog, customer: CustomerRow | null): EntitlementSnapshot {
  const best = customer ? bestLicense(ctx, customer.id, catalog) : null;
  const plan = best?.plan ?? defaultPlan(catalog);
  const subjectId = customer?.id ?? null;
  return {
    product: catalog.product,
    plan,
    source: best ? 'license' : plan ? 'default_plan' : 'none',
    customer,
    license: best?.license ?? null,
    licenseState: best?.state ?? null,
    subscription: best?.subscription ?? null,
    subjectId,
    features: computeFeatures(ctx, catalog, plan, subjectId),
    checkedAt: ctx.now().toISOString(),
  };
}

/**
 * Entitlements for a customer identified by Keyvane ID or the developer's own user ID.
 * Unknown customers get the default plan — no record is created by reading.
 */
export function resolveCustomerEntitlements(
  ctx: Ctx,
  projectId: string,
  input: { customer: string; product?: string | null },
): EntitlementSnapshot {
  const product = resolveProduct(ctx, projectId, input.product);
  const customer = getCustomer(ctx, projectId, input.customer);
  return snapshotForCustomer(ctx, loadCatalog(ctx, product), customer);
}

/** Entitlements granted by one specific license (used by license-key validation). */
export function snapshotForLicense(ctx: Ctx, context: LicenseContext): EntitlementSnapshot {
  const catalog = loadCatalog(ctx, context.product);
  const plan = context.state.valid ? context.plan : defaultPlan(catalog);
  const subjectId = context.license.customer_id ?? context.license.id;
  return {
    product: context.product,
    plan,
    source: context.state.valid ? 'license' : plan ? 'default_plan' : 'none',
    customer: context.customer,
    license: context.license,
    licenseState: context.state,
    subscription: context.subscription,
    subjectId,
    features: computeFeatures(ctx, catalog, plan, subjectId),
    checkedAt: ctx.now().toISOString(),
  };
}

export type CheckCode = 'ok' | 'not_included' | 'limit_exceeded';

export interface CheckResult {
  allowed: boolean;
  code: CheckCode;
  message: string;
  feature: FeatureEntitlement;
}

/** Can the snapshot's subject use `featureKey` (and consume `quantity` units if metered)? */
export function checkFeature(ctx: Ctx, snapshot: EntitlementSnapshot, featureKey: string, quantity = 1): CheckResult {
  const definition = resolveFeature(ctx, snapshot.product, featureKey);
  const feature = snapshot.features[definition.key] as FeatureEntitlement;
  const planName = snapshot.plan?.name ?? 'current';
  if (!feature.enabled) {
    return { allowed: false, code: 'not_included', message: `${feature.name} is not included in the ${planName} plan.`, feature };
  }
  if (feature.type === 'metered' && feature.remaining !== null && feature.remaining !== undefined && feature.remaining < quantity) {
    return {
      allowed: false,
      code: 'limit_exceeded',
      message: `${feature.name} limit reached (${feature.used} of ${feature.limit}${feature.unit ? ` ${feature.unit}` : ''} used).`,
      feature,
    };
  }
  return { allowed: true, code: 'ok', message: `${feature.name} is available.`, feature };
}

