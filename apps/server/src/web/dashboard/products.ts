import type { Hono } from 'hono';
import { html, type SafeHtml } from '../../lib/html.ts';
import {
  CANCELLATION_POLICIES,
  cellFor,
  createFeature,
  createPlan,
  createProduct,
  deleteFeature,
  deletePlan,
  deleteProduct,
  listProducts,
  loadCatalog,
  planPriceIds,
  requireFeature,
  requirePlan,
  requireProduct,
  setEntitlements,
  updateFeature,
  updatePlan,
  updateProduct,
  type Catalog,
  type MatrixCell,
} from '../../services/catalog.ts';
import type { Ctx, FeatureRow, PlanRow, ProductRow } from '../../types.ts';
import type { WebEnv } from '../session.ts';
import { badge, copyButton, emptyState, highlight, icon, planPrice, pluralize } from '../ui.ts';
import { actor, base, crumbs, form, formAction, render } from './common.ts';
import { assertWithinPlan, ownerOf } from '../../services/cloud-billing.ts';

const RESET_LABELS: Record<string, string> = { day: 'Resets daily', month: 'Resets monthly', year: 'Resets yearly', never: 'Lifetime (never resets)' };
const POLICY_LABELS: Record<string, string> = {
  immediate: 'End access when Stripe ends the subscription (recommended)',
  period_end: 'Keep access until the end of the paid period, even if canceled immediately',
};

function licenseCounts(ctx: Ctx, productId: string): Map<string, number> {
  const rows = ctx.db.all<{ plan_id: string; n: number }>('SELECT plan_id, COUNT(*) AS n FROM licenses WHERE product_id = ? GROUP BY plan_id', productId);
  return new Map(rows.map((r) => [r.plan_id, r.n]));
}

function planForm(action: string, plan: PlanRow | null, submit: string): SafeHtml {
  return html`<form method="post" action="${action}" class="form">
    <div class="form-row">
      <div class="field"><label>Name</label><input aria-label="Name" name="name" type="text" required maxlength="60" value="${plan?.name ?? ''}" placeholder="Pro"></div>
      <div class="field"><label>Key <span class="optional">${plan ? '' : '(optional)'}</span></label><input aria-label="Key" name="key" type="text" class="mono" maxlength="63" value="${plan?.key ?? ''}" placeholder="pro" ${plan ? 'required' : ''}><span class="hint">Used in your code. Lowercase letters, numbers, - _ .</span></div>
    </div>
    <div class="form-row-3">
      <div class="field"><label>Display price <span class="optional">(optional)</span></label><input aria-label="Display price" name="price" type="text" inputmode="decimal" value="${plan && plan.price_amount !== null ? (plan.price_amount / 100).toString() : ''}" placeholder="12"></div>
      <div class="field"><label>Currency</label><input aria-label="Currency" name="currency" type="text" maxlength="3" value="${plan?.currency ?? 'usd'}"></div>
      <div class="field"><label>Interval</label><select aria-label="Interval" name="billing_interval">
        ${[['month', 'per month'], ['year', 'per year'], ['one_time', 'one-time'], ['', 'none']].map(
          ([v, l]) => html`<option value="${v}" ${(plan ? (plan.billing_interval ?? '') : 'month') === v ? 'selected' : ''}>${l}</option>`,
        )}
      </select></div>
    </div>
    <div class="field"><label>Stripe price IDs <span class="optional">(optional)</span></label>
      <input aria-label="Stripe price IDs" name="stripe_price_ids" type="text" class="mono" value="${plan ? planPriceIds(plan).join(', ') : ''}" placeholder="price_1Qx…monthly, price_1Qx…yearly">
      <span class="hint">Subscriptions to these Stripe prices get this plan. Separate several prices (e.g. monthly and yearly) with commas.</span></div>
    <div class="form-row">
      <div class="field"><label>Device limit per license <span class="optional">(optional)</span></label><input aria-label="Device limit per license" name="max_activations" type="number" min="1" value="${plan?.max_activations ?? ''}" placeholder="Unlimited"><span class="hint">For license keys used on desktop apps and CLIs.</span></div>
      <div class="field"><label>Rank</label><input aria-label="Rank" name="rank" type="number" value="${plan?.rank ?? ''}" placeholder="auto"><span class="hint">Higher rank wins when a customer has several licenses.</span></div>
    </div>
    <div class="field"><label>Description <span class="optional">(optional)</span></label><input aria-label="Description" name="description" type="text" maxlength="300" value="${plan?.description ?? ''}"></div>
    <div class="form-actions"><button class="btn btn-primary" type="submit">${submit}</button></div>
  </form>`;
}

function featureForm(action: string, feature: FeatureRow | null, submit: string): SafeHtml {
  return html`<form method="post" action="${action}" class="form">
    <div class="form-row">
      <div class="field"><label>Name</label><input aria-label="Name" name="name" type="text" required maxlength="60" value="${feature?.name ?? ''}" placeholder="PDF analyses"></div>
      <div class="field"><label>Key <span class="optional">${feature ? '' : '(optional)'}</span></label><input aria-label="Key" name="key" type="text" class="mono" maxlength="63" value="${feature?.key ?? ''}" placeholder="pdf_analysis" ${feature ? 'disabled' : ''}><span class="hint">${feature ? 'Keys cannot be changed because your code uses them.' : 'Used in your code, e.g. can("export").'}</span></div>
    </div>
    ${feature
      ? html`<div class="field"><span class="label">Type</span><div>${badge(feature.type === 'metered' ? 'Metered (usage limit)' : 'On/off', feature.type === 'metered' ? 'blue' : 'gray', { dot: false })}</div></div>`
      : html`<div class="field"><span class="label">Type</span>
          <label class="checkbox"><input type="radio" name="type" value="boolean" checked> On/off, for example “Export to Markdown”</label>
          <label class="checkbox"><input type="radio" name="type" value="metered"> Metered: a usage limit such as “500 PDF analyses per month”</label>
        </div>`}
    <div class="form-row">
      <div class="field"><label>Usage resets <span class="optional">(metered only)</span></label><select aria-label="Usage resets" name="reset_period">
        ${Object.entries(RESET_LABELS).map(([v, l]) => html`<option value="${v}" ${(feature?.reset_period ?? 'month') === v ? 'selected' : ''}>${l}</option>`)}
      </select></div>
      <div class="field"><label>Unit <span class="optional">(optional)</span></label><input aria-label="Unit" name="unit" type="text" maxlength="30" value="${feature?.unit ?? ''}" placeholder="analyses"></div>
    </div>
    <div class="field"><label>Description <span class="optional">(optional)</span></label><input aria-label="Description" name="description" type="text" maxlength="300" value="${feature?.description ?? ''}"></div>
    <div class="form-actions"><button class="btn btn-primary" type="submit">${submit}</button></div>
  </form>`;
}

function matrix(b: string, catalog: Catalog): SafeHtml {
  const { product, plans, features } = catalog;
  if (plans.length === 0 || features.length === 0) {
    return html`<div class="card"><div class="card-body muted">Add at least one plan and one feature to define what each plan unlocks.</div></div>`;
  }
  return html`<form method="post" action="${b}/products/${product.id}/entitlements" class="card card-flush">
    <div class="table-wrap"><table class="table matrix">
      <thead><tr><th>Feature</th>${plans.map(
        (p) => html`<th><div class="plan-head"><strong>${p.name}</strong><span class="subtle">${planPrice(p)}</span></div></th>`,
      )}</tr></thead>
      <tbody>
        ${features.map(
          (f) => html`<tr>
            <td><strong>${f.name}</strong><div class="subtle small mono">${f.key}</div>
              <div class="subtle small">${f.type === 'metered' ? `${RESET_LABELS[f.reset_period]}${f.unit ? ` · ${f.unit}` : ''}` : 'On/off'}</div></td>
            ${plans.map((p) => {
              const cell = cellFor(catalog, p.id, f.id);
              const enabled = cell?.enabled === 1;
              const name = `${p.id}__${f.id}`;
              if (f.type === 'boolean') {
                return html`<td><label class="cell checkbox"><input type="checkbox" name="on__${name}" ${enabled ? 'checked' : ''} aria-label="${f.name} on ${p.name}"></label></td>`;
              }
              return html`<td><span class="cell">
                <input type="checkbox" name="on__${name}" ${enabled ? 'checked' : ''} data-limit-toggle="limit__${name}" aria-label="${f.name} on ${p.name}">
                <input type="number" min="0" id="limit__${name}" name="limit__${name}" value="${enabled && cell?.limit_value !== null && cell?.limit_value !== undefined ? cell.limit_value : ''}" placeholder="∞" aria-label="${f.name} limit on ${p.name}">
              </span></td>`;
            })}
          </tr>`,
        )}
      </tbody>
    </table></div>
    <div class="card-footer row-between"><span class="hint">Metered features: leave the limit empty for unlimited. Changes apply to all customers immediately.</span><button class="btn btn-primary" type="submit">Save entitlements</button></div>
  </form>`;
}

function snippet(product: ProductRow, features: FeatureRow[]): string {
  const bool = features.find((f) => f.type === 'boolean');
  const metered = features.find((f) => f.type === 'metered');
  return `const access = await keyvane.entitlements.get({
  customer: user.id,       // your own user ID
  product: '${product.key}',
});

access.plan?.key;          // ${'\''}free${'\''}, ${'\''}pro${'\''}, …${bool ? `\naccess.can('${bool.key}');   // true / false` : ''}${metered ? `\naccess.remaining('${metered.key}');\n\n// Consume usage (atomic, limit-enforced)\nawait keyvane.usage.record({\n  customer: user.id,\n  feature: '${metered.key}',\n});` : ''}`;
}

export function mountProducts(app: Hono<WebEnv>, ctx: Ctx): void {
  const P = '/app/p/:projectId/products';

  app.get(P, (c) => {
    const project = c.get('project');
    const b = base(c);
    const products = listProducts(ctx, project.id).map((p) => loadCatalog(ctx, p));
    return render(ctx, c, {
      active: 'products',
      title: 'Products & plans',
      lead: 'Each product has plans (Free, Pro, Business…) and features. The plan × feature matrix defines what customers may do.',
      content: html`
        ${products.length === 0
          ? html`<div class="card">${emptyState({ icon: 'box', title: 'Create your first product', text: 'A product is something you sell, like a SaaS app, an API or a desktop tool.' })}</div>`
          : html`<div class="grid-2">${products.map((cat) => {
              const licenses = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses WHERE product_id = ?', cat.product.id)?.n ?? 0;
              return html`<a class="card card-body" href="${b}/products/${cat.product.id}" style="color:inherit;text-decoration:none">
                <div class="row-between"><h2 style="margin:0;font-size:1.15rem">${cat.product.name}</h2><span class="pill">${cat.product.key}</span></div>
                ${cat.product.description ? html`<p class="muted small" style="margin:.4rem 0 0">${cat.product.description}</p>` : ''}
                <div class="row" style="margin-top:.9rem;gap:.4rem">${cat.plans.map((p) => badge(`${p.name} · ${planPrice(p)}`, p.id === cat.product.default_plan_id ? 'gray' : 'accent', { dot: false }))}</div>
                <div class="small subtle" style="margin-top:.8rem">${pluralize(cat.features.length, 'feature')} · ${pluralize(licenses, 'license')}</div>
              </a>`;
            })}</div>`}
        <div class="section-title"><h2>New product</h2></div>
        <div class="card" style="max-width:720px"><div class="card-body">
          <form method="post" action="${b}/products" class="form">
            <div class="form-row">
              <div class="field"><label for="name">Name</label><input id="name" name="name" required maxlength="80" placeholder="AI PDF Analyzer"></div>
              <div class="field"><label for="key">Key <span class="optional">(optional)</span></label><input id="key" name="key" class="mono" maxlength="63" placeholder="pdf-analyzer"><span class="hint">Generated from the name if empty.</span></div>
            </div>
            <div class="field"><label for="description">Description <span class="optional">(optional)</span></label><input id="description" name="description" maxlength="500"></div>
            <label class="checkbox"><input type="checkbox" name="template" value="tiers" checked> Start with Free, Pro and Business plans</label>
            <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('plus', 'icon icon-sm')}Create product</button></div>
          </form>
        </div></div>`,
    });
  });

  app.post(P, async (c) => {
    const body = await form(c);
    const b = base(c);
    return formAction(
      ctx,
      c,
      () => {
        const owner = ownerOf(ctx, c.get('project').id);
        if (owner) assertWithinPlan(ctx, owner, 'products');
        const product = createProduct(
          ctx,
          c.get('project').id,
          { name: body.name, key: body.key, description: body.description, template: body.template === 'tiers' ? 'tiers' : 'blank' },
          actor(c),
        );
        return `${b}/products/${product.id}`;
      },
      { success: 'Product created. Next, add features and choose what each plan unlocks.', redirect: `${b}/products` },
    );
  });

  app.get(`${P}/:productId`, (c) => {
    const project = c.get('project');
    const b = base(c);
    const product = requireProduct(ctx, project.id, c.req.param('productId'));
    const catalog = loadCatalog(ctx, product);
    const counts = licenseCounts(ctx, product.id);
    const pb = `${b}/products/${product.id}`;
    return render(ctx, c, {
      active: 'products',
      eyebrow: crumbs(['Products', `${b}/products`], product.name),
      title: product.name,
      lead: html`${product.description ? html`${product.description} · ` : ''}Key <span class="pill">${product.key}</span> ${copyButton(product.key, 'Copy', 'btn btn-ghost btn-sm')}`,
      content: html`
        <div class="section-title" style="margin-top:0"><h2>Plans</h2></div>
        <div class="card card-flush">
          ${catalog.plans.length === 0
            ? html`<div class="card-body muted">No plans yet. Add Free, Pro and Business below.</div>`
            : html`<div class="table-wrap"><table class="table">
                <thead><tr><th>Plan</th><th>Price</th><th>Stripe prices</th><th>Devices</th><th>Licenses</th><th><span class="sr-only">Actions</span></th></tr></thead>
                <tbody>${catalog.plans.map(
                  (p) => html`<tr>
                    <td><a class="row-link" href="${pb}/plans/${p.id}">${p.name}</a> ${p.id === product.default_plan_id ? badge('default', 'blue', { dot: false }) : ''}<div class="subtle small mono">${p.key}</div></td>
                    <td>${planPrice(p)}</td>
                    <td>${planPriceIds(p).length ? planPriceIds(p).map((id) => html`<div class="mono small">${id}</div>`) : html`<span class="subtle small">Not mapped</span>`}</td>
                    <td>${p.max_activations ?? html`<span class="subtle">∞</span>`}</td>
                    <td>${counts.get(p.id) ?? 0}</td>
                    <td class="right"><a class="btn btn-ghost btn-sm" href="${pb}/plans/${p.id}">Edit</a></td>
                  </tr>`,
                )}</tbody></table></div>`}
          <div class="card-footer"><details class="disclosure"><summary>Add a plan</summary><div class="disclosure-body">${planForm(`${pb}/plans`, null, 'Add plan')}</div></details></div>
        </div>

        <div class="section-title"><h2>Features</h2></div>
        <div class="card card-flush">
          ${catalog.features.length === 0
            ? html`<div class="card-body muted">No features yet. Add on/off features (like “Export”) and metered ones (like “PDF analyses”).</div>`
            : html`<div class="table-wrap"><table class="table">
                <thead><tr><th>Feature</th><th>Type</th><th>Resets</th><th><span class="sr-only">Actions</span></th></tr></thead>
                <tbody>${catalog.features.map(
                  (f) => html`<tr>
                    <td><a class="row-link" href="${pb}/features/${f.id}">${f.name}</a><div class="subtle small mono">${f.key}</div></td>
                    <td>${f.type === 'metered' ? badge('metered', 'blue', { dot: false }) : badge('on/off', 'gray', { dot: false })}</td>
                    <td class="small">${f.type === 'metered' ? `${RESET_LABELS[f.reset_period]}${f.unit ? ` · ${f.unit}` : ''}` : html`<span class="subtle">—</span>`}</td>
                    <td class="right"><a class="btn btn-ghost btn-sm" href="${pb}/features/${f.id}">Edit</a></td>
                  </tr>`,
                )}</tbody></table></div>`}
          <div class="card-footer"><details class="disclosure" ${catalog.features.length === 0 ? 'open' : ''}><summary>Add a feature</summary><div class="disclosure-body">${featureForm(`${pb}/features`, null, 'Add feature')}</div></details></div>
        </div>

        <div class="section-title"><h2>What each plan unlocks</h2></div>
        ${matrix(b, catalog)}

        <div class="grid-2" style="margin-top:2rem">
          <div class="card"><div class="card-header"><h2>Access policy</h2></div><div class="card-body">
            <form method="post" action="${pb}" class="form">
              <div class="form-row">
                <div class="field"><label>Name</label><input aria-label="Name" name="name" required maxlength="80" value="${product.name}"></div>
                <div class="field"><label>Default plan</label><select aria-label="Default plan" name="default_plan_id">
                  <option value="">None (customers without a license get nothing)</option>
                  ${catalog.plans.map((p) => html`<option value="${p.id}" ${p.id === product.default_plan_id ? 'selected' : ''}>${p.name}</option>`)}
                </select></div>
              </div>
              <div class="field"><label>Description</label><input aria-label="Description" name="description" maxlength="500" value="${product.description ?? ''}"></div>
              <div class="field"><span class="label">When a subscription is canceled</span>
                ${CANCELLATION_POLICIES.map((v) => html`<label class="checkbox"><input type="radio" name="cancellation_policy" value="${v}" ${product.cancellation_policy === v ? 'checked' : ''}> ${POLICY_LABELS[v]}</label>`)}
                <span class="hint">Customers who cancel from the Stripe portal keep access until the period ends either way. Subscriptions that end because of failed payments always lose access immediately.</span>
              </div>
              <div class="field"><label>Grace period after a failed payment</label>
                <div class="row"><input name="grace_period_days" aria-label="Grace period in days" type="number" min="0" max="60" value="${product.grace_period_days}" style="max-width:110px"><span class="muted">days</span></div>
                <span class="hint">Access continues while Stripe retries the payment. 0 = revoke on the first failure.</span></div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">Save policy</button></div>
            </form>
          </div></div>
          <div class="stack">
            <div class="card"><div class="card-header"><h2>Use it in your code</h2><a class="btn btn-ghost btn-sm" href="/docs/sdk">SDK docs</a></div>
              <div class="card-body"><pre class="code" tabindex="0"><code>${highlight(snippet(product, catalog.features))}</code></pre></div></div>
            <div class="card danger-zone"><div class="card-header"><h2>Delete product</h2></div><div class="card-body">
              <p class="muted small">Deletes the product, its plans and features. Only possible when no licenses exist for it.</p>
              <form method="post" action="${pb}/delete" data-confirm="Delete ${product.name}? This cannot be undone."><button class="btn btn-danger btn-sm">Delete product</button></form>
            </div></div>
          </div>
        </div>`,
    });
  });

  app.post(`${P}/:productId`, async (c) => {
    const body = await form(c);
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(
      ctx,
      c,
      () => {
        updateProduct(
          ctx,
          c.get('project').id,
          c.req.param('productId'),
          {
            name: body.name,
            description: body.description,
            defaultPlanId: body.default_plan_id ?? '',
            cancellationPolicy: body.cancellation_policy,
            gracePeriodDays: body.grace_period_days,
          },
          actor(c),
        );
      },
      { success: 'Access policy saved.', redirect: pb },
    );
  });

  app.post(`${P}/:productId/delete`, async (c) => {
    const b = base(c);
    return formAction(ctx, c, () => deleteProduct(ctx, c.get('project').id, c.req.param('productId'), actor(c)), {
      success: 'Product deleted.',
      redirect: `${b}/products`,
      errorRedirect: `${b}/products/${c.req.param('productId')}`,
    });
  });

  app.post(`${P}/:productId/entitlements`, async (c) => {
    const body = await form(c);
    const project = c.get('project');
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(
      ctx,
      c,
      () => {
        const catalog = loadCatalog(ctx, requireProduct(ctx, project.id, c.req.param('productId')));
        const cells: MatrixCell[] = [];
        for (const plan of catalog.plans) {
          for (const feature of catalog.features) {
            const name = `${plan.id}__${feature.id}`;
            const enabled = body[`on__${name}`] === 'on';
            const raw = (body[`limit__${name}`] ?? '').trim();
            const limit = feature.type === 'metered' && enabled && raw !== '' ? Number(raw) : null;
            cells.push({ planId: plan.id, featureId: feature.id, enabled, limit: Number.isNaN(limit) ? -1 : limit });
          }
        }
        setEntitlements(ctx, project.id, catalog.product.id, cells, actor(c));
      },
      { success: 'Entitlements saved. They apply to every customer right away.', redirect: pb },
    );
  });

  // --- Plans ---
  app.post(`${P}/:productId/plans`, async (c) => {
    const body = await form(c);
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(
      ctx,
      c,
      () => {
        createPlan(ctx, c.get('project').id, c.req.param('productId'), planInput(body), actor(c));
      },
      { success: 'Plan added.', redirect: pb },
    );
  });

  app.get(`${P}/:productId/plans/:planId`, (c) => {
    const project = c.get('project');
    const b = base(c);
    const product = requireProduct(ctx, project.id, c.req.param('productId'));
    const plan = requirePlan(ctx, project.id, c.req.param('planId'));
    const pb = `${b}/products/${product.id}`;
    const licenses = licenseCounts(ctx, product.id).get(plan.id) ?? 0;
    return render(ctx, c, {
      active: 'products',
      eyebrow: crumbs(['Products', `${b}/products`], [product.name, pb], 'Plans'),
      title: plan.name,
      lead: html`Key <span class="pill">${plan.key}</span> · ${pluralize(licenses, 'license')}`,
      content: html`<div class="grid-2">
        <div class="card"><div class="card-header"><h2>Edit plan</h2></div><div class="card-body">${planForm(`${pb}/plans/${plan.id}`, plan, 'Save plan')}</div></div>
        <div class="stack">
          <div class="callout callout-info"><p><strong>Mapping Stripe prices.</strong> In Stripe, open the product and copy each price ID (it starts with <code>price_</code>). When a customer subscribes to one of these prices, Keyvane gives them this plan.</p></div>
          <div class="card danger-zone"><div class="card-header"><h2>Delete plan</h2></div><div class="card-body">
            <p class="muted small">Only possible when no licenses use this plan.</p>
            <form method="post" action="${pb}/plans/${plan.id}/delete" data-confirm="Delete the ${plan.name} plan?"><button class="btn btn-danger btn-sm" ${licenses > 0 ? 'disabled' : ''}>Delete plan</button></form>
          </div></div>
        </div>
      </div>`,
    });
  });

  app.post(`${P}/:productId/plans/:planId`, async (c) => {
    const body = await form(c);
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(
      ctx,
      c,
      () => {
        updatePlan(ctx, c.get('project').id, c.req.param('planId'), planInput(body), actor(c));
      },
      { success: 'Plan saved.', redirect: pb, errorRedirect: `${pb}/plans/${c.req.param('planId')}` },
    );
  });

  app.post(`${P}/:productId/plans/:planId/delete`, async (c) => {
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(ctx, c, () => deletePlan(ctx, c.get('project').id, c.req.param('planId'), actor(c)), {
      success: 'Plan deleted.',
      redirect: pb,
      errorRedirect: `${pb}/plans/${c.req.param('planId')}`,
    });
  });

  // --- Features ---
  app.post(`${P}/:productId/features`, async (c) => {
    const body = await form(c);
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(
      ctx,
      c,
      () => {
        createFeature(
          ctx,
          c.get('project').id,
          c.req.param('productId'),
          { name: body.name, key: body.key, type: body.type, resetPeriod: body.reset_period, unit: body.unit, description: body.description },
          actor(c),
        );
      },
      { success: 'Feature added. Now decide which plans include it.', redirect: pb },
    );
  });

  app.get(`${P}/:productId/features/:featureId`, (c) => {
    const project = c.get('project');
    const b = base(c);
    const product = requireProduct(ctx, project.id, c.req.param('productId'));
    const feature = requireFeature(ctx, project.id, c.req.param('featureId'));
    const pb = `${b}/products/${product.id}`;
    return render(ctx, c, {
      active: 'products',
      eyebrow: crumbs(['Products', `${b}/products`], [product.name, pb], 'Features'),
      title: feature.name,
      lead: html`Key <span class="pill">${feature.key}</span> ${copyButton(feature.key, 'Copy', 'btn btn-ghost btn-sm')}`,
      content: html`<div class="grid-2">
        <div class="card"><div class="card-header"><h2>Edit feature</h2></div><div class="card-body">${featureForm(`${pb}/features/${feature.id}`, feature, 'Save feature')}</div></div>
        <div class="card danger-zone"><div class="card-header"><h2>Delete feature</h2></div><div class="card-body">
          <p class="muted small">Removes the feature from every plan and deletes its usage history. Apps that check this key will see it as not included.</p>
          <form method="post" action="${pb}/features/${feature.id}/delete" data-confirm="Delete ${feature.name} and its usage history?"><button class="btn btn-danger btn-sm">Delete feature</button></form>
        </div></div>
      </div>`,
    });
  });

  app.post(`${P}/:productId/features/:featureId`, async (c) => {
    const body = await form(c);
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(
      ctx,
      c,
      () => {
        updateFeature(
          ctx,
          c.get('project').id,
          c.req.param('featureId'),
          { name: body.name, resetPeriod: body.reset_period, unit: body.unit, description: body.description },
          actor(c),
        );
      },
      { success: 'Feature saved.', redirect: pb, errorRedirect: `${pb}/features/${c.req.param('featureId')}` },
    );
  });

  app.post(`${P}/:productId/features/:featureId/delete`, async (c) => {
    const pb = `${base(c)}/products/${c.req.param('productId')}`;
    return formAction(ctx, c, () => deleteFeature(ctx, c.get('project').id, c.req.param('featureId'), actor(c)), {
      success: 'Feature deleted.',
      redirect: pb,
    });
  });
}

function planInput(body: Record<string, string>) {
  return {
    name: body.name,
    key: body.key === '' ? undefined : body.key,
    description: body.description ?? '',
    priceAmount: body.price ?? '',
    currency: body.currency,
    billingInterval: body.billing_interval ?? '',
    maxActivations: body.max_activations ?? '',
    stripePriceIds: body.stripe_price_ids ?? '',
    rank: body.rank === '' || body.rank === undefined ? undefined : body.rank,
  };
}
