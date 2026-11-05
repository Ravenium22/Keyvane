import { createFeature, createPlan, createProduct, grant, updateProduct } from '../services/catalog.ts';
import { createProject } from '../services/projects.ts';
import type { Actor, Ctx, ProjectRow, UserRow } from '../types.ts';
import { PRICING } from '../web/pricing.ts';

/**
 * Creates the "Keyvane Cloud" project used to bill this instance's own users, based on
 * the pricing tiers on the landing page. Quotas start unlimited except the Developer
 * plan's single product (from the business plan); adjust them in the dashboard.
 */
export function setupCloudBilling(ctx: Ctx, owner: UserRow): { project: ProjectRow; plans: string[] } {
  const actor: Actor = { type: 'user', id: owner.id, label: owner.email };
  return ctx.db.transaction(() => {
    const project = createProject(ctx, owner.id, { name: 'Keyvane Cloud billing' }, actor);
    const product = createProduct(ctx, project.id, { name: 'Keyvane Cloud', key: ctx.config.billing.productKey }, actor);
    const products = createFeature(ctx, project.id, product.id, { name: 'Products', key: 'products', type: 'metered', resetPeriod: 'never', unit: 'products' }, actor);
    const licenses = createFeature(ctx, project.id, product.id, { name: 'Active licenses', key: 'active_licenses', type: 'metered', resetPeriod: 'never', unit: 'licenses' }, actor);
    const auditLog = createFeature(ctx, project.id, product.id, { name: 'Audit log', key: 'audit_log', type: 'boolean' }, actor);
    const team = createFeature(ctx, project.id, product.id, { name: 'Team members', key: 'team_members', type: 'boolean' }, actor);
    let defaultPlanId: string | null = null;
    PRICING.forEach((tier, i) => {
      const amount = /^\$\d+$/.test(tier.price) ? Number(tier.price.slice(1)) * 100 : null;
      const plan = createPlan(
        ctx,
        project.id,
        product.id,
        { name: tier.name, key: tier.key, rank: i * 10, priceAmount: amount ?? '', billingInterval: amount === null ? '' : 'month' },
        actor,
      );
      if (tier.key === 'developer') {
        defaultPlanId = plan.id;
        grant(ctx, plan, products, 1);
      } else {
        grant(ctx, plan, products, null);
      }
      grant(ctx, plan, licenses, null);
      grant(ctx, plan, auditLog, tier.key === 'startup' || tier.key === 'business');
      grant(ctx, plan, team, tier.key === 'startup' || tier.key === 'business');
    });
    updateProduct(ctx, project.id, product.id, { defaultPlanId }, actor);
    return { project, plans: PRICING.map((t) => t.key) };
  });
}
