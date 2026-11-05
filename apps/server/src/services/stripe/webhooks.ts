import { conflict, notFound } from '../../lib/errors.ts';
import { newId } from '../../lib/ids.ts';
import { fromUnix } from '../../lib/time.ts';
import type {
  Actor,
  Ctx,
  CustomerRow,
  LicenseRow,
  PlanRow,
  ProjectRow,
  SubscriptionRow,
  WebhookEventRow,
  WebhookStatus,
} from '../../types.ts';
import { audit } from '../audit.ts';
import { findPlanByStripePrice } from '../catalog.ts';
import { getCustomerById, linkStripeCustomer } from '../customers.ts';
import { insertLicense } from '../licenses.ts';
import { getProject, getStripeWebhookSecret } from '../projects.ts';
import { bump } from '../stats.ts';
import { sendMail } from '../mailer.ts';
import { verifyStripeSignature } from './signature.ts';

/**
 * Stripe → Keyvane synchronization.
 *
 * Reliability rules (see docs/stripe.md):
 *  1. Every event is verified (HMAC signature + timestamp tolerance) before anything else.
 *  2. Every event is stored. Duplicate deliveries are acknowledged without re-applying them.
 *  3. Events are applied in a transaction: either all of their effects land, or none do.
 *  4. Stripe does not guarantee ordering, so a subscription snapshot older than the one
 *     already applied is ignored, and an ended subscription is never resurrected.
 *  5. Failures return HTTP 500 so Stripe retries; they can also be reprocessed from the dashboard.
 */

// --- Minimal shapes of the Stripe objects we read (tolerant of API version differences) ---

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  livemode?: boolean;
  api_version?: string | null;
  data: { object: Record<string, unknown> };
}

interface StripePrice {
  id?: string;
  unit_amount?: number | null;
  currency?: string;
  recurring?: { interval?: string; interval_count?: number } | null;
}

interface StripeSubscriptionItem {
  price?: StripePrice;
  quantity?: number;
  // Since API version 2025-03-31 the billing period lives on subscription items.
  current_period_start?: number;
  current_period_end?: number;
}

interface StripeSubscription {
  id: string;
  object: string;
  customer?: unknown;
  status: string;
  items?: { data?: StripeSubscriptionItem[] };
  metadata?: Record<string, string> | null;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  ended_at?: number | null;
  trial_end?: number | null;
}

interface StripeCheckoutSession {
  id: string;
  mode?: string;
  customer?: unknown;
  client_reference_id?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
  metadata?: Record<string, string> | null;
  subscription?: unknown;
}

interface StripeCustomer {
  id: string;
  email?: string | null;
  name?: string | null;
  metadata?: Record<string, string> | null;
  deleted?: boolean;
}

interface StripeInvoice {
  id: string;
  customer?: unknown;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  subscription?: unknown;
  parent?: { subscription_details?: { subscription?: unknown } | null } | null;
}

type Outcome = { status: 'processed' | 'ignored'; message?: string | null };

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.trial_will_end',
]);

/** The event types to select when creating the webhook endpoint in Stripe. */
export const RECOMMENDED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.updated',
  'invoice.paid',
  'invoice.payment_failed',
];

/** Lifecycle order used to break ties between events created in the same second. */
const STATUS_ORDER: Record<string, number> = {
  incomplete: 0,
  trialing: 1,
  active: 1,
  past_due: 1,
  unpaid: 1,
  paused: 1,
  canceled: 2,
  incomplete_expired: 2,
};
const TERMINAL = new Set(['canceled', 'incomplete_expired']);

export const REMOVED_FROM_SUBSCRIPTION = 'Removed from Stripe subscription';

function idOf(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

function isEvent(value: unknown): value is StripeEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<StripeEvent>;
  return (
    typeof e.id === 'string' &&
    typeof e.type === 'string' &&
    typeof e.created === 'number' &&
    !!e.data &&
    typeof e.data === 'object' &&
    !!e.data.object &&
    typeof e.data.object === 'object'
  );
}

const errorBody = (type: string, code: string, message: string) => ({ error: { type, code, message } });

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export function receiveStripeWebhook(
  ctx: Ctx,
  projectId: string,
  payload: string,
  signature: string | null | undefined,
): WebhookResponse {
  const project = getProject(ctx, projectId);
  if (!project) return { status: 404, body: errorBody('not_found_error', 'project_not_found', 'Unknown project.') };
  const secret = getStripeWebhookSecret(ctx, project);
  if (!secret) {
    return {
      status: 400,
      body: errorBody(
        'invalid_request_error',
        'stripe_not_connected',
        'Stripe is not connected for this project. Add the webhook signing secret in the Keyvane dashboard.',
      ),
    };
  }
  const verified = verifyStripeSignature(payload, signature, secret, { now: ctx.now() });
  if (!verified.ok) return { status: 400, body: errorBody('authentication_error', 'invalid_signature', verified.reason) };

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return { status: 400, body: errorBody('invalid_request_error', 'invalid_json', 'Payload is not valid JSON.') };
  }
  if (!isEvent(event)) {
    return { status: 400, body: errorBody('invalid_request_error', 'invalid_event', 'Payload is not a Stripe event.') };
  }

  const existing = ctx.db.get<WebhookEventRow>(
    'SELECT * FROM webhook_events WHERE project_id = ? AND provider = ? AND provider_event_id = ?',
    project.id,
    'stripe',
    event.id,
  );
  if (existing && (existing.status === 'processed' || existing.status === 'ignored')) {
    return { status: 200, body: { received: true, duplicate: true, status: existing.status } };
  }
  let record = existing;
  if (!record) {
    record = {
      id: newId('whe'),
      project_id: project.id,
      provider: 'stripe',
      provider_event_id: event.id,
      type: event.type,
      livemode: event.livemode ? 1 : 0,
      status: 'pending',
      message: null,
      attempts: 0,
      payload,
      event_created_at: fromUnix(event.created),
      received_at: ctx.now().toISOString(),
      processed_at: null,
    };
    ctx.db.insert('webhook_events', { ...record });
  }
  const result = processWebhookRecord(ctx, project, record);
  if (result.status === 'failed') {
    return { status: 500, body: errorBody('api_error', 'processing_failed', result.message ?? 'Processing failed.') };
  }
  return { status: 200, body: { received: true, status: result.status, ...(result.message ? { message: result.message } : {}) } };
}

export function processWebhookRecord(
  ctx: Ctx,
  project: ProjectRow,
  record: WebhookEventRow,
): { status: WebhookStatus; message: string | null } {
  const event = JSON.parse(record.payload) as StripeEvent;
  const now = ctx.now().toISOString();
  try {
    const outcome = ctx.db.transaction(() => processStripeEvent(ctx, project, event));
    ctx.db.run(
      'UPDATE webhook_events SET status = ?, message = ?, attempts = attempts + 1, processed_at = ? WHERE id = ?',
      outcome.status,
      outcome.message ?? null,
      now,
      record.id,
    );
    ctx.db.run('UPDATE projects SET stripe_last_event_at = ? WHERE id = ?', now, project.id);
    bump(ctx, project.id, 'webhooks_processed');
    return { status: outcome.status, message: outcome.message ?? null };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    ctx.db.run(
      "UPDATE webhook_events SET status = 'failed', message = ?, attempts = attempts + 1 WHERE id = ?",
      message,
      record.id,
    );
    bump(ctx, project.id, 'webhooks_failed');
    if (ctx.config.env !== 'test') console.error(`[stripe] failed to process ${event.type} ${event.id}:`, err);
    notifyFailure(ctx, project, record, event, message);
    return { status: 'failed', message };
  }
}

const ALERT_INTERVAL_MS = 60 * 60_000;

/**
 * Email the project owner when an event fails, at most once an hour per project, so a
 * broken mapping or bug is noticed before customers notice it.
 */
function notifyFailure(ctx: Ctx, project: ProjectRow, record: WebhookEventRow, event: StripeEvent, message: string): void {
  try {
    const since = new Date(ctx.now().getTime() - ALERT_INTERVAL_MS).toISOString();
    const recent = ctx.db.get(
      "SELECT 1 FROM audit_logs WHERE project_id = ? AND action = 'webhook.alert_sent' AND created_at > ? LIMIT 1",
      project.id,
      since,
    );
    if (recent) return;
    const owner = ctx.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', project.owner_id);
    if (!owner) return;
    audit(ctx, project.id, { type: 'system' }, 'webhook.alert_sent', { type: 'webhook_event', id: record.id }, { type: event.type, to: owner.email });
    const url = `${ctx.config.publicUrl}/app/p/${project.id}/stripe/events/${record.id}`;
    void sendMail(ctx, {
      to: owner.email,
      subject: `[Keyvane] A Stripe event failed in ${project.name}`,
      text: `Keyvane could not process a Stripe event for the project "${project.name}".\n\nEvent: ${event.type} (${event.id})\nError: ${message}\n\nStripe will retry automatically for up to three days. Until it succeeds, the affected customer's access may be out of date.\n\nReview the event and reprocess it here:\n${url}\n\nYou receive at most one of these emails per hour per project.\n`,
    });
  } catch (err) {
    if (ctx.config.env !== 'test') console.error('[stripe] could not send failure alert:', err);
  }
}

export function processStripeEvent(ctx: Ctx, project: ProjectRow, event: StripeEvent): Outcome {
  const object = event.data.object;
  if (SUBSCRIPTION_EVENTS.has(event.type)) return handleSubscription(ctx, project, event, object as unknown as StripeSubscription);
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handleCheckoutSession(ctx, project, event, object as unknown as StripeCheckoutSession);
    case 'customer.created':
    case 'customer.updated':
      return handleCustomer(ctx, project, object as unknown as StripeCustomer);
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return handleInvoice(ctx, project, event, object as unknown as StripeInvoice);
    default:
      return { status: 'ignored', message: `Keyvane does not use ${event.type} events.` };
  }
}

function stripeActor(event: StripeEvent): Actor {
  return { type: 'stripe', id: event.id, label: event.type };
}

function findSubscription(ctx: Ctx, projectId: string, providerId: string): SubscriptionRow | undefined {
  return ctx.db.get<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE project_id = ? AND provider = ? AND provider_subscription_id = ?',
    projectId,
    'stripe',
    providerId,
  );
}

function handleSubscription(ctx: Ctx, project: ProjectRow, event: StripeEvent, sub: StripeSubscription): Outcome {
  if (!sub || sub.object !== 'subscription' || typeof sub.id !== 'string' || typeof sub.status !== 'string') {
    throw new Error('Event does not contain a subscription object.');
  }
  const now = ctx.now().toISOString();
  const eventAt = fromUnix(event.created) ?? now;
  const existing = findSubscription(ctx, project.id, sub.id);

  // --- Ordering guards -----------------------------------------------------
  if (existing?.last_event_at) {
    if (eventAt < existing.last_event_at) {
      return { status: 'ignored', message: `Out-of-order event: a newer snapshot (${existing.last_event_at}) was already applied.` };
    }
    if (eventAt === existing.last_event_at && (STATUS_ORDER[sub.status] ?? 1) < (STATUS_ORDER[existing.status] ?? 1)) {
      return { status: 'ignored', message: `Same-second event with an earlier lifecycle status ("${sub.status}") was ignored.` };
    }
  }
  if (existing && TERMINAL.has(existing.status) && !TERMINAL.has(sub.status)) {
    return { status: 'ignored', message: `Subscription already ${existing.status}; ignoring an older "${sub.status}" snapshot.` };
  }

  // --- Customer --------------------------------------------------------------
  // Keep the link established when the subscription was first seen, unless the
  // subscription explicitly names a Keyvane customer in its metadata.
  const stripeCustomerId = idOf(sub.customer);
  const externalId = sub.metadata?.keyvane_customer_id || null;
  let customer: CustomerRow | null = null;
  if (externalId) customer = linkStripeCustomer(ctx, project.id, { stripeCustomerId, externalId });
  if (!customer && existing?.customer_id) customer = getCustomerById(ctx, project.id, existing.customer_id);
  if (!customer) customer = linkStripeCustomer(ctx, project.id, { stripeCustomerId });

  // --- Subscription snapshot ----------------------------------------------
  const items = sub.items?.data ?? [];
  const priceIds = [...new Set(items.map((i) => i.price?.id).filter((id): id is string => typeof id === 'string'))];
  const starts = items.map((i) => i.current_period_start).filter((n): n is number => typeof n === 'number');
  const ends = items.map((i) => i.current_period_end).filter((n): n is number => typeof n === 'number');
  const amount =
    items.length > 0 && items.every((i) => typeof i.price?.unit_amount === 'number')
      ? items.reduce((sum, i) => sum + (i.price?.unit_amount ?? 0) * (i.quantity ?? 1), 0)
      : null;
  const firstPrice = items[0]?.price;
  let pastDueSince: string | null = null;
  if (sub.status === 'past_due' || sub.status === 'unpaid') pastDueSince = existing?.past_due_since ?? eventAt;
  else if (sub.status === 'canceled') pastDueSince = existing?.past_due_since ?? null;

  const fields = {
    customer_id: customer?.id ?? existing?.customer_id ?? null,
    provider_customer_id: stripeCustomerId,
    status: sub.status,
    price_ids: JSON.stringify(priceIds),
    amount,
    currency: firstPrice?.currency ?? null,
    billing_interval: firstPrice?.recurring?.interval ?? null,
    interval_count: firstPrice?.recurring?.interval_count ?? null,
    current_period_start: fromUnix(sub.current_period_start ?? (starts.length ? Math.min(...starts) : undefined)),
    current_period_end: fromUnix(sub.current_period_end ?? (ends.length ? Math.max(...ends) : undefined)),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    cancel_at: fromUnix(sub.cancel_at),
    canceled_at: fromUnix(sub.canceled_at),
    ended_at: fromUnix(sub.ended_at),
    trial_end: fromUnix(sub.trial_end),
    past_due_since: pastDueSince,
    livemode: event.livemode === true,
    last_event_at: eventAt,
    updated_at: now,
  };
  if (existing) {
    ctx.db.update('subscriptions', { id: existing.id }, fields);
  } else {
    ctx.db.insert('subscriptions', {
      id: newId('lsub'),
      project_id: project.id,
      provider: 'stripe',
      provider_subscription_id: sub.id,
      created_at: now,
      ...fields,
    });
  }
  const subscription = findSubscription(ctx, project.id, sub.id) as SubscriptionRow;

  // --- Prices → plans → licenses ---------------------------------------------
  const matched: PlanRow[] = [];
  const unmapped: string[] = [];
  for (const priceId of priceIds) {
    const plan = findPlanByStripePrice(ctx, project.id, priceId);
    if (plan) matched.push(plan);
    else unmapped.push(priceId);
  }
  const byProduct = new Map<string, PlanRow>();
  for (const plan of matched) {
    const current = byProduct.get(plan.product_id);
    if (!current || plan.rank > current.rank) byProduct.set(plan.product_id, plan);
  }

  const actor = stripeActor(event);
  const licenses = ctx.db.all<LicenseRow>('SELECT * FROM licenses WHERE subscription_id = ?', subscription.id);
  for (const [productId, plan] of byProduct) {
    const license = licenses.find((l) => l.product_id === productId);
    if (!license) {
      const created = insertLicense(ctx, {
        project_id: project.id,
        product_id: productId,
        plan_id: plan.id,
        customer_id: subscription.customer_id,
        subscription_id: subscription.id,
        source: 'stripe',
        expires_at: null,
        max_activations: plan.max_activations,
      });
      audit(ctx, project.id, actor, 'license.created', { type: 'license', id: created.id }, {
        plan: plan.key,
        subscription: sub.id,
        source: 'stripe',
      });
      continue;
    }
    const patch: Partial<LicenseRow> = {};
    if (license.plan_id !== plan.id) patch.plan_id = plan.id;
    if (subscription.customer_id && license.customer_id !== subscription.customer_id) patch.customer_id = subscription.customer_id;
    if (license.status === 'suspended' && license.status_reason === REMOVED_FROM_SUBSCRIPTION) {
      patch.status = 'active';
      patch.status_reason = null;
      patch.status_changed_at = now;
    }
    if (Object.keys(patch).length > 0) {
      ctx.db.update('licenses', { id: license.id }, { ...patch, updated_at: now });
      if (patch.plan_id) {
        const from = ctx.db.get<{ key: string }>('SELECT key FROM plans WHERE id = ?', license.plan_id)?.key ?? null;
        audit(ctx, project.id, actor, 'license.plan_changed', { type: 'license', id: license.id }, {
          from,
          to: plan.key,
          subscription: sub.id,
        });
      }
    }
  }
  // A product that is no longer part of the subscription stops granting access.
  if (byProduct.size > 0) {
    for (const license of licenses) {
      if (!byProduct.has(license.product_id) && license.status === 'active') {
        ctx.db.update(
          'licenses',
          { id: license.id },
          { status: 'suspended', status_reason: REMOVED_FROM_SUBSCRIPTION, status_changed_at: now, updated_at: now },
        );
        audit(ctx, project.id, actor, 'license.suspended', { type: 'license', id: license.id }, { reason: REMOVED_FROM_SUBSCRIPTION });
      }
    }
  }

  const verb = event.type.replace('customer.subscription.', '');
  audit(
    ctx,
    project.id,
    actor,
    `subscription.${verb}`,
    customer ? { type: 'customer', id: customer.id } : { type: 'subscription', id: subscription.id },
    {
      subscription: sub.id,
      status: sub.status,
      plans: [...byProduct.values()].map((p) => p.key),
      cancel_at_period_end: sub.cancel_at_period_end === true,
    },
  );

  if (byProduct.size === 0) {
    return {
      status: 'ignored',
      message:
        priceIds.length === 0
          ? 'Subscription has no prices.'
          : `No Keyvane plan is mapped to Stripe price ${unmapped.join(', ')}. Add the price ID to a plan, then reprocess this event.`,
    };
  }
  return { status: 'processed', message: unmapped.length > 0 ? `Synced. Unmapped prices ignored: ${unmapped.join(', ')}.` : null };
}

function handleCheckoutSession(ctx: Ctx, project: ProjectRow, event: StripeEvent, session: StripeCheckoutSession): Outcome {
  if (session.mode && session.mode !== 'subscription') {
    return { status: 'ignored', message: `Checkout mode "${session.mode}" is not handled yet (subscriptions only).` };
  }
  const stripeCustomerId = idOf(session.customer);
  const externalId = session.client_reference_id || session.metadata?.keyvane_customer_id || null;
  if (!stripeCustomerId && !externalId) return { status: 'ignored', message: 'Checkout session has no customer.' };
  const customer = linkStripeCustomer(ctx, project.id, {
    stripeCustomerId,
    externalId,
    email: session.customer_details?.email ?? session.customer_email ?? null,
    name: session.customer_details?.name ?? null,
  });
  const providerSubId = idOf(session.subscription);
  if (providerSubId && customer) {
    const subscription = findSubscription(ctx, project.id, providerSubId);
    if (subscription && subscription.customer_id !== customer.id) {
      ctx.db.run('UPDATE subscriptions SET customer_id = ? WHERE id = ?', customer.id, subscription.id);
      ctx.db.run('UPDATE licenses SET customer_id = ? WHERE subscription_id = ?', customer.id, subscription.id);
    }
  }
  audit(ctx, project.id, stripeActor(event), 'checkout.completed', customer ? { type: 'customer', id: customer.id } : null, {
    session: session.id,
    subscription: providerSubId,
    client_reference_id: externalId,
  });
  return {
    status: 'processed',
    message: externalId
      ? `Linked to customer "${externalId}".`
      : 'No client_reference_id on the session; the customer is identified by Stripe customer ID only.',
  };
}

function handleCustomer(ctx: Ctx, project: ProjectRow, stripeCustomer: StripeCustomer): Outcome {
  if (!stripeCustomer?.id || stripeCustomer.deleted) return { status: 'ignored', message: 'Deleted or empty customer.' };
  const externalId = stripeCustomer.metadata?.keyvane_customer_id || null;
  const known = ctx.db.get('SELECT id FROM customers WHERE project_id = ? AND stripe_customer_id = ?', project.id, stripeCustomer.id);
  if (!known && !externalId) {
    return { status: 'ignored', message: 'This Stripe customer is not linked to a Keyvane customer yet.' };
  }
  linkStripeCustomer(ctx, project.id, {
    stripeCustomerId: stripeCustomer.id,
    externalId,
    email: stripeCustomer.email ?? null,
    name: stripeCustomer.name ?? null,
  });
  return { status: 'processed' };
}

function handleInvoice(ctx: Ctx, project: ProjectRow, event: StripeEvent, invoice: StripeInvoice): Outcome {
  const stripeCustomerId = idOf(invoice.customer);
  const customer = stripeCustomerId
    ? ctx.db.get<CustomerRow>('SELECT * FROM customers WHERE project_id = ? AND stripe_customer_id = ?', project.id, stripeCustomerId)
    : undefined;
  const subscriptionId = idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription) ?? null;
  const paid = event.type === 'invoice.paid';
  if (paid && typeof invoice.amount_paid === 'number' && invoice.amount_paid > 0 && invoice.currency) {
    bump(ctx, project.id, `revenue_${invoice.currency.toLowerCase()}`, invoice.amount_paid);
  }
  audit(
    ctx,
    project.id,
    stripeActor(event),
    paid ? 'invoice.paid' : 'invoice.payment_failed',
    customer ? { type: 'customer', id: customer.id } : null,
    {
      invoice: invoice.id,
      amount: paid ? (invoice.amount_paid ?? null) : (invoice.amount_due ?? null),
      currency: invoice.currency ?? null,
      subscription: subscriptionId,
    },
  );
  return { status: 'processed' };
}

// ---------------------------------------------------------------------------
// Dashboard helpers
// ---------------------------------------------------------------------------

export function listWebhookEvents(
  ctx: Ctx,
  projectId: string,
  opts: { status?: string; limit?: number; startingAfter?: string } = {},
): { data: WebhookEventRow[]; hasMore: boolean } {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const where = ['project_id = ?'];
  const params: string[] = [projectId];
  if (opts.status && ['pending', 'processed', 'ignored', 'failed'].includes(opts.status)) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts.startingAfter) {
    where.push('id < ?');
    params.push(opts.startingAfter);
  }
  const rows = ctx.db.all<WebhookEventRow>(
    `SELECT * FROM webhook_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit + 1}`,
    ...params,
  );
  return { data: rows.slice(0, limit), hasMore: rows.length > limit };
}

export function getWebhookEvent(ctx: Ctx, projectId: string, id: string): WebhookEventRow {
  const row = ctx.db.get<WebhookEventRow>('SELECT * FROM webhook_events WHERE id = ? AND project_id = ?', id, projectId);
  if (!row) throw notFound('Webhook event');
  return row;
}

export function reprocessWebhookEvent(
  ctx: Ctx,
  projectId: string,
  eventId: string,
  actor: Actor,
): { status: WebhookStatus; message: string | null } {
  const project = getProject(ctx, projectId);
  if (!project) throw notFound('Project');
  const record = getWebhookEvent(ctx, projectId, eventId);
  if (record.status === 'processed') {
    throw conflict('already_processed', 'This event was already processed successfully.');
  }
  audit(ctx, projectId, actor, 'webhook.reprocessed', { type: 'webhook_event', id: record.id }, {
    type: record.type,
    event: record.provider_event_id,
  });
  return processWebhookRecord(ctx, project, record);
}

export function webhookCounts(ctx: Ctx, projectId: string): Record<WebhookStatus, number> {
  const rows = ctx.db.all<{ status: WebhookStatus; n: number }>(
    'SELECT status, COUNT(*) AS n FROM webhook_events WHERE project_id = ? GROUP BY status',
    projectId,
  );
  const out: Record<WebhookStatus, number> = { pending: 0, processed: 0, ignored: 0, failed: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
