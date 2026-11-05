import { createFeature, createPlan, createProduct, grant, updateProduct } from '../services/catalog.ts';
import type { Actor, Ctx, FeatureRow, PlanRow, ProductRow } from '../types.ts';

/**
 * The "AI PDF Analyzer" example from the Keyvane plan: Free (10 analyses / month),
 * Pro ($12, 500 analyses + export) and Business ($39, 3,000 analyses + export + priority).
 * Used by the demo seed script, the example app and the test suite.
 */
export interface DemoCatalog {
  product: ProductRow;
  plans: { free: PlanRow; pro: PlanRow; business: PlanRow };
  features: { analyses: FeatureRow; export: FeatureRow; priority: FeatureRow };
}

export const DEMO_PRICE_IDS = {
  proMonthly: 'price_demo_pro_monthly',
  proYearly: 'price_demo_pro_yearly',
  businessMonthly: 'price_demo_business_monthly',
};

export function createDemoCatalog(ctx: Ctx, projectId: string, actor: Actor): DemoCatalog {
  return ctx.db.transaction(() => {
    const product = createProduct(
      ctx,
      projectId,
      { name: 'AI PDF Analyzer', key: 'pdf-analyzer', description: 'Summarize and analyze PDF documents with AI.' },
      actor,
    );
    const free = createPlan(ctx, projectId, product.id, { name: 'Free', key: 'free', priceAmount: 0, billingInterval: 'month', rank: 0 }, actor);
    const pro = createPlan(
      ctx,
      projectId,
      product.id,
      {
        name: 'Pro',
        key: 'pro',
        priceAmount: 1200,
        billingInterval: 'month',
        rank: 10,
        maxActivations: 3,
        stripePriceIds: [DEMO_PRICE_IDS.proMonthly, DEMO_PRICE_IDS.proYearly],
      },
      actor,
    );
    const business = createPlan(
      ctx,
      projectId,
      product.id,
      {
        name: 'Business',
        key: 'business',
        priceAmount: 3900,
        billingInterval: 'month',
        rank: 20,
        maxActivations: 10,
        stripePriceIds: [DEMO_PRICE_IDS.businessMonthly],
      },
      actor,
    );
    const analyses = createFeature(
      ctx,
      projectId,
      product.id,
      { name: 'PDF analyses', key: 'pdf_analysis', type: 'metered', resetPeriod: 'month', unit: 'analyses' },
      actor,
    );
    const exportFeature = createFeature(ctx, projectId, product.id, { name: 'Export to Markdown', key: 'export', type: 'boolean' }, actor);
    const priority = createFeature(
      ctx,
      projectId,
      product.id,
      { name: 'Priority processing', key: 'priority_processing', type: 'boolean' },
      actor,
    );
    grant(ctx, free, analyses, 10);
    grant(ctx, pro, analyses, 500);
    grant(ctx, business, analyses, 3000);
    grant(ctx, pro, exportFeature, true);
    grant(ctx, business, exportFeature, true);
    grant(ctx, business, priority, true);
    const updated = updateProduct(ctx, projectId, product.id, { defaultPlanId: free.id }, actor);
    return { product: updated, plans: { free, pro, business }, features: { analyses, export: exportFeature, priority } };
  });
}
