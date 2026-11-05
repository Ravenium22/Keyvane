import type { Hono } from 'hono';
import { html } from '../../lib/html.ts';
import { listProducts, loadCatalog, planPriceIds } from '../../services/catalog.ts';
import { setStripeWebhookSecret, webhookUrl } from '../../services/projects.ts';
import {
  getWebhookEvent,
  listWebhookEvents,
  RECOMMENDED_EVENT_TYPES,
  reprocessWebhookEvent,
  webhookCounts,
} from '../../services/stripe/webhooks.ts';
import { parseJson } from '../../db/sqlite.ts';
import type { Ctx } from '../../types.ts';
import type { WebEnv } from '../session.ts';
import { badge, copyButton, copyField, emptyState, icon, pagination, relativeTime, timeTag, webhookBadge } from '../ui.ts';
import { actor, base, crumbs, form, formAction, render } from './common.ts';

export function mountStripe(app: Hono<WebEnv>, ctx: Ctx): void {
  const P = '/app/p/:projectId/stripe';

  app.get(P, (c) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const status = c.req.query('status') || undefined;
    const events = listWebhookEvents(ctx, project.id, { status, limit: 25, startingAfter: c.req.query('after') });
    const counts = webhookCounts(ctx, project.id);
    const connected = !!project.stripe_webhook_secret;
    const plans = listProducts(ctx, project.id).flatMap((p) => {
      const cat = loadCatalog(ctx, p);
      return cat.plans.map((plan) => ({ product: p, plan, prices: planPriceIds(plan), isDefault: p.default_plan_id === plan.id }));
    });
    const unmappedPaid = plans.filter((p) => p.prices.length === 0 && !p.isDefault);
    const last = events.data.at(-1);
    const url = webhookUrl(ctx, project.id);

    return render(ctx, c, {
      active: 'stripe',
      title: 'Stripe',
      lead: 'Keyvane listens to your Stripe webhooks and turns subscription changes into access. It never needs your Stripe API keys.',
      actions: connected
        ? project.stripe_last_event_at
          ? badge(`Connected · last event ${relativeTime(project.stripe_last_event_at, now)}`, 'green')
          : badge('Waiting for the first event', 'yellow')
        : badge('Not connected', 'gray'),
      content: html`
        <div class="grid-2">
          <div class="card"><div class="card-header"><h2>1 · Create a webhook endpoint in Stripe</h2></div><div class="card-body stack">
            <p class="muted small" style="margin:0">In the Stripe Dashboard open <strong>Developers → Webhooks → Add endpoint</strong> (use test mode first) and paste this URL:</p>
            ${copyField(url)}
            <div><div class="label" style="margin-bottom:.35rem">Events to send</div>
              <div class="row" style="gap:.35rem">${RECOMMENDED_EVENT_TYPES.map((t) => html`<span class="pill">${t}</span>`)}</div>
              <div style="margin-top:.6rem">${copyButton(RECOMMENDED_EVENT_TYPES.join('\n'), 'Copy event list')}</div></div>
          </div></div>
          <div class="card"><div class="card-header"><h2>2 · Paste the signing secret</h2></div><div class="card-body">
            <form method="post" action="${b}/stripe" class="form">
              <div class="field"><label for="webhook_secret">Signing secret</label>
                <input id="webhook_secret" name="webhook_secret" type="password" class="mono" placeholder="${connected ? '•••••••• (saved; paste a new one to replace it)' : 'whsec_…'}" autocomplete="off" required>
                <span class="hint">Shown on the endpoint page in Stripe (“Reveal signing secret”). Stored encrypted.</span></div>
              <div class="form-actions"><button class="btn btn-primary">${connected ? 'Replace secret' : 'Connect Stripe'}</button></div>
            </form>
            ${connected
              ? html`<form method="post" action="${b}/stripe/disconnect" data-confirm="Disconnect Stripe? Webhooks will be rejected until you add a secret again." style="margin-top:.75rem"><button class="btn btn-ghost btn-sm">Disconnect</button></form>`
              : ''}
          </div></div>
        </div>

        <div class="grid-2" style="margin-top:1rem">
          <div class="card"><div class="card-header"><h2>3 · Map Stripe prices to plans</h2><a class="btn btn-ghost btn-sm" href="${b}/products">Edit plans</a></div>
            <div class="card-body stack-sm">
              ${plans.length === 0
                ? html`<p class="muted small" style="margin:0">Create a product and plans first.</p>`
                : html`<table class="table table-sm"><tbody>${plans.map(
                    (p) => html`<tr><td><strong>${p.plan.name}</strong> <span class="subtle small">${p.product.name}</span></td>
                      <td>${p.prices.length ? p.prices.map((id) => html`<div class="mono small">${id}</div>`) : p.isDefault ? html`<span class="subtle small">Default plan, no price needed</span>` : badge('no price mapped', 'yellow')}</td></tr>`,
                  )}</tbody></table>`}
              ${unmappedPaid.length ? html`<p class="hint" style="margin:0">Subscriptions to unmapped prices are recorded but grant no access until you map them and reprocess the event.</p>` : ''}
            </div></div>
          <div class="card"><div class="card-header"><h2>4 · Tell Keyvane who is paying</h2></div><div class="card-body stack-sm">
            <p class="muted small" style="margin:0">Pass your own user ID so the purchase is linked to the right customer:</p>
            <pre class="code" tabindex="0"><code><span class="tok-c"># Payment Links: append it to the link</span>
https://buy.stripe.com/…?client_reference_id=user_42

<span class="tok-c">// Checkout Sessions (server-side)</span>
stripe.checkout.sessions.create({
  <span class="tok-p">mode</span>: <span class="tok-s">'subscription'</span>,
  <span class="tok-p">client_reference_id</span>: user.id,
  <span class="tok-p">subscription_data</span>: { <span class="tok-p">metadata</span>: { <span class="tok-p">keyvane_customer_id</span>: user.id } },
  …
});</code></pre>
            <p class="hint" style="margin:0">Test locally with the Stripe CLI: <code>stripe listen --forward-to ${url}</code></p>
          </div></div>
        </div>

        <div class="section-title"><h2>Events</h2>
          <div class="row" style="gap:.35rem">
            ${[
              ['', `All (${counts.processed + counts.ignored + counts.failed + counts.pending})`],
              ['processed', `Processed (${counts.processed})`],
              ['ignored', `Ignored (${counts.ignored})`],
              ['failed', `Failed (${counts.failed})`],
            ].map(([v, l]) => html`<a class="btn btn-sm ${(status ?? '') === v ? 'btn-secondary' : 'btn-ghost'}" href="${b}/stripe${v ? `?status=${v}` : ''}">${l}</a>`)}
          </div>
        </div>
        <div class="card card-flush">
          ${events.data.length === 0
            ? emptyState({ icon: 'card', title: 'No events yet', text: 'Once Stripe sends a webhook, every event and what Keyvane did with it appears here.' })
            : html`<div class="table-wrap"><table class="table">
                <thead><tr><th>Event</th><th>Status</th><th>Result</th><th>Received</th></tr></thead>
                <tbody>${events.data.map(
                  (e) => html`<tr>
                    <td><a class="row-link" href="${b}/stripe/events/${e.id}">${e.type}</a><div class="mono subtle small">${e.provider_event_id}${e.livemode ? '' : ' · test'}</div></td>
                    <td>${webhookBadge(e.status)}</td>
                    <td class="small muted" style="max-width:380px">${e.message ?? '—'}</td>
                    <td class="small nowrap">${timeTag(e.received_at, now)}</td>
                  </tr>`,
                )}</tbody></table></div>`}
        </div>
        ${pagination(events.hasMore, last ? `${b}/stripe?after=${last.id}${status ? `&status=${status}` : ''}` : null)}`,
    });
  });

  app.post(P, async (c) => {
    const body = await form(c);
    const b = base(c);
    return formAction(ctx, c, () => setStripeWebhookSecret(ctx, c.get('project').id, body.webhook_secret ?? '', actor(c)), {
      success: 'Stripe signing secret saved. Send a test event from Stripe to verify the connection.',
      redirect: `${b}/stripe`,
    });
  });

  app.post(`${P}/disconnect`, async (c) => {
    const b = base(c);
    return formAction(ctx, c, () => setStripeWebhookSecret(ctx, c.get('project').id, null, actor(c)), {
      success: 'Stripe disconnected.',
      redirect: `${b}/stripe`,
    });
  });

  app.get(`${P}/events/:eventId`, (c) => {
    const project = c.get('project');
    const b = base(c);
    const now = ctx.now();
    const event = getWebhookEvent(ctx, project.id, c.req.param('eventId'));
    const payload = parseJson<unknown>(event.payload, event.payload);
    return render(ctx, c, {
      active: 'stripe',
      eyebrow: crumbs(['Stripe', `${b}/stripe`], 'Event'),
      title: event.type,
      lead: html`${webhookBadge(event.status)} <span class="mono small" style="margin-left:.4rem">${event.provider_event_id}</span>`,
      actions:
        event.status !== 'processed'
          ? html`<form method="post" action="${b}/stripe/events/${event.id}/reprocess" class="inline-form"><button class="btn btn-primary">${icon('refresh', 'icon icon-sm')}Reprocess</button></form>`
          : '',
      content: html`<div class="grid" style="grid-template-columns:320px minmax(0,1fr);align-items:start">
        <div class="card"><div class="card-body"><dl class="kv">
          <dt>Status</dt><dd>${webhookBadge(event.status)}</dd>
          <dt>Result</dt><dd>${event.message ?? '—'}</dd>
          <dt>Attempts</dt><dd>${event.attempts}</dd>
          <dt>Mode</dt><dd>${event.livemode ? 'Live' : 'Test'}</dd>
          <dt>Created in Stripe</dt><dd>${timeTag(event.event_created_at, now, 'datetime')}</dd>
          <dt>Received</dt><dd>${timeTag(event.received_at, now, 'datetime')}</dd>
          <dt>Processed</dt><dd>${timeTag(event.processed_at, now, 'datetime')}</dd>
        </dl></div></div>
        <div class="card"><div class="card-header"><h2>Payload</h2>${copyButton(JSON.stringify(payload, null, 2), 'Copy JSON')}</div>
          <div class="card-body"><pre class="code json" tabindex="0"><code>${JSON.stringify(payload, null, 2)}</code></pre></div></div>
      </div>`,
    });
  });

  app.post(`${P}/events/:eventId/reprocess`, async (c) => {
    const b = base(c);
    const eventUrl = `${b}/stripe/events/${c.req.param('eventId')}`;
    let message = 'Event reprocessed.';
    return formAction(
      ctx,
      c,
      () => {
        const result = reprocessWebhookEvent(ctx, c.get('project').id, c.req.param('eventId'), actor(c));
        message = `Event ${result.status}${result.message ? `: ${result.message}` : '.'}`;
      },
      {
        get success() {
          return message;
        },
        redirect: eventUrl,
      },
    );
  });
}
