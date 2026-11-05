import type { Hono } from 'hono';
import { html } from '../../lib/html.ts';
import { maskLicenseKey } from '../../lib/license-keys.ts';
import { listAudit } from '../../services/audit.ts';
import { listProducts, loadCatalog, requireFeature } from '../../services/catalog.ts';
import { deleteCustomer, getCustomerById, listCustomers, updateCustomer, upsertCustomer } from '../../services/customers.ts';
import { toCsv } from '../../lib/csv.ts';
import { assertWithinPlan, ownerOf } from '../../services/cloud-billing.ts';
import { snapshotForCustomer } from '../../services/entitlements.ts';
import { createLicense, listLicenses, loadLicenseContext } from '../../services/licenses.ts';
import { listSubscriptionsForCustomer, subscriptionPriceIds } from '../../services/subscriptions.ts';
import { recentUsage, resetUsage } from '../../services/usage.ts';
import { findPlanByStripePrice } from '../../services/catalog.ts';
import { notFound } from '../../lib/errors.ts';
import type { Ctx } from '../../types.ts';
import type { WebEnv } from '../session.ts';
import { badge, emptyState, formatMoney, formatNumber, licenseBadge, meter, pagination, subscriptionBadge, timeTag } from '../ui.ts';
import { actor, base, crumbs, form, formAction, render } from './common.ts';
import { auditHref, timeline } from './activity-format.ts';
import { planOptions } from './licenses.ts';

export function mountCustomers(app: Hono<WebEnv>, ctx: Ctx): void {
  const P = '/app/p/:projectId/customers';

  app.get(P, (c) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const query = c.req.query('q')?.trim() || undefined;
    const result = listCustomers(ctx, project.id, { query, limit: 25, startingAfter: c.req.query('after') });
    const catalogs = listProducts(ctx, project.id).map((p) => loadCatalog(ctx, p));
    const last = result.data.at(-1);
    return render(ctx, c, {
      active: 'customers',
      title: 'Customers',
      lead: 'Everyone who uses your products, identified by your own user ID. See their plan, usage and licenses.',
      content: html`
        <div class="row-between" style="margin-bottom:1rem">
          <form class="search" method="get" action="${b}/customers"><input type="search" name="q" value="${query ?? ''}" placeholder="Search by ID, email or name" aria-label="Search customers"><button class="btn btn-secondary">Search</button></form>
          <details class="disclosure" style="min-width:300px"><summary>Add a customer</summary><div class="disclosure-body">
            <form method="post" action="${b}/customers" class="form">
              <div class="field"><label>Your user ID</label><input aria-label="Your user ID" name="external_id" class="mono" placeholder="user_42" maxlength="200"></div>
              <div class="field"><label>Email <span class="optional">(optional)</span></label><input aria-label="Email" name="email" type="email"></div>
              <div class="field"><label>Name <span class="optional">(optional)</span></label><input aria-label="Name" name="name" maxlength="120"></div>
              <button class="btn btn-primary btn-sm">Add customer</button>
            </form>
          </div></details>
        </div>
        <div class="card card-flush">
          ${result.data.length === 0
            ? emptyState({
                icon: 'users',
                title: query ? 'No customers match your search' : 'No customers yet',
                text: query
                  ? 'Try a different ID, email or name.'
                  : 'Customers appear when your app calls customers.upsert, records usage, when you issue a license, or when someone subscribes through Stripe.',
              })
            : html`<div class="table-wrap"><table class="table">
                <thead><tr><th>Customer</th>${catalogs.length > 0 ? html`<th>Plan</th>` : ''}<th>Licenses</th><th>Stripe</th><th>Last seen</th><th>Created</th></tr></thead>
                <tbody>${result.data.map((customer) => {
                  const licenseCount = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses WHERE customer_id = ?', customer.id)?.n ?? 0;
                  const plans = catalogs.map((cat) => snapshotForCustomer(ctx, cat, customer));
                  return html`<tr>
                    <td><a class="row-link" href="${b}/customers/${customer.id}">${customer.external_id ?? customer.email ?? customer.id}</a>
                      <div class="subtle small">${[customer.name, customer.external_id ? customer.email : null].filter(Boolean).join(' · ') || html`<span class="mono">${customer.id}</span>`}</div></td>
                    ${catalogs.length > 0
                      ? html`<td>${plans.map((s) => (s.plan ? badge(catalogs.length > 1 ? `${s.product.name}: ${s.plan.name}` : s.plan.name, s.source === 'license' ? 'accent' : 'gray', { dot: false }) : html`<span class="subtle">—</span>`))}</td>`
                      : ''}
                    <td>${licenseCount}</td>
                    <td>${customer.stripe_customer_id ? html`<span class="mono small">${customer.stripe_customer_id}</span>` : html`<span class="subtle">—</span>`}</td>
                    <td class="small">${timeTag(customer.last_seen_at, now)}</td>
                    <td class="small">${timeTag(customer.created_at, now, 'date')}</td>
                  </tr>`;
                })}</tbody></table></div>`}
        </div>
        ${pagination(result.hasMore, last ? `${b}/customers?after=${last.id}${query ? `&q=${encodeURIComponent(query)}` : ''}` : null)}`,
    });
  });

  app.post(P, async (c) => {
    const body = await form(c);
    const b = base(c);
    return formAction(
      ctx,
      c,
      () => {
        const { customer } = upsertCustomer(ctx, c.get('project').id, { externalId: body.external_id, email: body.email, name: body.name }, actor(c));
        return `${b}/customers/${customer.id}`;
      },
      { success: 'Customer saved.', redirect: `${b}/customers` },
    );
  });

  app.get(`${P}/:customerId`, (c) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const customer = getCustomerById(ctx, project.id, c.req.param('customerId'));
    if (!customer) throw notFound('Customer');
    const catalogs = listProducts(ctx, project.id).map((p) => loadCatalog(ctx, p));
    const snapshots = catalogs.map((cat) => snapshotForCustomer(ctx, cat, customer));
    const licenses = listLicenses(ctx, project.id, { customerId: customer.id, limit: 100 }).data.map((l) => loadLicenseContext(ctx, l));
    const subscriptions = listSubscriptionsForCustomer(ctx, customer.id);
    const usage = recentUsage(ctx, customer.id, 15);
    const history = listAudit(ctx, project.id, { targetIds: [customer.id, ...licenses.map((l) => l.license.id)], limit: 30 }).data;
    const cb = `${b}/customers/${customer.id}`;

    return render(ctx, c, {
      active: 'customers',
      eyebrow: crumbs(['Customers', `${b}/customers`], customer.id),
      title: customer.external_id ?? customer.email ?? customer.id,
      lead: html`${[customer.name, customer.email].filter(Boolean).join(' · ') || 'No name or email yet'}${customer.stripe_customer_id ? html` · Stripe <span class="mono">${customer.stripe_customer_id}</span>` : ''}`,
      content: html`
        ${snapshots.length === 0 ? html`<div class="callout">This project has no products yet.</div>` : ''}
        <div class="${snapshots.length > 1 ? 'grid-2' : 'grid'}" style="${snapshots.length > 1 ? '' : 'max-width:760px'}">
          ${snapshots.map(
            (snap) => html`<div class="card">
              <div class="card-header">
                <h2>${snap.product.name}</h2>
                <div class="row" style="gap:.4rem">${snap.plan ? badge(snap.plan.name, snap.source === 'license' ? 'accent' : 'gray', { dot: false }) : badge('No plan', 'gray', { dot: false })}
                  ${snap.licenseState ? licenseBadge(snap.licenseState) : ''}</div>
              </div>
              <div class="card-body stack-sm">
                <p class="small muted" style="margin:0">${snap.source === 'license'
                  ? html`From license <a href="${b}/licenses/${snap.license?.id}">${snap.license ? maskLicenseKey(snap.license.key) : ''}</a>${snap.licenseState ? html`. ${snap.licenseState.message}` : ''}`
                  : snap.source === 'default_plan'
                    ? 'No paid license, so the product’s default plan applies.'
                    : 'No license and no default plan, so no features are available.'}</p>
                <table class="table table-sm"><tbody>
                  ${Object.values(snap.features).map(
                    (f) => html`<tr>
                      <td><strong>${f.name}</strong><div class="mono subtle small">${f.key}</div></td>
                      <td style="width:45%">${f.type === 'boolean'
                        ? f.enabled ? badge('included', 'green') : badge('not included', 'gray')
                        : f.enabled
                          ? html`<div class="stack-sm" style="gap:.3rem">${meter(f.used ?? 0, f.limit)}<span class="small muted">${formatNumber(f.used ?? 0)}${f.limit !== null && f.limit !== undefined ? ` of ${formatNumber(f.limit)}` : ''} ${f.unit ?? 'used'}${f.resets_at ? html` · resets ${timeTag(f.resets_at, now)}` : ''}</span></div>`
                          : badge('not included', 'gray')}</td>
                      <td class="right">${f.type === 'metered' && (f.used ?? 0) > 0
                        ? html`<form method="post" action="${cb}/usage/reset" class="inline-form" data-confirm="Reset this period's ${f.name} usage for this customer?"><input type="hidden" name="feature_id" value="${catalogs.find((cat) => cat.product.id === snap.product.id)?.features.find((x) => x.key === f.key)?.id ?? ''}"><button class="btn btn-ghost btn-sm">Reset</button></form>`
                        : ''}</td>
                    </tr>`,
                  )}
                </tbody></table>
              </div>
            </div>`,
          )}
        </div>

        <div class="section-title"><h2>Licenses</h2></div>
        <div class="card card-flush">
          ${licenses.length === 0
            ? html`<div class="card-body muted">No licenses. Customers without a license use the default plan.</div>`
            : html`<div class="table-wrap"><table class="table">
                <thead><tr><th>Key</th><th>Plan</th><th>Status</th><th>Source</th><th>Expires</th><th>Created</th></tr></thead>
                <tbody>${licenses.map(
                  (l) => html`<tr>
                    <td><a class="row-link mono" href="${b}/licenses/${l.license.id}">${maskLicenseKey(l.license.key)}</a></td>
                    <td>${l.product.name} · ${l.plan.name}</td>
                    <td>${licenseBadge(l.state)}</td>
                    <td>${badge(l.license.source, l.license.source === 'stripe' ? 'accent' : 'gray', { dot: false })}</td>
                    <td class="small">${l.license.expires_at ? timeTag(l.license.expires_at, now, 'date') : html`<span class="subtle">Never</span>`}</td>
                    <td class="small">${timeTag(l.license.created_at, now)}</td>
                  </tr>`,
                )}</tbody></table></div>`}
          ${catalogs.some((cat) => cat.plans.length > 0)
            ? html`<div class="card-footer"><details class="disclosure"><summary>Grant a license to this customer</summary><div class="disclosure-body">
                <form method="post" action="${cb}/licenses" class="form">
                  <div class="form-row">
                    <div class="field"><label>Plan</label><select aria-label="Plan" name="plan_id" required>${planOptions(catalogs)}</select></div>
                    <div class="field"><label>Duration</label><select aria-label="Duration" name="duration_days">
                      <option value="">Never expires</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option>
                    </select></div>
                  </div>
                  <div class="field"><label>Internal note <span class="optional">(optional)</span></label><input aria-label="Internal note" name="note" maxlength="500" placeholder="e.g. Beta tester, lifetime deal, support credit"></div>
                  <button class="btn btn-primary btn-sm">Grant license</button>
                </form>
              </div></details></div>`
            : ''}
        </div>

        ${subscriptions.length > 0
          ? html`<div class="section-title"><h2>Stripe subscriptions</h2></div>
            <div class="card card-flush"><div class="table-wrap"><table class="table">
              <thead><tr><th>Subscription</th><th>Status</th><th>Plan</th><th>Amount</th><th>Current period ends</th><th>Updated</th></tr></thead>
              <tbody>${subscriptions.map((s) => {
                const plans = subscriptionPriceIds(s).map((id) => findPlanByStripePrice(ctx, project.id, id)?.name ?? id);
                return html`<tr>
                  <td class="mono small">${s.provider_subscription_id}${s.livemode ? '' : html` ${badge('test', 'yellow', { dot: false })}`}</td>
                  <td>${subscriptionBadge(s.status)}${s.cancel_at_period_end ? html` ${badge('cancels at period end', 'yellow', { dot: false })}` : ''}</td>
                  <td>${plans.join(', ') || '—'}</td>
                  <td>${s.amount !== null && s.currency ? `${formatMoney(s.amount, s.currency)}${s.billing_interval ? ` / ${s.billing_interval}` : ''}` : '—'}</td>
                  <td class="small">${timeTag(s.current_period_end, now, 'date')}</td>
                  <td class="small">${timeTag(s.updated_at, now)}</td>
                </tr>`;
              })}</tbody></table></div></div>`
          : ''}

        <div class="grid-2" style="margin-top:2rem">
          <div class="card"><div class="card-header"><h2>History</h2></div>
            ${history.length ? timeline(history, now, (row) => auditHref(b, row)) : html`<div class="card-body muted small">No events yet.</div>`}</div>
          <div class="stack">
            <div class="card"><div class="card-header"><h2>Recent usage</h2></div>
              ${usage.length
                ? html`<div class="table-wrap" style="border:0"><table class="table table-sm"><tbody>${usage.map(
                    (u) => html`<tr><td>${u.feature_name}</td><td class="right">+${formatNumber(u.quantity)}</td><td class="right small subtle">${timeTag(u.created_at, now)}</td></tr>`,
                  )}</tbody></table></div>`
                : html`<div class="card-body muted small">No usage recorded yet.</div>`}</div>
            <details class="disclosure"><summary>Edit customer</summary><div class="disclosure-body">
              <form method="post" action="${cb}" class="form">
                <div class="field"><label>Your user ID</label><input aria-label="Your user ID" name="external_id" class="mono" value="${customer.external_id ?? ''}" maxlength="200"></div>
                <div class="field"><label>Email</label><input aria-label="Email" name="email" type="email" value="${customer.email ?? ''}"></div>
                <div class="field"><label>Name</label><input aria-label="Name" name="name" value="${customer.name ?? ''}" maxlength="120"></div>
                <button class="btn btn-primary btn-sm">Save</button>
              </form>
            </div></details>
            <section class="danger-zone">
              <h2>Delete customer</h2>
              <p class="muted small">For erasure requests (GDPR / KVKK): deletes this customer, their licenses and devices, usage and history. Stripe is not changed${subscriptions.some((s) => ['active', 'trialing', 'past_due'].includes(s.status)) ? html`, so <strong>cancel their active subscription in Stripe first</strong>` : ''}.</p>
              <form method="post" action="${cb}/delete" data-confirm="Delete this customer and all of their data? This cannot be undone."><button class="btn btn-danger btn-sm">Delete customer</button></form>
            </section>
          </div>
        </div>`,
    });
  });

  app.get('/app/p/:projectId/customers.csv', (c) => {
    const project = c.get('project');
    const rows = ctx.db.all<{ id: string; external_id: string | null; email: string | null; name: string | null; stripe_customer_id: string | null; licenses: number; last_seen_at: string | null; created_at: string }>(
      `SELECT customers.id, customers.external_id, customers.email, customers.name, customers.stripe_customer_id,
              (SELECT COUNT(*) FROM licenses WHERE licenses.customer_id = customers.id) AS licenses,
              customers.last_seen_at, customers.created_at
       FROM customers WHERE project_id = ? ORDER BY customers.id`,
      project.id,
    );
    const csv = toCsv(
      ['id', 'external_id', 'email', 'name', 'stripe_customer_id', 'licenses', 'last_seen_at', 'created_at'],
      rows.map((r) => [r.id, r.external_id, r.email, r.name, r.stripe_customer_id, r.licenses, r.last_seen_at, r.created_at]),
    );
    c.header('Content-Disposition', `attachment; filename="keyvane-customers-${ctx.now().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
  });

  app.post(`${P}/:customerId/delete`, async (c) => {
    const b = base(c);
    return formAction(ctx, c, () => deleteCustomer(ctx, c.get('project').id, c.req.param('customerId'), actor(c)), {
      success: 'Customer deleted with their licenses, usage and history.',
      redirect: `${b}/customers`,
      errorRedirect: `${b}/customers/${c.req.param('customerId')}`,
    });
  });

  app.post(`${P}/:customerId`, async (c) => {
    const body = await form(c);
    const cb = `${base(c)}/customers/${c.req.param('customerId')}`;
    return formAction(
      ctx,
      c,
      () => {
        updateCustomer(ctx, c.get('project').id, c.req.param('customerId'), { externalId: body.external_id, email: body.email, name: body.name }, actor(c));
      },
      { success: 'Customer saved.', redirect: cb },
    );
  });

  app.post(`${P}/:customerId/licenses`, async (c) => {
    const body = await form(c);
    const project = c.get('project');
    const b = base(c);
    const cb = `${b}/customers/${c.req.param('customerId')}`;
    return formAction(
      ctx,
      c,
      () => {
        const customer = getCustomerById(ctx, project.id, c.req.param('customerId'));
        if (!customer) throw notFound('Customer');
        const plan = ctx.db.get<{ id: string; product_id: string }>('SELECT id, product_id FROM plans WHERE id = ? AND project_id = ?', body.plan_id ?? '', project.id);
        if (!plan) throw notFound('Plan');
        const owner = ownerOf(ctx, project.id);
        if (owner) assertWithinPlan(ctx, owner, 'active_licenses');
        const license = createLicense(
          ctx,
          project.id,
          { product: plan.product_id, plan: plan.id, customer: customer.id, durationDays: body.duration_days, note: body.note },
          'dashboard',
          actor(c),
        );
        return `${b}/licenses/${license.id}`;
      },
      { success: 'License granted.', redirect: cb },
    );
  });

  app.post(`${P}/:customerId/usage/reset`, async (c) => {
    const body = await form(c);
    const project = c.get('project');
    const cb = `${base(c)}/customers/${c.req.param('customerId')}`;
    return formAction(
      ctx,
      c,
      () => {
        const customer = getCustomerById(ctx, project.id, c.req.param('customerId'));
        if (!customer) throw notFound('Customer');
        resetUsage(ctx, project.id, customer.id, requireFeature(ctx, project.id, body.feature_id ?? ''), actor(c));
      },
      { success: 'Usage for the current period was reset.', redirect: cb },
    );
  });
}
