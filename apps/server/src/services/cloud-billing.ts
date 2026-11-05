import { ApiError } from '../lib/errors.ts';
import type { Ctx, PlanRow, UserRow } from '../types.ts';
import { getProduct, loadCatalog } from './catalog.ts';
import { getCustomer } from './customers.ts';
import { snapshotForCustomer } from './entitlements.ts';

/**
 * Keyvane Cloud bills its own users with Keyvane ("dogfooding"): one project in this
 * instance sells the "keyvane-cloud" product, each developer is a customer identified
 * by their user ID, and Stripe Payment Links carry that ID as client_reference_id.
 * Plan quotas come from two metered features of that product: `products` and
 * `active_licenses` (limit = quota, empty = unlimited).
 */

export type Quota = 'products' | 'active_licenses';

export interface AccountPlan {
  plan: Pick<PlanRow, 'key' | 'name'> | null;
  limits: Record<Quota, number | null>;
  usage: Record<Quota, number>;
  upgrades: { key: string; name: string; url: string }[];
  portalUrl: string | null;
}

export function billingEnabled(ctx: Ctx): boolean {
  return !!ctx.config.billing.projectId;
}

export function quotaUsage(ctx: Ctx, userId: string): Record<Quota, number> {
  // The billing project itself never counts against its owner's quotas.
  const billingProject = ctx.config.billing.projectId ?? '';
  const products =
    ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM products JOIN projects ON projects.id = products.project_id WHERE projects.owner_id = ? AND projects.id != ?',
      userId,
      billingProject,
    )?.n ?? 0;
  const activeLicenses =
    ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM licenses JOIN projects ON projects.id = licenses.project_id
       WHERE projects.owner_id = ? AND projects.id != ? AND licenses.status = 'active' AND (licenses.expires_at IS NULL OR licenses.expires_at > ?)`,
      userId,
      billingProject,
      ctx.now().toISOString(),
    )?.n ?? 0;
  return { products, active_licenses: activeLicenses };
}

export function accountPlan(ctx: Ctx, user: UserRow): AccountPlan | null {
  const { projectId, productKey, upgradeLinks, portalUrl } = ctx.config.billing;
  if (!projectId) return null;
  const product = getProduct(ctx, projectId, productKey);
  if (!product) return null;
  const catalog = loadCatalog(ctx, product);
  const snapshot = snapshotForCustomer(ctx, catalog, getCustomer(ctx, projectId, user.id));
  const limit = (key: Quota): number | null => {
    const feature = snapshot.features[key];
    if (!feature) return null;
    if (!feature.enabled) return 0;
    return feature.limit ?? null;
  };
  const currentRank = snapshot.plan?.rank ?? -Infinity;
  const upgrades = catalog.plans
    .filter((p) => p.rank > currentRank && upgradeLinks[p.key])
    .map((p) => {
      const url = new URL(upgradeLinks[p.key] as string);
      url.searchParams.set('client_reference_id', user.id);
      url.searchParams.set('prefilled_email', user.email);
      return { key: p.key, name: p.name, url: url.toString() };
    });
  return {
    plan: snapshot.plan ? { key: snapshot.plan.key, name: snapshot.plan.name } : null,
    limits: { products: limit('products'), active_licenses: limit('active_licenses') },
    usage: quotaUsage(ctx, user.id),
    upgrades,
    portalUrl,
  };
}

const LABELS: Record<Quota, [string, string]> = { products: ['product', 'products'], active_licenses: ['active license', 'active licenses'] };

/** Throws when enforcement is on and adding `adding` more would exceed the plan's quota. */
export function assertWithinPlan(ctx: Ctx, user: UserRow, quota: Quota, adding = 1): void {
  if (!ctx.config.billing.enforceLimits) return;
  const plan = accountPlan(ctx, user);
  if (!plan) return;
  const limit = plan.limits[quota];
  if (limit === null || plan.usage[quota] + adding <= limit) return;
  const [one, many] = LABELS[quota];
  throw new ApiError(
    402,
    'invalid_request_error',
    'plan_limit_reached',
    `Your ${plan.plan?.name ?? 'current'} plan includes ${limit} ${limit === 1 ? one : many}. Upgrade your Keyvane plan in Account settings to add more.`,
  );
}

export function ownerOf(ctx: Ctx, projectId: string): UserRow | null {
  return ctx.db.get<UserRow>('SELECT users.* FROM users JOIN projects ON projects.owner_id = users.id WHERE projects.id = ?', projectId) ?? null;
}
