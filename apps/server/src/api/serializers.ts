import { parseJson } from '../db/sqlite.ts';
import type { Catalog } from '../services/catalog.ts';
import { cellFor, planPriceIds } from '../services/catalog.ts';
import { customerMetadata } from '../services/customers.ts';
import type { CheckResult, EntitlementSnapshot, FeatureEntitlement } from '../services/entitlements.ts';
import { licenseMetadata, type LicenseContext } from '../services/licenses.ts';
import type { ActivationRow, CustomerRow, FeatureRow, PlanRow, ProductRow, SubscriptionRow } from '../types.ts';

/** Public JSON representations. Field names are snake_case and stable within /v1. */

export const productRef = (p: ProductRow) => ({ id: p.id, key: p.key, name: p.name });
export const planRef = (p: PlanRow | null) => (p ? { id: p.id, key: p.key, name: p.name } : null);

export function serializeFeature(f: FeatureRow) {
  return {
    object: 'feature',
    id: f.id,
    key: f.key,
    name: f.name,
    description: f.description,
    type: f.type,
    ...(f.type === 'metered' ? { reset_period: f.reset_period, unit: f.unit } : {}),
  };
}

export function serializePlan(plan: PlanRow, catalog: Catalog) {
  const entitlements: Record<string, { enabled: boolean; limit?: number | null }> = {};
  for (const feature of catalog.features) {
    const cell = cellFor(catalog, plan.id, feature.id);
    const enabled = cell?.enabled === 1;
    entitlements[feature.key] = feature.type === 'metered' ? { enabled, limit: enabled ? (cell?.limit_value ?? null) : 0 } : { enabled };
  }
  return {
    object: 'plan',
    id: plan.id,
    key: plan.key,
    name: plan.name,
    description: plan.description,
    rank: plan.rank,
    price:
      plan.price_amount === null
        ? null
        : { amount: plan.price_amount, currency: plan.currency, interval: plan.billing_interval },
    max_activations: plan.max_activations,
    stripe_price_ids: planPriceIds(plan),
    is_default: catalog.product.default_plan_id === plan.id,
    entitlements,
  };
}

export function serializeProduct(catalog: Catalog) {
  const p = catalog.product;
  const defaultPlan = catalog.plans.find((plan) => plan.id === p.default_plan_id);
  return {
    object: 'product',
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    default_plan: defaultPlan?.key ?? null,
    cancellation_policy: p.cancellation_policy,
    grace_period_days: p.grace_period_days,
    plans: catalog.plans.map((plan) => serializePlan(plan, catalog)),
    features: catalog.features.map(serializeFeature),
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

export function serializeCustomer(c: CustomerRow) {
  return {
    object: 'customer',
    id: c.id,
    external_id: c.external_id,
    email: c.email,
    name: c.name,
    stripe_customer_id: c.stripe_customer_id,
    metadata: customerMetadata(c),
    last_seen_at: c.last_seen_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

const customerRef = (c: CustomerRow | null) => (c ? { id: c.id, external_id: c.external_id, email: c.email } : null);

export function serializeSubscription(s: SubscriptionRow | null) {
  if (!s) return null;
  return {
    provider: s.provider,
    id: s.provider_subscription_id,
    status: s.status,
    current_period_end: s.current_period_end,
    cancel_at_period_end: s.cancel_at_period_end === 1,
    canceled_at: s.canceled_at,
    price_ids: parseJson<string[]>(s.price_ids, []),
  };
}

export function serializeLicense(context: LicenseContext, opts: { includeNote?: boolean } = {}) {
  const { license, state } = context;
  return {
    object: 'license',
    id: license.id,
    key: license.key,
    valid: state.valid,
    status: state.status,
    status_message: state.message,
    access_until: state.accessUntil,
    product: productRef(context.product),
    plan: planRef(context.plan),
    customer: customerRef(context.customer),
    source: license.source,
    expires_at: license.expires_at,
    max_activations: license.max_activations,
    activations: context.activations,
    subscription: serializeSubscription(context.subscription),
    metadata: licenseMetadata(license),
    ...(opts.includeNote ? { note: license.note } : {}),
    last_validated_at: license.last_validated_at,
    created_at: license.created_at,
    updated_at: license.updated_at,
  };
}

export function serializeFeatureEntitlement(f: FeatureEntitlement) {
  if (f.type === 'boolean') return { name: f.name, type: f.type, enabled: f.enabled };
  return {
    name: f.name,
    type: f.type,
    enabled: f.enabled,
    limit: f.limit ?? null,
    used: f.used ?? 0,
    remaining: f.remaining ?? null,
    reset_period: f.reset_period,
    resets_at: f.resets_at ?? null,
    unit: f.unit ?? null,
  };
}

export function serializeEntitlements(snapshot: EntitlementSnapshot, requestedCustomer?: string) {
  const features: Record<string, ReturnType<typeof serializeFeatureEntitlement>> = {};
  for (const [key, f] of Object.entries(snapshot.features)) features[key] = serializeFeatureEntitlement(f);
  return {
    object: 'entitlements',
    customer: snapshot.customer
      ? customerRef(snapshot.customer)
      : requestedCustomer
        ? { id: null, external_id: requestedCustomer, email: null }
        : null,
    product: productRef(snapshot.product),
    plan: planRef(snapshot.plan),
    source: snapshot.source,
    license: snapshot.license && snapshot.licenseState
      ? { id: snapshot.license.id, status: snapshot.licenseState.status, access_until: snapshot.licenseState.accessUntil }
      : null,
    subscription: serializeSubscription(snapshot.subscription),
    features,
    checked_at: snapshot.checkedAt,
  };
}

export function serializeCheck(result: CheckResult, snapshot: EntitlementSnapshot, requestedCustomer?: string) {
  return {
    object: 'entitlement_check',
    allowed: result.allowed,
    code: result.code,
    message: result.message,
    feature: { key: result.feature.key, ...serializeFeatureEntitlement(result.feature) },
    plan: planRef(snapshot.plan),
    customer: snapshot.customer ? customerRef(snapshot.customer) : requestedCustomer ? { id: null, external_id: requestedCustomer, email: null } : null,
  };
}

export function serializeActivation(a: ActivationRow | null) {
  if (!a) return null;
  return { object: 'activation', id: a.id, fingerprint: a.fingerprint, name: a.name, created_at: a.created_at, last_seen_at: a.last_seen_at };
}

export function list<T>(data: T[], hasMore: boolean) {
  return { object: 'list', data, has_more: hasMore };
}
