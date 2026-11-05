import type { Hono } from 'hono';
import { html } from '../../lib/html.ts';
import { listAudit } from '../../services/audit.ts';
import type { Ctx } from '../../types.ts';
import type { WebEnv } from '../session.ts';
import { emptyState, pagination } from '../ui.ts';
import { base, render } from './common.ts';
import { auditHref, timeline } from './activity-format.ts';

const FILTERS: [string, string][] = [
  ['', 'All'],
  ['license.', 'Licenses'],
  ['subscription.', 'Subscriptions'],
  ['customer.', 'Customers'],
  ['invoice.', 'Invoices'],
  ['api_key.', 'API keys'],
];

export function mountActivity(app: Hono<WebEnv>, ctx: Ctx): void {
  app.get('/app/p/:projectId/activity', (c) => {
    const project = c.get('project');
    const b = base(c);
    const filter = FILTERS.some(([v]) => v === c.req.query('type')) ? (c.req.query('type') ?? '') : '';
    const result = listAudit(ctx, project.id, { limit: 50, startingAfter: c.req.query('after'), actionPrefix: filter || undefined });
    const last = result.data.at(-1);
    return render(ctx, c, {
      active: 'activity',
      title: 'Activity',
      lead: 'An audit log of every change to licenses, plans, customers and access, whether it came from you, an API key or Stripe.',
      content: html`
        <div class="row" style="margin-bottom:1rem;gap:.35rem">${FILTERS.map(
          ([v, l]) => html`<a class="btn btn-sm ${filter === v ? 'btn-secondary' : 'btn-ghost'}" href="${b}/activity${v ? `?type=${encodeURIComponent(v)}` : ''}">${l}</a>`,
        )}</div>
        <div class="card">${result.data.length
          ? timeline(result.data, ctx.now(), (row) => auditHref(b, row))
          : emptyState({ icon: 'activity', title: 'No activity yet', text: 'Changes made in the dashboard, through the API or by Stripe events will appear here.' })}</div>
        ${pagination(result.hasMore, last ? `${b}/activity?after=${last.id}${filter ? `&type=${encodeURIComponent(filter)}` : ''}` : null)}`,
    });
  });
}
