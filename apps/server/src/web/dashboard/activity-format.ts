import { html, type SafeHtml } from '../../lib/html.ts';
import { auditData } from '../../services/audit.ts';
import type { AuditLogRow } from '../../types.ts';
import { formatMoney, timeTag } from '../ui.ts';

const LABELS: Record<string, string> = {
  'project.created': 'Project created',
  'project.updated': 'Project renamed',
  'product.created': 'Product created',
  'product.updated': 'Product settings updated',
  'product.deleted': 'Product deleted',
  'plan.created': 'Plan created',
  'plan.updated': 'Plan updated',
  'plan.deleted': 'Plan deleted',
  'feature.created': 'Feature created',
  'feature.updated': 'Feature updated',
  'feature.deleted': 'Feature deleted',
  'entitlements.updated': 'Plan entitlements updated',
  'customer.created': 'Customer created',
  'customer.updated': 'Customer updated',
  'customer.merged': 'Duplicate customer merged',
  'customer.deleted': 'Customer deleted',
  'license.created': 'License created',
  'license.updated': 'License updated',
  'license.plan_changed': 'License plan changed',
  'license.suspended': 'License suspended',
  'license.reinstated': 'License reinstated',
  'license.revoked': 'License revoked',
  'license.activated': 'Device activated',
  'license.deactivated': 'Device deactivated',
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',
  'stripe.connected': 'Stripe connected',
  'stripe.disconnected': 'Stripe disconnected',
  'webhook.reprocessed': 'Webhook event reprocessed',
  'usage.reset': 'Usage reset',
  'webhook.alert_sent': 'Failure alert emailed',
  'checkout.completed': 'Stripe checkout completed',
  'invoice.paid': 'Invoice paid',
  'invoice.payment_failed': 'Invoice payment failed',
  'subscription.created': 'Subscription created',
  'subscription.updated': 'Subscription updated',
  'subscription.deleted': 'Subscription ended',
  'subscription.paused': 'Subscription paused',
  'subscription.resumed': 'Subscription resumed',
  'subscription.trial_will_end': 'Trial ending soon',
  'subscription.pending_update_applied': 'Subscription change applied',
  'subscription.pending_update_expired': 'Subscription change expired',
};

const SHOWN_KEYS = ['type', 'licenses_deleted', 'name', 'key', 'plan', 'from', 'to', 'status', 'plans', 'reason', 'feature', 'period', 'fingerprint', 'external_id', 'email', 'key_type', 'subscription', 'expires_at', 'client_reference_id'];

export function auditLabel(row: AuditLogRow): string {
  return LABELS[row.action] ?? row.action;
}

export function auditDetails(row: AuditLogRow): SafeHtml {
  const data = auditData(row);
  const parts: SafeHtml[] = [];
  if ((row.action === 'invoice.paid' || row.action === 'invoice.payment_failed') && typeof data.amount === 'number' && typeof data.currency === 'string') {
    parts.push(html`<span class="pill">${formatMoney(data.amount, data.currency)}</span>`);
  }
  for (const key of SHOWN_KEYS) {
    const value = data[key];
    if (value === undefined || value === null || value === '') continue;
    const text = Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (!text) continue;
    parts.push(html`<span class="pill">${key.replace(/_/g, ' ')}: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}</span>`);
  }
  return html`${parts}`;
}

export function actorLabel(row: AuditLogRow): string {
  if (row.actor_type === 'stripe') return 'Stripe';
  if (row.actor_type === 'system') return 'Keyvane';
  if (row.actor_type === 'api_key') return row.actor_label ? `API · ${row.actor_label}` : 'API';
  return row.actor_label ?? 'User';
}

export function timeline(rows: AuditLogRow[], now: Date, hrefFor?: (row: AuditLogRow) => string | null): SafeHtml {
  return html`<ul class="timeline">
    ${rows.map((row) => {
      const href = hrefFor?.(row) ?? null;
      return html`<li>
        <span class="dot ${row.actor_type}"></span>
        <div>
          <div>${href ? html`<a href="${href}"><strong>${auditLabel(row)}</strong></a>` : html`<strong>${auditLabel(row)}</strong>`} <span class="subtle small">by ${actorLabel(row)}</span></div>
          <div class="row" style="gap:.35rem;margin-top:.2rem">${auditDetails(row)}</div>
        </div>
        <span class="subtle small nowrap">${timeTag(row.created_at, now)}</span>
      </li>`;
    })}
  </ul>`;
}

export function auditHref(base: string, row: AuditLogRow): string | null {
  if (!row.target_id) return null;
  switch (row.target_type) {
    case 'license':
      return `${base}/licenses/${row.target_id}`;
    case 'customer':
      return `${base}/customers/${row.target_id}`;
    case 'product':
      return `${base}/products/${row.target_id}`;
    case 'webhook_event':
      return `${base}/stripe/events/${row.target_id}`;
    default:
      return null;
  }
}
