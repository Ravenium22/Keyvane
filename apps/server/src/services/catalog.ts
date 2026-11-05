import { parseJson } from '../db/sqlite.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { RESET_PERIODS, type ResetPeriod } from '../lib/time.ts';
import { int, KEY_MESSAGE, KEY_PATTERN, nullableStr, oneOf, slugify, str } from '../lib/validate.ts';
import type {
  Actor,
  BillingInterval,
  CancellationPolicy,
  Ctx,
  FeatureRow,
  FeatureType,
  PlanFeatureRow,
  PlanRow,
  ProductRow,
} from '../types.ts';
import { audit } from './audit.ts';

/**
 * The product catalog: products, their plans (Free / Pro / Business …), their features,
 * and the plan × feature matrix that defines entitlements.
 */

export interface Catalog {
  product: ProductRow;
  /** Sorted by rank, lowest first. */
  plans: PlanRow[];
  features: FeatureRow[];
  /** planId -> featureId -> cell */
  matrix: Map<string, Map<string, PlanFeatureRow>>;
}

export const CANCELLATION_POLICIES: readonly CancellationPolicy[] = ['immediate', 'period_end'];
export const BILLING_INTERVALS: readonly BillingInterval[] = ['month', 'year', 'one_time'];
export const FEATURE_TYPES: readonly FeatureType[] = ['boolean', 'metered'];

const PRICE_ID_PATTERN = /^[A-Za-z0-9_-]{3,255}$/;

export function planPriceIds(plan: PlanRow): string[] {
  return parseJson<string[]>(plan.stripe_price_ids, []);
}

export function loadCatalog(ctx: Ctx, product: ProductRow): Catalog {
  const plans = ctx.db.all<PlanRow>('SELECT * FROM plans WHERE product_id = ? ORDER BY rank ASC, id ASC', product.id);
  const features = ctx.db.all<FeatureRow>('SELECT * FROM features WHERE product_id = ? ORDER BY id ASC', product.id);
  const cells = ctx.db.all<PlanFeatureRow>(
    'SELECT plan_features.* FROM plan_features JOIN plans ON plans.id = plan_features.plan_id WHERE plans.product_id = ?',
    product.id,
  );
  const matrix = new Map<string, Map<string, PlanFeatureRow>>();
  for (const cell of cells) {
    let row = matrix.get(cell.plan_id);
    if (!row) {
      row = new Map();
      matrix.set(cell.plan_id, row);
    }
    row.set(cell.feature_id, cell);
  }
  return { product, plans, features, matrix };
}

export function cellFor(catalog: Catalog, planId: string, featureId: string): PlanFeatureRow | undefined {
  return catalog.matrix.get(planId)?.get(featureId);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function listProducts(ctx: Ctx, projectId: string): ProductRow[] {
  return ctx.db.all<ProductRow>('SELECT * FROM products WHERE project_id = ? ORDER BY id ASC', projectId);
}

export function getProduct(ctx: Ctx, projectId: string, idOrKey: string): ProductRow | null {
  return (
    ctx.db.get<ProductRow>(
      'SELECT * FROM products WHERE project_id = ? AND (id = ? OR key = ?) ORDER BY id = ? DESC LIMIT 1',
      projectId,
      idOrKey,
      idOrKey,
      idOrKey,
    ) ?? null
  );
}

/**
 * Resolve the product a request refers to. When a project has exactly one product,
 * `product` may be omitted — the common case for indie developers.
 */
export function resolveProduct(ctx: Ctx, projectId: string, idOrKey: string | undefined | null): ProductRow {
  if (idOrKey) {
    const product = getProduct(ctx, projectId, idOrKey);
    if (!product) throw notFound(`Product "${idOrKey}"`, 'product_not_found');
    return product;
  }
  const products = ctx.db.all<ProductRow>('SELECT * FROM products WHERE project_id = ? LIMIT 2', projectId);
  if (products.length === 1 && products[0]) return products[0];
  if (products.length === 0) {
    throw badRequest('no_products', 'This project has no products yet. Create one in the Keyvane dashboard.', 'product');
  }
  throw badRequest('parameter_missing', 'product is required because this project has more than one product.', 'product');
}

function uniqueKey(exists: (key: string) => boolean, base: string): string {
  if (!exists(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 58)}-${i}`;
    if (!exists(candidate)) return candidate;
  }
  throw conflict('key_taken', 'Could not generate a unique key. Please provide one.');
}

export type ProductTemplate = 'tiers' | 'blank';

export function createProduct(
  ctx: Ctx,
  projectId: string,
  input: { name: unknown; key?: unknown; description?: unknown; template?: ProductTemplate },
  actor: Actor,
): ProductRow {
  const name = str(input.name, 'name', { required: true, max: 80 });
  const explicitKey = str(input.key, 'key', { max: 63, pattern: KEY_PATTERN, patternMessage: `key ${KEY_MESSAGE}` });
  const description = str(input.description, 'description', { max: 500 }) ?? null;
  const keyExists = (k: string) => !!ctx.db.get('SELECT 1 FROM products WHERE project_id = ? AND key = ?', projectId, k);
  if (explicitKey && keyExists(explicitKey)) {
    throw conflict('key_taken', `A product with key "${explicitKey}" already exists.`, 'key');
  }
  const key = explicitKey ?? uniqueKey(keyExists, slugify(name));
  const now = ctx.now().toISOString();
  const product: ProductRow = {
    id: newId('prd'),
    project_id: projectId,
    key,
    name,
    description,
    default_plan_id: null,
    cancellation_policy: 'immediate',
    grace_period_days: 7,
    created_at: now,
    updated_at: now,
  };
  return ctx.db.transaction(() => {
    ctx.db.insert('products', { ...product });
    audit(ctx, projectId, actor, 'product.created', { type: 'product', id: product.id }, { name, key });
    if (input.template === 'tiers') {
      const free = createPlan(ctx, projectId, product.id, { name: 'Free', key: 'free', priceAmount: 0, billingInterval: 'month', rank: 0 }, actor);
      createPlan(ctx, projectId, product.id, { name: 'Pro', key: 'pro', billingInterval: 'month', rank: 10 }, actor);
      createPlan(ctx, projectId, product.id, { name: 'Business', key: 'business', billingInterval: 'month', rank: 20 }, actor);
      ctx.db.update('products', { id: product.id }, { default_plan_id: free.id });
      product.default_plan_id = free.id;
    }
    return product;
  });
}

export function updateProduct(
  ctx: Ctx,
  projectId: string,
  productId: string,
  input: {
    name?: unknown;
    description?: unknown;
    defaultPlanId?: unknown;
    cancellationPolicy?: unknown;
    gracePeriodDays?: unknown;
  },
  actor: Actor,
): ProductRow {
  const product = requireProduct(ctx, projectId, productId);
  const patch: Partial<ProductRow> = {};
  if (input.name !== undefined) patch.name = str(input.name, 'name', { required: true, max: 80 });
  if (input.description !== undefined) patch.description = nullableStr(input.description, 'description', { max: 500 }) ?? null;
  if (input.defaultPlanId !== undefined) {
    const planId = nullableStr(input.defaultPlanId, 'default_plan');
    if (planId) {
      const plan = ctx.db.get<PlanRow>('SELECT * FROM plans WHERE id = ? AND product_id = ?', planId, product.id);
      if (!plan) throw badRequest('parameter_invalid', 'Default plan must belong to this product.', 'default_plan');
    }
    patch.default_plan_id = planId ?? null;
  }
  if (input.cancellationPolicy !== undefined) {
    patch.cancellation_policy = oneOf(input.cancellationPolicy, 'cancellation_policy', CANCELLATION_POLICIES, { required: true });
  }
  if (input.gracePeriodDays !== undefined) {
    patch.grace_period_days = int(input.gracePeriodDays, 'grace_period_days', { required: true, min: 0, max: 60 }) ?? 0;
  }
  ctx.db.update('products', { id: product.id }, { ...patch, updated_at: ctx.now().toISOString() });
  audit(ctx, projectId, actor, 'product.updated', { type: 'product', id: product.id }, patch);
  return requireProduct(ctx, projectId, productId);
}

export function requireProduct(ctx: Ctx, projectId: string, productId: string): ProductRow {
  const product = ctx.db.get<ProductRow>('SELECT * FROM products WHERE id = ? AND project_id = ?', productId, projectId);
  if (!product) throw notFound('Product', 'product_not_found');
  return product;
}

export function deleteProduct(ctx: Ctx, projectId: string, productId: string, actor: Actor): void {
  const product = requireProduct(ctx, projectId, productId);
  const licenses = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses WHERE product_id = ?', product.id)?.n ?? 0;
  if (licenses > 0) {
    throw conflict(
      'product_in_use',
      `This product has ${licenses} license${licenses === 1 ? '' : 's'}. Revoke and remove them before deleting the product.`,
    );
  }
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM products WHERE id = ?', product.id);
    audit(ctx, projectId, actor, 'product.deleted', { type: 'product', id: product.id }, { name: product.name, key: product.key });
  });
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlanInput {
  name?: unknown;
  key?: unknown;
  description?: unknown;
  rank?: unknown;
  priceAmount?: unknown;
  currency?: unknown;
  billingInterval?: unknown;
  maxActivations?: unknown;
  stripePriceIds?: unknown;
}

function parsePriceIds(input: unknown): string[] {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : input === undefined || input === null
        ? []
        : null;
  if (!list) throw badRequest('parameter_invalid', 'stripe_price_ids must be a list of Stripe price IDs.', 'stripe_price_ids');
  const ids = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
  for (const id of ids) {
    if (!PRICE_ID_PATTERN.test(id)) {
      throw badRequest('parameter_invalid', `"${id}" is not a valid Stripe price ID (e.g. price_1Qx…).`, 'stripe_price_ids');
    }
  }
  if (ids.length > 20) throw badRequest('parameter_invalid', 'A plan can map at most 20 Stripe prices.', 'stripe_price_ids');
  return ids;
}

function assertPriceIdsAvailable(ctx: Ctx, projectId: string, ids: string[], exceptPlanId: string | null): void {
  for (const id of ids) {
    const other = findPlanByStripePrice(ctx, projectId, id);
    if (other && other.id !== exceptPlanId) {
      throw conflict('price_already_mapped', `Stripe price ${id} is already mapped to the "${other.name}" plan.`, 'stripe_price_ids');
    }
  }
}

/** Parses a display price like "12", "12.50" or "$39" into minor units (cents). */
export function parsePriceAmount(input: unknown): number | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 0) throw badRequest('parameter_invalid', 'price_amount must be a non-negative integer (in cents).', 'price_amount');
    return input;
  }
  const cleaned = String(input).replace(/[$€£,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw badRequest('parameter_invalid', 'Enter a price like 12 or 12.50.', 'price_amount');
  return Math.round(Number(cleaned) * 100);
}

export function createPlan(ctx: Ctx, projectId: string, productId: string, input: PlanInput, actor: Actor): PlanRow {
  const product = requireProduct(ctx, projectId, productId);
  const name = str(input.name, 'name', { required: true, max: 60 });
  const explicitKey = str(input.key, 'key', { max: 63, pattern: KEY_PATTERN, patternMessage: `key ${KEY_MESSAGE}` });
  const keyExists = (k: string) => !!ctx.db.get('SELECT 1 FROM plans WHERE product_id = ? AND key = ?', product.id, k);
  if (explicitKey && keyExists(explicitKey)) throw conflict('key_taken', `A plan with key "${explicitKey}" already exists.`, 'key');
  const key = explicitKey ?? uniqueKey(keyExists, slugify(name));
  const priceIds = parsePriceIds(input.stripePriceIds);
  assertPriceIdsAvailable(ctx, projectId, priceIds, null);
  const maxRank = ctx.db.get<{ r: number | null }>('SELECT MAX(rank) AS r FROM plans WHERE product_id = ?', product.id)?.r;
  const now = ctx.now().toISOString();
  const plan: PlanRow = {
    id: newId('pln'),
    project_id: projectId,
    product_id: product.id,
    key,
    name,
    description: str(input.description, 'description', { max: 300 }) ?? null,
    rank: int(input.rank, 'rank', { min: -1000000, max: 1000000 }) ?? (maxRank === null || maxRank === undefined ? 0 : maxRank + 10),
    price_amount: parsePriceAmount(input.priceAmount) ?? null,
    currency: (str(input.currency, 'currency', { max: 3, min: 3 }) ?? 'usd').toLowerCase(),
    billing_interval: oneOf(input.billingInterval, 'billing_interval', BILLING_INTERVALS) ?? null,
    max_activations: int(input.maxActivations, 'max_activations', { min: 1, max: 100000 }) ?? null,
    stripe_price_ids: JSON.stringify(priceIds),
    created_at: now,
    updated_at: now,
  };
  ctx.db.insert('plans', { ...plan });
  audit(ctx, projectId, actor, 'plan.created', { type: 'plan', id: plan.id }, { name, key, product: product.key });
  return plan;
}

export function requirePlan(ctx: Ctx, projectId: string, planId: string): PlanRow {
  const plan = ctx.db.get<PlanRow>('SELECT * FROM plans WHERE id = ? AND project_id = ?', planId, projectId);
  if (!plan) throw notFound('Plan', 'plan_not_found');
  return plan;
}

/** Find a plan of `product` by id or key. */
export function resolvePlan(ctx: Ctx, product: ProductRow, idOrKey: string): PlanRow {
  const plan = ctx.db.get<PlanRow>(
    'SELECT * FROM plans WHERE product_id = ? AND (id = ? OR key = ?) ORDER BY id = ? DESC LIMIT 1',
    product.id,
    idOrKey,
    idOrKey,
    idOrKey,
  );
  if (!plan) throw notFound(`Plan "${idOrKey}" of product "${product.key}"`, 'plan_not_found');
  return plan;
}

export function updatePlan(ctx: Ctx, projectId: string, planId: string, input: PlanInput, actor: Actor): PlanRow {
  const plan = requirePlan(ctx, projectId, planId);
  const patch: Partial<PlanRow> = {};
  if (input.name !== undefined) patch.name = str(input.name, 'name', { required: true, max: 60 });
  if (input.key !== undefined) {
    const key = str(input.key, 'key', { required: true, max: 63, pattern: KEY_PATTERN, patternMessage: `key ${KEY_MESSAGE}` });
    if (key !== plan.key && ctx.db.get('SELECT 1 FROM plans WHERE product_id = ? AND key = ?', plan.product_id, key)) {
      throw conflict('key_taken', `A plan with key "${key}" already exists.`, 'key');
    }
    patch.key = key;
  }
  if (input.description !== undefined) patch.description = nullableStr(input.description, 'description', { max: 300 }) ?? null;
  if (input.rank !== undefined) patch.rank = int(input.rank, 'rank', { required: true, min: -1000000, max: 1000000 }) ?? 0;
  if (input.priceAmount !== undefined) patch.price_amount = parsePriceAmount(input.priceAmount) ?? null;
  if (input.currency !== undefined) patch.currency = (str(input.currency, 'currency', { min: 3, max: 3 }) ?? 'usd').toLowerCase();
  if (input.billingInterval !== undefined) {
    patch.billing_interval = input.billingInterval === '' || input.billingInterval === null
      ? null
      : (oneOf(input.billingInterval, 'billing_interval', BILLING_INTERVALS) ?? null);
  }
  if (input.maxActivations !== undefined) patch.max_activations = int(input.maxActivations, 'max_activations', { min: 1, max: 100000 }) ?? null;
  if (input.stripePriceIds !== undefined) {
    const ids = parsePriceIds(input.stripePriceIds);
    assertPriceIdsAvailable(ctx, projectId, ids, plan.id);
    patch.stripe_price_ids = JSON.stringify(ids);
  }
  ctx.db.update('plans', { id: plan.id }, { ...patch, updated_at: ctx.now().toISOString() });
  audit(ctx, projectId, actor, 'plan.updated', { type: 'plan', id: plan.id }, patch);
  return requirePlan(ctx, projectId, planId);
}

export function deletePlan(ctx: Ctx, projectId: string, planId: string, actor: Actor): void {
  const plan = requirePlan(ctx, projectId, planId);
  const licenses = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses WHERE plan_id = ?', plan.id)?.n ?? 0;
  if (licenses > 0) {
    throw conflict(
      'plan_in_use',
      `${licenses} license${licenses === 1 ? ' uses' : 's use'} this plan. Move them to another plan before deleting it.`,
    );
  }
  ctx.db.transaction(() => {
    ctx.db.run('UPDATE products SET default_plan_id = NULL WHERE default_plan_id = ?', plan.id);
    ctx.db.run('DELETE FROM plans WHERE id = ?', plan.id);
    audit(ctx, projectId, actor, 'plan.deleted', { type: 'plan', id: plan.id }, { name: plan.name, key: plan.key });
  });
}

export function findPlanByStripePrice(ctx: Ctx, projectId: string, priceId: string): PlanRow | null {
  return (
    ctx.db.get<PlanRow>(
      `SELECT * FROM plans WHERE project_id = ?
       AND EXISTS (SELECT 1 FROM json_each(plans.stripe_price_ids) WHERE json_each.value = ?)
       LIMIT 1`,
      projectId,
      priceId,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export interface FeatureInput {
  name?: unknown;
  key?: unknown;
  description?: unknown;
  type?: unknown;
  resetPeriod?: unknown;
  unit?: unknown;
}

export function createFeature(ctx: Ctx, projectId: string, productId: string, input: FeatureInput, actor: Actor): FeatureRow {
  const product = requireProduct(ctx, projectId, productId);
  const name = str(input.name, 'name', { required: true, max: 60 });
  const explicitKey = str(input.key, 'key', { max: 63, pattern: KEY_PATTERN, patternMessage: `key ${KEY_MESSAGE}` });
  const keyExists = (k: string) => !!ctx.db.get('SELECT 1 FROM features WHERE product_id = ? AND key = ?', product.id, k);
  if (explicitKey && keyExists(explicitKey)) throw conflict('key_taken', `A feature with key "${explicitKey}" already exists.`, 'key');
  const key = explicitKey ?? uniqueKey(keyExists, slugify(name, '_'));
  const type = oneOf(input.type, 'type', FEATURE_TYPES) ?? 'boolean';
  const now = ctx.now().toISOString();
  const feature: FeatureRow = {
    id: newId('ftr'),
    project_id: projectId,
    product_id: product.id,
    key,
    name,
    description: str(input.description, 'description', { max: 300 }) ?? null,
    type,
    reset_period: oneOf<ResetPeriod>(input.resetPeriod, 'reset_period', RESET_PERIODS) ?? 'month',
    unit: str(input.unit, 'unit', { max: 30 }) ?? null,
    created_at: now,
    updated_at: now,
  };
  ctx.db.insert('features', { ...feature });
  audit(ctx, projectId, actor, 'feature.created', { type: 'feature', id: feature.id }, { name, key, type, product: product.key });
  return feature;
}

export function requireFeature(ctx: Ctx, projectId: string, featureId: string): FeatureRow {
  const feature = ctx.db.get<FeatureRow>('SELECT * FROM features WHERE id = ? AND project_id = ?', featureId, projectId);
  if (!feature) throw notFound('Feature', 'feature_not_found');
  return feature;
}

export function updateFeature(ctx: Ctx, projectId: string, featureId: string, input: FeatureInput, actor: Actor): FeatureRow {
  const feature = requireFeature(ctx, projectId, featureId);
  const patch: Partial<FeatureRow> = {};
  if (input.name !== undefined) patch.name = str(input.name, 'name', { required: true, max: 60 });
  if (input.description !== undefined) patch.description = nullableStr(input.description, 'description', { max: 300 }) ?? null;
  if (input.resetPeriod !== undefined) patch.reset_period = oneOf<ResetPeriod>(input.resetPeriod, 'reset_period', RESET_PERIODS, { required: true });
  if (input.unit !== undefined) patch.unit = nullableStr(input.unit, 'unit', { max: 30 }) ?? null;
  ctx.db.update('features', { id: feature.id }, { ...patch, updated_at: ctx.now().toISOString() });
  audit(ctx, projectId, actor, 'feature.updated', { type: 'feature', id: feature.id }, patch);
  return requireFeature(ctx, projectId, featureId);
}

export function deleteFeature(ctx: Ctx, projectId: string, featureId: string, actor: Actor): void {
  const feature = requireFeature(ctx, projectId, featureId);
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM usage_counters WHERE feature_id = ?', feature.id);
    ctx.db.run('DELETE FROM usage_events WHERE feature_id = ?', feature.id);
    ctx.db.run('DELETE FROM features WHERE id = ?', feature.id);
    audit(ctx, projectId, actor, 'feature.deleted', { type: 'feature', id: feature.id }, { name: feature.name, key: feature.key });
  });
}

export function resolveFeature(ctx: Ctx, product: ProductRow, key: string): FeatureRow {
  const feature = ctx.db.get<FeatureRow>(
    'SELECT * FROM features WHERE product_id = ? AND (key = ? OR id = ?) LIMIT 1',
    product.id,
    key,
    key,
  );
  if (!feature) throw notFound(`Feature "${key}" of product "${product.key}"`, 'feature_not_found');
  return feature;
}

// ---------------------------------------------------------------------------
// Plan × feature matrix
// ---------------------------------------------------------------------------

export interface MatrixCell {
  planId: string;
  featureId: string;
  enabled: boolean;
  /** Metered features only: null = unlimited. */
  limit: number | null;
}

export function setEntitlements(ctx: Ctx, projectId: string, productId: string, cells: MatrixCell[], actor: Actor): void {
  const product = requireProduct(ctx, projectId, productId);
  const catalog = loadCatalog(ctx, product);
  const planIds = new Set(catalog.plans.map((p) => p.id));
  const features = new Map(catalog.features.map((f) => [f.id, f]));
  ctx.db.transaction(() => {
    for (const cell of cells) {
      const feature = features.get(cell.featureId);
      if (!planIds.has(cell.planId) || !feature) {
        throw badRequest('parameter_invalid', 'Entitlements must reference plans and features of this product.');
      }
      const limit = feature.type === 'metered' ? cell.limit : null;
      if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
        throw badRequest('parameter_invalid', `Limit for "${feature.name}" must be a whole number of 0 or more.`);
      }
      ctx.db.run(
        `INSERT INTO plan_features (plan_id, feature_id, enabled, limit_value) VALUES (?, ?, ?, ?)
         ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = excluded.enabled, limit_value = excluded.limit_value`,
        cell.planId,
        cell.featureId,
        cell.enabled,
        limit,
      );
    }
    audit(ctx, projectId, actor, 'entitlements.updated', { type: 'product', id: product.id }, { cells: cells.length });
  });
}

/** Convenience used by templates/seeding: set a single feature on a plan. */
export function grant(
  ctx: Ctx,
  plan: PlanRow,
  feature: FeatureRow,
  value: boolean | number | null,
): void {
  const enabled = value !== false;
  const limit = feature.type === 'metered' && typeof value === 'number' ? value : null;
  ctx.db.run(
    `INSERT INTO plan_features (plan_id, feature_id, enabled, limit_value) VALUES (?, ?, ?, ?)
     ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = excluded.enabled, limit_value = excluded.limit_value`,
    plan.id,
    feature.id,
    enabled,
    limit,
  );
}

