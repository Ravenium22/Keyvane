import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { html } from '../../lib/html.ts';
import { listApiKeys } from '../../services/api-keys.ts';
import { listAudit } from '../../services/audit.ts';
import { listProducts } from '../../services/catalog.ts';
import { countCustomers } from '../../services/customers.ts';
import { countLicenses } from '../../services/licenses.ts';
import { createProject, getProjectForUser, listProjectsForUser, webhookUrl } from '../../services/projects.ts';
import { allTime, series, total } from '../../services/stats.ts';
import { countSubscriptions, mrrByCurrency } from '../../services/subscriptions.ts';
import { webhookCounts } from '../../services/stripe/webhooks.ts';
import { changePassword, deleteAccount, updateProfile } from '../../services/users.ts';
import { ApiError } from '../../lib/errors.ts';
import { endSession, setFlash } from '../session.ts';
import { createDemoCatalog } from '../../dev/demo-catalog.ts';
import { accountPlan, assertWithinPlan } from '../../services/cloud-billing.ts';
import { platformMetrics } from '../../services/metrics.ts';
import { notFound } from '../../lib/errors.ts';
import type { Ctx } from '../../types.ts';
import { LAST_PROJECT_COOKIE, type WebEnv } from '../session.ts';
import { barChart, copyField, formatMoney, formatNumber, icon, timeTag } from '../ui.ts';
import { actor, base, currentUser, form, formAction, projectMiddleware, render } from './common.ts';
import { auditHref, timeline } from './activity-format.ts';

export function mountOverview(app: Hono<WebEnv>, ctx: Ctx): void {
  app.get('/app', (c) => {
    const user = currentUser(c);
    const last = getCookie(c, LAST_PROJECT_COOKIE);
    if (last && getProjectForUser(ctx, last, user.id)) return c.redirect(`/app/p/${last}`, 303);
    const [first] = listProjectsForUser(ctx, user.id);
    return c.redirect(first ? `/app/p/${first.id}` : '/app/projects/new', 303);
  });

  app.get('/app/projects/new', (c) => {
    const welcome = c.req.query('welcome') === '1';
    const hasProjects = listProjectsForUser(ctx, currentUser(c).id).length > 0;
    return render(ctx, c, {
      active: null,
      title: welcome ? 'Welcome to Keyvane' : 'New project',
      lead: welcome
        ? 'A project holds your products, plans, customers, licenses, API keys and Stripe connection. Most developers start with one project per company and a second one for testing.'
        : 'Projects are fully isolated: separate API keys, Stripe connection, customers and licenses.',
      content: html`<div class="card" style="max-width:640px"><div class="card-body">
        <form method="post" action="/app/projects" class="form">
          <div class="field">
            <label for="name">Project name</label>
            <input id="name" name="name" type="text" required maxlength="80" placeholder="e.g. Acme Software" autofocus>
          </div>
          <label class="checkbox"><input type="checkbox" name="demo" value="1" ${hasProjects ? '' : 'checked'}> Add the example product (AI PDF Analyzer with Free, Pro and Business plans)</label>
          <p class="hint" style="margin-top:-.5rem">Handy for exploring Keyvane and for the <a href="/docs/getting-started">quickstart</a>. You can delete it later.</p>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Create project</button>${hasProjects ? html`<a class="btn btn-ghost" href="/app">Cancel</a>` : ''}</div>
        </form>
      </div></div>`,
    });
  });

  app.post('/app/projects', async (c) => {
    const body = await form(c);
    const user = currentUser(c);
    return formAction(
      ctx,
      c,
      () => {
        if (body.demo === '1') assertWithinPlan(ctx, user, 'products');
        const project = createProject(ctx, user.id, { name: body.name }, actor(c));
        if (body.demo === '1') createDemoCatalog(ctx, project.id, actor(c));
        return `/app/p/${project.id}`;
      },
      { success: 'Project created.', redirect: '/app', errorRedirect: '/app/projects/new' },
    );
  });

  app.get('/app/account', (c) => {
    const user = currentUser(c);
    const billing = accountPlan(ctx, user);
    const quota = (label: string, used: number, limit: number | null) =>
      html`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${formatNumber(used)}</div><div class="stat-meta">${limit === null ? 'Unlimited on your plan' : `of ${formatNumber(limit)} included`}</div></div>`;
    return render(ctx, c, {
      active: null,
      title: 'Account',
      lead: user.email,
      content: html`
      ${billing
        ? html`<section style="margin-bottom:2.5rem">
            <div class="section-title" style="margin-top:0"><h2>Keyvane plan: ${billing.plan?.name ?? 'Developer'}</h2>
              <div class="row">${billing.upgrades.map((u, i) => html`<a class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}" href="${u.url}">Upgrade to ${u.name}</a>`)}
                ${billing.portalUrl ? html`<a class="btn btn-ghost" href="${billing.portalUrl}" rel="noopener">Manage billing</a>` : ''}</div></div>
            <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:640px">
              ${quota('Products', billing.usage.products, billing.limits.products)}
              ${quota('Active licenses', billing.usage.active_licenses, billing.limits.active_licenses)}
            </div>
            ${ctx.config.billing.enforceLimits ? '' : html`<p class="hint" style="margin-top:.6rem">Plan limits are not enforced during the public beta.</p>`}
          </section>`
        : ''}
      <div class="grid-2">
        <div class="card"><div class="card-header"><h2>Profile</h2></div><div class="card-body">
          <form method="post" action="/app/account/profile" class="form">
            <div class="field"><label for="name">Name</label><input id="name" name="name" type="text" value="${user.name ?? ''}" maxlength="100"></div>
            <div class="field"><label>Email</label><input aria-label="Email" type="email" value="${user.email}" disabled></div>
            <div class="form-actions"><button class="btn btn-primary">Save</button></div>
          </form>
        </div></div>
        <div class="card"><div class="card-header"><h2>Password</h2></div><div class="card-body">
          <form method="post" action="/app/account/password" class="form">
            <div class="field"><label for="current_password">Current password</label><input id="current_password" name="current_password" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="new_password">New password</label><input id="new_password" name="new_password" type="password" autocomplete="new-password" minlength="8" required></div>
            <div class="form-actions"><button class="btn btn-primary">Change password</button></div>
          </form>
        </div></div>
      </div>
      <section class="danger-zone" style="margin-top:2.5rem;max-width:640px">
        <h2>Delete account</h2>
        <p class="muted">Deletes your account and every project you own, including products, customers, licenses, usage data and API keys. Apps using those keys stop working immediately. This cannot be undone.</p>
        <form method="post" action="/app/account/delete" class="form" data-confirm="Delete your account and all of your projects? This cannot be undone.">
          <div class="field"><label for="delete_password">Your password</label><input id="delete_password" name="password" type="password" autocomplete="current-password" required></div>
          <div class="form-actions"><button class="btn btn-danger">Delete my account</button></div>
        </form>
      </section>`,
    });
  });

  app.post('/app/account/profile', async (c) => {
    const body = await form(c);
    return formAction(ctx, c, () => updateProfile(ctx, currentUser(c).id, { name: body.name }), { success: 'Profile saved.', redirect: '/app/account' });
  });

  app.post('/app/account/password', async (c) => {
    const body = await form(c);
    return formAction(
      ctx,
      c,
      () => changePassword(ctx, currentUser(c).id, { current: body.current_password, next: body.new_password }),
      { success: 'Password changed.', redirect: '/app/account' },
    );
  });

  app.get('/app/admin', (c) => {
    const user = currentUser(c);
    if (!ctx.config.adminEmails.includes(user.email.toLowerCase())) throw notFound('Page');
    const now = ctx.now();
    const metrics = platformMetrics(ctx, 7);
    const signups = ctx.db.all<{ id: string; email: string; name: string | null; created_at: string; projects: number }>(
      `SELECT users.id, users.email, users.name, users.created_at, (SELECT COUNT(*) FROM projects WHERE owner_id = users.id) AS projects
       FROM users ORDER BY users.created_at DESC LIMIT 25`,
    );
    const since = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
    const active = ctx.db.all<{ id: string; name: string; email: string; calls: number; failed: number }>(
      `SELECT projects.id, projects.name, users.email,
         COALESCE((SELECT SUM(value) FROM daily_stats WHERE project_id = projects.id AND day >= ? AND metric IN ('entitlement_checks', 'license_validations', 'usage_recorded')), 0) AS calls,
         (SELECT COUNT(*) FROM webhook_events WHERE project_id = projects.id AND status = 'failed') AS failed
       FROM projects JOIN users ON users.id = projects.owner_id ORDER BY calls DESC, projects.created_at DESC LIMIT 25`,
      since,
    );
    return render(ctx, c, {
      active: null,
      title: 'Admin',
      lead: 'Platform metrics for the operator of this instance. Only emails in KEYVANE_ADMIN_EMAILS can see this page.',
      content: html`
        <div class="grid-2">
          <div class="table-wrap"><table class="table table-sm"><thead><tr><th scope="col">Metric (business plan §18)</th><th scope="col" class="right">Value</th></tr></thead>
            <tbody>${metrics.map(([label, value]) => html`<tr><td>${label}</td><td class="right">${formatNumber(value)}</td></tr>`)}</tbody></table></div>
          <div class="table-wrap"><table class="table table-sm"><thead><tr><th scope="col">Project</th><th scope="col">Owner</th><th scope="col" class="right">API calls (7d)</th><th scope="col" class="right">Failed events</th></tr></thead>
            <tbody>${active.map((p) => html`<tr><td>${p.name}</td><td class="small">${p.email}</td><td class="right">${formatNumber(p.calls)}</td><td class="right">${p.failed}</td></tr>`)}</tbody></table></div>
        </div>
        <div class="section-title"><h2>Recent sign-ups</h2></div>
        <div class="table-wrap"><table class="table table-sm"><thead><tr><th scope="col">Email</th><th scope="col">Name</th><th scope="col" class="right">Projects</th><th scope="col">Signed up</th></tr></thead>
          <tbody>${signups.map((u) => html`<tr><td>${u.email}</td><td>${u.name ?? ''}</td><td class="right">${u.projects}</td><td class="small">${timeTag(u.created_at, now)}</td></tr>`)}</tbody></table></div>`,
    });
  });

  app.post('/app/account/delete', async (c) => {
    const body = await form(c);
    try {
      await deleteAccount(ctx, currentUser(c).id, body.password);
    } catch (err) {
      if (err instanceof ApiError) {
        await setFlash(ctx, c, 'error', err.message);
        return c.redirect('/app/account', 303);
      }
      throw err;
    }
    endSession(ctx, c);
    return c.redirect('/', 303);
  });

  app.use('/app/p/:projectId', projectMiddleware(ctx));
  app.use('/app/p/:projectId/*', projectMiddleware(ctx));

  app.get('/app/p/:projectId', (c) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const products = listProducts(ctx, project.id);
    const hasEntitlements = !!ctx.db.get(
      'SELECT 1 FROM plan_features JOIN plans ON plans.id = plan_features.plan_id WHERE plans.project_id = ? LIMIT 1',
      project.id,
    );
    const keys = listApiKeys(ctx, project.id).filter((k) => !k.revoked_at);
    const secretKeys = keys.filter((k) => k.type === 'secret');
    const publishable = keys.find((k) => k.type === 'publishable');
    const calls = allTime(ctx, project.id, 'entitlement_checks') + allTime(ctx, project.id, 'license_validations') + allTime(ctx, project.id, 'usage_recorded');
    const steps = [
      { done: products.length > 0, title: 'Create a product', body: 'The software you sell, e.g. “AI PDF Analyzer”.', href: `${b}/products` },
      { done: hasEntitlements, title: 'Define plans and features', body: 'Choose what Free, Pro and Business unlock, including usage limits.', href: products[0] ? `${b}/products/${products[0].id}` : `${b}/products` },
      { done: secretKeys.length > 0, title: 'Create a secret API key', body: 'Your server uses it to check entitlements and record usage.', href: `${b}/api-keys` },
      { done: calls > 0, title: 'Make your first API call', body: 'Install @keyvane/sdk and check a customer’s entitlements.', href: '/docs/getting-started' },
      { done: !!project.stripe_last_event_at, title: 'Connect Stripe', body: 'Add a webhook so purchases, upgrades and cancellations update access.', href: `${b}/stripe` },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const licenses = countLicenses(ctx, project.id);
    const subs = countSubscriptions(ctx, project.id);
    const mrr = Object.entries(mrrByCurrency(ctx, project.id));
    const hooks = webhookCounts(ctx, project.id);
    const checks = series(ctx, project.id, 'entitlement_checks', 14);
    const validations = series(ctx, project.id, 'license_validations', 14);
    const recent = listAudit(ctx, project.id, { limit: 8 }).data;

    const stat = (label: string, value: string, meta: string) =>
      html`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-meta">${meta}</div></div>`;

    return render(ctx, c, {
      active: 'overview',
      title: project.name,
      lead: 'Licenses, access and usage for your products at a glance.',
      actions: html`<a class="btn btn-secondary" href="${b}/licenses">${icon('key')}New license</a><a class="btn btn-primary" href="${b}/products">${icon('plus')}New product</a>`,
      content: html`
        ${doneCount < steps.length
          ? html`<div class="card" style="margin-bottom:1.5rem">
              <div class="card-header"><h2>Get started</h2><span class="progress-label">${doneCount} of ${steps.length} done</span></div>
              <ul class="checklist">
                ${steps.map(
                  (s) => html`<li class="${s.done ? 'done' : ''}"><span class="check-dot">${s.done ? icon('check', 'icon icon-sm') : ''}</span>
                    <div style="flex:1"><div class="check-title">${s.title}</div><div class="check-body">${s.body}</div></div>
                    ${s.done ? '' : html`<a class="btn btn-secondary btn-sm" href="${s.href}">Open</a>`}</li>`,
                )}
              </ul>
            </div>`
          : ''}
        <div class="stats">
          ${stat('Customers', formatNumber(countCustomers(ctx, project.id)), 'known to Keyvane')}
          ${stat('Active licenses', formatNumber(licenses.active), `${formatNumber(licenses.total)} issued in total`)}
          ${stat('Subscriptions', formatNumber(subs.active + subs.trialing), subs.pastDue ? `${subs.pastDue} past due` : `${subs.trialing} trialing`)}
          ${stat('Estimated MRR', mrr.length ? mrr.map(([cur, amount]) => formatMoney(amount, cur)).join(' + ') : '$0', 'from active Stripe subscriptions')}
        </div>
        <div class="grid-2" style="margin-top:1.5rem">
          <div class="card">
            <div class="card-header"><h2>API activity · last 14 days</h2>
              <div class="legend"><span><i style="background:var(--accent)"></i>Entitlement checks</span><span><i style="background:var(--text);opacity:.5"></i>License validations</span></div>
            </div>
            <div class="card-body">${barChart(checks, validations)}
              <div class="row small muted" style="margin-top:.5rem;gap:1.5rem">
                <span>${formatNumber(total(ctx, project.id, 'entitlement_checks', 7))} checks (7d)</span>
                <span>${formatNumber(total(ctx, project.id, 'license_validations', 7))} validations (7d)</span>
                <span>${formatNumber(total(ctx, project.id, 'usage_recorded', 7))} units metered (7d)</span>
                <span>${formatNumber(total(ctx, project.id, 'usage_denied', 7))} limit hits (7d)</span>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h2>Integration</h2><a class="btn btn-ghost btn-sm" href="/docs/getting-started">Quickstart ${icon('external', 'icon icon-sm')}</a></div>
            <div class="card-body stack">
              <div class="field"><span class="label">API base URL</span>${copyField(ctx.config.publicUrl)}</div>
              ${publishable ? html`<div class="field"><span class="label">Publishable key <span class="optional">(safe for apps)</span></span>${copyField(publishable.token_plain ?? '')}</div>` : ''}
              <div class="field"><span class="label">Stripe webhook endpoint</span>${copyField(webhookUrl(ctx, project.id))}
                <span class="hint">${hooks.processed + hooks.ignored} events received${hooks.failed ? html` · <a href="${b}/stripe?status=failed">${hooks.failed} failed</a>` : ''}</span></div>
            </div>
          </div>
        </div>
        <div class="section-title"><h2>Recent activity</h2><a class="btn btn-ghost btn-sm" href="${b}/activity">View all</a></div>
        <div class="card">${recent.length
          ? timeline(recent, now, (row) => auditHref(b, row))
          : html`<div class="card-body muted">Nothing yet. Activity from the dashboard, the API and Stripe will show up here.</div>`}</div>`,
    });
  });
}
