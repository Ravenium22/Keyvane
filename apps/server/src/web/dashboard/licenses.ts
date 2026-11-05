import type { Hono } from 'hono';
import { html, type SafeHtml } from '../../lib/html.ts';
import { maskLicenseKey } from '../../lib/license-keys.ts';
import { listAudit } from '../../services/audit.ts';
import { listProducts, loadCatalog, type Catalog } from '../../services/catalog.ts';
import { snapshotForLicense } from '../../services/entitlements.ts';
import {
  createLicense,
  listActivations,
  listLicenses,
  loadLicenseContext,
  removeActivation,
  requireLicense,
  setLicenseStatus,
  updateLicense,
  validateLicense,
  type LicenseAction,
} from '../../services/licenses.ts';
import { serializeEntitlements, serializeLicense } from '../../api/serializers.ts';
import { notFound } from '../../lib/errors.ts';
import { toCsv } from '../../lib/csv.ts';
import { assertWithinPlan, ownerOf } from '../../services/cloud-billing.ts';
import type { Ctx } from '../../types.ts';
import type { WebContext, WebEnv } from '../session.ts';
import { badge, copyButton, emptyState, formatDate, licenseBadge, pagination, planPrice, subscriptionBadge, timeTag } from '../ui.ts';
import { actor, base, crumbs, form, formAction, render } from './common.ts';
import { auditHref, timeline } from './activity-format.ts';

export function planOptions(catalogs: Catalog[], selected?: string): SafeHtml {
  return html`${catalogs
    .filter((cat) => cat.plans.length > 0)
    .map(
      (cat) => html`<optgroup label="${cat.product.name}">${cat.plans.map(
        (p) => html`<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.name}${p.price_amount ? ` (${planPrice(p)})` : ''}</option>`,
      )}</optgroup>`,
    )}`;
}

const DURATIONS: [string, string][] = [
  ['', 'Never expires'],
  ['7', '7 days (trial)'],
  ['14', '14 days'],
  ['30', '30 days'],
  ['90', '90 days'],
  ['365', '1 year'],
  ['730', '2 years'],
];

export function mountLicenses(app: Hono<WebEnv>, ctx: Ctx): void {
  const P = '/app/p/:projectId/licenses';

  app.get(P, (c) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const status = c.req.query('status') || undefined;
    const productId = c.req.query('product') || undefined;
    const query = c.req.query('q')?.trim() || undefined;
    const catalogs = listProducts(ctx, project.id).map((p) => loadCatalog(ctx, p));
    const result = listLicenses(ctx, project.id, { status, productId, query, limit: 25, startingAfter: c.req.query('after') });
    const rows = result.data.map((l) => loadLicenseContext(ctx, l));
    const last = result.data.at(-1);
    const qs = (extra: Record<string, string | undefined>) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ status, product: productId, q: query, ...extra })) if (v) params.set(k, v);
      const s = params.toString();
      return s ? `?${s}` : '';
    };
    return render(ctx, c, {
      active: 'licenses',
      title: 'Licenses',
      lead: 'Every license grants a customer a plan. Stripe subscriptions create them automatically; you can also issue keys by hand.',
      content: html`
        <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start">
          <div class="stack">
            <form class="row" method="get" action="${b}/licenses">
              <input type="search" name="q" value="${query ?? ''}" placeholder="Key, customer, email or note" style="max-width:260px" aria-label="Search licenses">
              <select name="status" style="max-width:150px" aria-label="Filter by status">
                <option value="">All statuses</option>
                ${['active', 'suspended', 'revoked'].map((s) => html`<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`)}
              </select>
              ${catalogs.length > 1
                ? html`<select name="product" style="max-width:180px" aria-label="Filter by product"><option value="">All products</option>${catalogs.map((cat) => html`<option value="${cat.product.id}" ${productId === cat.product.id ? 'selected' : ''}>${cat.product.name}</option>`)}</select>`
                : ''}
              <button class="btn btn-secondary">Filter</button>
            </form>
            <div class="card card-flush">
              ${rows.length === 0
                ? emptyState({ icon: 'key', title: query || status ? 'No licenses match' : 'No licenses yet', text: 'Create one on the right, or connect Stripe so purchases create licenses automatically.' })
                : html`<div class="table-wrap"><table class="table">
                    <thead><tr><th>Key</th><th>Customer</th><th>Plan</th><th>Status</th><th>Devices</th><th>Expires</th></tr></thead>
                    <tbody>${rows.map(
                      (l) => html`<tr>
                        <td><a class="row-link mono" href="${b}/licenses/${l.license.id}">${maskLicenseKey(l.license.key)}</a>
                          <div class="subtle small">${l.license.source === 'stripe' ? 'Stripe' : l.license.source === 'api' ? 'API' : 'Dashboard'} · ${timeTag(l.license.created_at, now)}</div></td>
                        <td>${l.customer ? html`<a href="${b}/customers/${l.customer.id}">${l.customer.external_id ?? l.customer.email ?? l.customer.id}</a>` : html`<span class="subtle">—</span>`}</td>
                        <td>${catalogs.length > 1 ? `${l.product.name} · ` : ''}${l.plan.name}</td>
                        <td>${licenseBadge(l.state)}</td>
                        <td>${l.activations}${l.license.max_activations !== null ? ` / ${l.license.max_activations}` : ''}</td>
                        <td class="small">${l.license.expires_at ? timeTag(l.license.expires_at, now, 'date') : html`<span class="subtle">Never</span>`}</td>
                      </tr>`,
                    )}</tbody></table></div>`}
            </div>
            ${pagination(result.hasMore, last ? `${b}/licenses${qs({ after: last.id })}` : null)}
          </div>
          <div class="card">
            <div class="card-header"><h2>New license</h2></div>
            <div class="card-body">
              ${catalogs.some((cat) => cat.plans.length > 0)
                ? html`<form method="post" action="${b}/licenses" class="form">
                    <div class="field"><label>Plan</label><select aria-label="Plan" name="plan_id" required>${planOptions(catalogs)}</select></div>
                    <div class="field"><label>Customer <span class="optional">(optional)</span></label><input aria-label="Customer" name="customer" class="mono" placeholder="your user ID, e.g. user_42" maxlength="200"><span class="hint">Created automatically if new. Leave empty for a standalone key.</span></div>
                    <div class="field"><label>Duration</label><select aria-label="Duration" name="duration_days">${DURATIONS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
                    <div class="field"><label>Device limit <span class="optional">(optional)</span></label><input aria-label="Device limit" name="max_activations" type="number" min="1" placeholder="Plan default"></div>
                    <div class="field"><label>Internal note <span class="optional">(optional)</span></label><input aria-label="Internal note" name="note" maxlength="500" placeholder="e.g. AppSumo code #123"></div>
                    <button class="btn btn-primary">Create license</button>
                  </form>`
                : html`<p class="muted small">Create a product with at least one plan first.</p><a class="btn btn-secondary btn-sm" href="${b}/products">Go to products</a>`}
            </div>
          </div>
        </div>`,
    });
  });

  app.post(P, async (c) => {
    const body = await form(c);
    const project = c.get('project');
    const b = base(c);
    return formAction(
      ctx,
      c,
      () => {
        const plan = ctx.db.get<{ id: string; product_id: string }>('SELECT id, product_id FROM plans WHERE id = ? AND project_id = ?', body.plan_id ?? '', project.id);
        if (!plan) throw notFound('Plan');
        const owner = ownerOf(ctx, project.id);
        if (owner) assertWithinPlan(ctx, owner, 'active_licenses');
        const license = createLicense(
          ctx,
          project.id,
          {
            product: plan.product_id,
            plan: plan.id,
            customer: body.customer,
            durationDays: body.duration_days,
            maxActivations: body.max_activations === '' ? undefined : body.max_activations,
            note: body.note,
          },
          'dashboard',
          actor(c),
        );
        return `${b}/licenses/${license.id}`;
      },
      { success: 'License created. Copy the key and send it to your customer.', redirect: `${b}/licenses` },
    );
  });

  app.get('/app/p/:projectId/licenses.csv', (c) => {
    const project = c.get('project');
    const rows = ctx.db.all<{ id: string; key: string; status: string; source: string; product: string; plan: string; customer: string | null; email: string | null; expires_at: string | null; max_activations: number | null; note: string | null; created_at: string }>(
      `SELECT licenses.id, licenses.key, licenses.status, licenses.source, products.key AS product, plans.key AS plan,
              customers.external_id AS customer, customers.email AS email, licenses.expires_at, licenses.max_activations,
              licenses.note, licenses.created_at
       FROM licenses JOIN products ON products.id = licenses.product_id JOIN plans ON plans.id = licenses.plan_id
       LEFT JOIN customers ON customers.id = licenses.customer_id
       WHERE licenses.project_id = ? ORDER BY licenses.id`,
      project.id,
    );
    const csv = toCsv(
      ['id', 'key', 'status', 'source', 'product', 'plan', 'customer', 'email', 'expires_at', 'max_activations', 'note', 'created_at'],
      rows.map((r) => [r.id, r.key, r.status, r.source, r.product, r.plan, r.customer, r.email, r.expires_at, r.max_activations, r.note, r.created_at]),
    );
    c.header('Content-Disposition', `attachment; filename="keyvane-licenses-${ctx.now().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
  });

  const detail = async (c: WebContext, testResult?: unknown) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const license = requireLicense(ctx, project.id, c.req.param('licenseId') ?? '');
    const lc = loadLicenseContext(ctx, license);
    const activations = listActivations(ctx, license.id);
    const catalogs = listProducts(ctx, project.id).map((p) => loadCatalog(ctx, p));
    const productCatalog = catalogs.filter((cat) => cat.product.id === license.product_id);
    const history = listAudit(ctx, project.id, { targetIds: [license.id], limit: 30 }).data;
    const lb = `${b}/licenses/${license.id}`;
    const managed = license.source === 'stripe';
    const revoked = license.status === 'revoked';
    const snapshot = snapshotForLicense(ctx, lc);

    const statusAction = (action: LicenseAction, label: string, cls: string, confirm?: string) =>
      html`<form method="post" action="${lb}/status" class="inline-form" ${confirm ? html`data-confirm="${confirm}"` : ''}>
        <input type="hidden" name="action" value="${action}"><button class="${cls}">${label}</button></form>`;

    return render(ctx, c, {
      active: 'licenses',
      eyebrow: crumbs(['Licenses', `${b}/licenses`], license.id),
      title: `${lc.product.name} · ${lc.plan.name}`,
      lead: html`${licenseBadge(lc.state)} <span style="margin-left:.4rem">${lc.state.message}</span>`,
      actions: revoked
        ? ''
        : html`${license.status === 'suspended'
            ? statusAction('reinstate', 'Reinstate', 'btn btn-secondary')
            : statusAction('suspend', 'Suspend', 'btn btn-secondary', 'Suspend this license? The customer loses access until you reinstate it.')}
          ${statusAction('revoke', 'Revoke', 'btn btn-danger', 'Revoke this license permanently? This cannot be undone.')}`,
      content: html`
        <div class="card" style="margin-bottom:1rem"><div class="card-body">
          <div class="label" style="margin-bottom:.4rem">License key</div>
          <div class="copy-field" style="font-size:1.05rem"><code>${license.key}</code>${copyButton(license.key, 'Copy key')}</div>
          <p class="hint" style="margin:.5rem 0 0">Customers enter this key in your app. Treat it like a password.</p>
        </div></div>
        <div class="grid-2">
          <div class="card"><div class="card-header"><h2>Details</h2></div><div class="card-body">
            <dl class="kv">
              <dt>Customer</dt><dd>${lc.customer ? html`<a href="${b}/customers/${lc.customer.id}">${lc.customer.external_id ?? lc.customer.email ?? lc.customer.id}</a>` : html`<span class="subtle">None (standalone key)</span>`}</dd>
              <dt>Product</dt><dd>${lc.product.name}</dd>
              <dt>Plan</dt><dd>${lc.plan.name} <span class="pill">${lc.plan.key}</span></dd>
              <dt>Source</dt><dd>${badge(license.source, managed ? 'accent' : 'gray', { dot: false })}</dd>
              <dt>Created</dt><dd>${timeTag(license.created_at, now, 'datetime')}</dd>
              <dt>Expires</dt><dd>${license.expires_at ? timeTag(license.expires_at, now, 'datetime') : 'Never'}</dd>
              ${lc.state.accessUntil && lc.state.valid ? html`<dt>Access until</dt><dd>${formatDate(lc.state.accessUntil)}</dd>` : ''}
              <dt>Devices</dt><dd>${lc.activations}${license.max_activations !== null ? ` of ${license.max_activations}` : ' (no limit)'}</dd>
              <dt>Last validated</dt><dd>${timeTag(license.last_validated_at, now)}</dd>
              ${license.status_reason ? html`<dt>Status reason</dt><dd>${license.status_reason}</dd>` : ''}
              ${license.note ? html`<dt>Note</dt><dd>${license.note}</dd>` : ''}
              ${lc.subscription
                ? html`<dt>Subscription</dt><dd><span class="mono small">${lc.subscription.provider_subscription_id}</span> ${subscriptionBadge(lc.subscription.status)}
                    <div class="small subtle">Period ends ${formatDate(lc.subscription.current_period_end)}${lc.subscription.cancel_at_period_end ? ' · cancels at period end' : ''}</div></dd>`
                : ''}
            </dl>
          </div></div>
          <div class="stack">
            ${revoked
              ? html`<div class="callout callout-danger">This license was revoked${license.status_changed_at ? ` on ${formatDate(license.status_changed_at)}` : ''}. Revocation is permanent.</div>`
              : html`<div class="card"><div class="card-header"><h2>Edit</h2></div><div class="card-body">
                  <form method="post" action="${lb}" class="form">
                    <div class="field"><label>Plan</label>
                      <select aria-label="Plan" name="plan_id" ${managed ? 'disabled' : ''}>${planOptions(productCatalog, license.plan_id)}</select>
                      ${managed ? html`<span class="hint">Managed by Stripe. Change the subscription in Stripe and Keyvane follows.</span>` : ''}</div>
                    <div class="form-row">
                      <div class="field"><label>Expires on</label><input aria-label="Expires on" name="expires_at" type="date" value="${license.expires_at?.slice(0, 10) ?? ''}"><span class="hint">Empty = never.</span></div>
                      <div class="field"><label>Device limit</label><input aria-label="Device limit" name="max_activations" type="number" min="1" value="${license.max_activations ?? ''}" placeholder="Unlimited"></div>
                    </div>
                    <div class="field"><label>Internal note</label><input aria-label="Internal note" name="note" maxlength="500" value="${license.note ?? ''}"></div>
                    <button class="btn btn-primary btn-sm">Save changes</button>
                  </form>
                </div></div>`}
            <div class="card"><div class="card-header"><h2>Test validation</h2>
              <form method="post" action="${lb}/test" class="inline-form"><button class="btn btn-secondary btn-sm">Validate now</button></form></div>
              <div class="card-body">${testResult
                ? html`<pre class="code json" tabindex="0"><code>${JSON.stringify(testResult, null, 2)}</code></pre>`
                : html`<p class="muted small" style="margin:0">Runs exactly what <code>POST /v1/licenses/validate</code> returns to your app, including entitlements.</p>`}</div></div>
          </div>
        </div>

        <div class="section-title"><h2>What this license unlocks</h2></div>
        <div class="card card-flush"><div class="table-wrap" style="border:0"><table class="table table-sm"><tbody>
          ${Object.values(snapshot.features).map(
            (f) => html`<tr><td><strong>${f.name}</strong> <span class="mono subtle small">${f.key}</span></td>
              <td>${f.type === 'boolean' ? (f.enabled ? badge('included', 'green') : badge('not included', 'gray')) : f.enabled ? (f.limit === null ? 'Unlimited' : `${f.used ?? 0} of ${f.limit} used`) : badge('not included', 'gray')}</td></tr>`,
          )}
          ${Object.keys(snapshot.features).length === 0 ? html`<tr><td class="muted">This product has no features yet.</td></tr>` : ''}
        </tbody></table></div></div>

        <div class="section-title"><h2>Activated devices</h2></div>
        <div class="card card-flush">
          ${activations.length === 0
            ? html`<div class="card-body muted small">No devices yet. Desktop apps and CLIs activate a device with <code>POST /v1/licenses/activate</code>.</div>`
            : html`<div class="table-wrap" style="border:0"><table class="table">
                <thead><tr><th>Device</th><th>Fingerprint</th><th>Activated</th><th>Last seen</th><th><span class="sr-only">Actions</span></th></tr></thead>
                <tbody>${activations.map(
                  (a) => html`<tr><td>${a.name ?? html`<span class="subtle">Unnamed</span>`}</td><td class="mono small">${a.fingerprint}</td>
                    <td class="small">${timeTag(a.created_at, now)}</td><td class="small">${timeTag(a.last_seen_at, now)}</td>
                    <td class="right"><form method="post" action="${lb}/activations/${a.id}/delete" class="inline-form" data-confirm="Deactivate this device?"><button class="btn btn-ghost btn-sm">Deactivate</button></form></td></tr>`,
                )}</tbody></table></div>`}
        </div>

        <div class="section-title"><h2>History</h2></div>
        <div class="card">${history.length ? timeline(history, now, (row) => auditHref(b, row)) : html`<div class="card-body muted small">No events yet.</div>`}</div>`,
    });
  };

  app.get(`${P}/:licenseId`, (c) => detail(c));

  app.post(`${P}/:licenseId/test`, (c) => {
    const project = c.get('project');
    const license = requireLicense(ctx, project.id, c.req.param('licenseId'));
    const result = validateLicense(ctx, project.id, { key: license.key });
    return detail(c, {
      object: 'license_validation',
      valid: result.valid,
      code: result.code,
      message: result.message,
      license: result.context ? serializeLicense(result.context) : null,
      entitlements: result.valid && result.context ? serializeEntitlements(snapshotForLicense(ctx, result.context)) : null,
    });
  });

  app.post(`${P}/:licenseId`, async (c) => {
    const body = await form(c);
    const lb = `${base(c)}/licenses/${c.req.param('licenseId')}`;
    return formAction(
      ctx,
      c,
      () => {
        const license = requireLicense(ctx, c.get('project').id, c.req.param('licenseId'));
        updateLicense(
          ctx,
          c.get('project').id,
          license.id,
          {
            plan: license.source === 'stripe' ? undefined : body.plan_id,
            expiresAt: body.expires_at ?? '',
            maxActivations: body.max_activations ?? '',
            note: body.note ?? '',
          },
          actor(c),
        );
      },
      { success: 'License updated.', redirect: lb },
    );
  });

  app.post(`${P}/:licenseId/status`, async (c) => {
    const body = await form(c);
    const lb = `${base(c)}/licenses/${c.req.param('licenseId')}`;
    const action = body.action as LicenseAction;
    const labels: Record<LicenseAction, string> = { suspend: 'License suspended.', reinstate: 'License reinstated.', revoke: 'License revoked.' };
    return formAction(
      ctx,
      c,
      () => {
        if (!['suspend', 'reinstate', 'revoke'].includes(action)) throw notFound('Action');
        setLicenseStatus(ctx, c.get('project').id, c.req.param('licenseId'), action, body.reason || null, actor(c));
      },
      { success: labels[action] ?? 'Updated.', redirect: lb },
    );
  });

  app.post(`${P}/:licenseId/activations/:activationId/delete`, async (c) => {
    const lb = `${base(c)}/licenses/${c.req.param('licenseId')}`;
    return formAction(ctx, c, () => removeActivation(ctx, c.get('project').id, c.req.param('activationId'), actor(c)), {
      success: 'Device deactivated.',
      redirect: lb,
    });
  });
}
