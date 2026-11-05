/**
 * Send realistic, correctly signed Stripe webhook events to a running Keyvane server —
 * no Stripe account needed. Great for demos and for testing your integration.
 *
 * Usage:
 *   npm run stripe:simulate -- <action> --project <proj_id> --customer <your user id> [--plan pro] [--url http://localhost:8787]
 *
 * Actions:
 *   subscribe              checkout completed + active subscription (default plan: the first paid plan)
 *   upgrade|downgrade      switch the subscription to --plan
 *   past-due               a renewal payment failed (grace period starts)
 *   recover                the payment succeeded again
 *   cancel-at-period-end   the customer canceled in the portal (access until period end)
 *   cancel                 the subscription ended now
 */
import { createHash } from 'node:crypto';
import { checkoutSessionObject, eventEnvelope, subscriptionObject } from '../src/dev/stripe-fixtures.ts';
import { listProducts, loadCatalog, planPriceIds } from '../src/services/catalog.ts';
import { getProject, getStripeWebhookSecret } from '../src/services/projects.ts';
import { signStripePayload } from '../src/services/stripe/signature.ts';
import type { PlanRow, SubscriptionRow } from '../src/types.ts';
import { openContext, parseArgs } from './_context.ts';

const ACTIONS = ['subscribe', 'upgrade', 'downgrade', 'past-due', 'recover', 'cancel-at-period-end', 'cancel'] as const;
type Action = (typeof ACTIONS)[number];

const { positional, flags } = parseArgs(process.argv.slice(2));
const fail = (message: string): never => {
  console.error(`\n${message}\n\nUsage: npm run stripe:simulate -- <${ACTIONS.join('|')}> --project <proj_id> --customer <user id> [--plan <plan key>] [--url <base url>]\n`);
  process.exit(1);
};
const action: Action = ACTIONS.includes(positional[0] as Action) ? (positional[0] as Action) : fail('Missing or unknown action.');

const ctx = openContext();
const projectId =
  typeof flags.project === 'string'
    ? flags.project
    : (ctx.db.get<{ id: string }>('SELECT id FROM projects WHERE stripe_webhook_secret IS NOT NULL ORDER BY created_at DESC LIMIT 1')?.id ?? fail('No project with a Stripe webhook secret. Pass --project.'));
const project = getProject(ctx, projectId) ?? fail(`Project ${projectId} not found.`);
const secret = getStripeWebhookSecret(ctx, project) ?? fail('This project has no Stripe webhook secret. Add one on the Stripe page of the dashboard.');
const customer = typeof flags.customer === 'string' ? flags.customer : fail('Missing --customer (your user ID, e.g. user_42).');
const baseUrl = (typeof flags.url === 'string' ? flags.url : ctx.config.publicUrl).replace(/\/+$/, '');

const hash = createHash('sha256').update(`${project.id}:${customer}`).digest('hex').slice(0, 14);
const cusId = `cus_sim_${hash}`;
// Latest simulated subscription for this customer. A canceled one cannot be revived, so
// "subscribe" after a cancellation starts a new subscription, just like in Stripe.
const latest = ctx.db.get<SubscriptionRow>(
  "SELECT * FROM subscriptions WHERE project_id = ? AND provider_subscription_id LIKE ? ORDER BY created_at DESC, id DESC LIMIT 1",
  project.id,
  `sub_sim_${hash}%`,
);
const ended = !!latest && ['canceled', 'incomplete_expired'].includes(latest.status);
const existing = ended ? undefined : latest;
const subId = existing?.provider_subscription_id ?? (latest ? `sub_sim_${hash}_${Date.now().toString(36)}` : `sub_sim_${hash}`);

const paidPlans: PlanRow[] = listProducts(ctx, project.id)
  .flatMap((p) => loadCatalog(ctx, p).plans)
  .filter((p) => planPriceIds(p).length > 0);
if (paidPlans.length === 0) fail('No plan has a Stripe price ID. Add one (any value, e.g. price_test_pro) to a plan first.');
const planKey = typeof flags.plan === 'string' ? flags.plan : undefined;
const currentPrice = existing ? (JSON.parse(existing.price_ids) as string[])[0] : undefined;
const plan =
  (planKey ? paidPlans.find((p) => p.key === planKey) : undefined) ??
  (!planKey && currentPrice ? paidPlans.find((p) => planPriceIds(p).includes(currentPrice)) : undefined) ??
  (planKey ? fail(`No plan "${planKey}" with a Stripe price. Plans with prices: ${paidPlans.map((p) => p.key).join(', ')}`) : paidPlans[0]) as PlanRow;
const priceId = planPriceIds(plan)[0] as string;

const now = Math.floor(Date.now() / 1000);
const periodStart = existing?.current_period_start ? Math.floor(Date.parse(existing.current_period_start) / 1000) : now;
const periodEnd = existing?.current_period_end ? Math.floor(Date.parse(existing.current_period_end) / 1000) : now + 30 * 86400;
if (action !== 'subscribe' && !existing) fail(`No simulated subscription for ${customer} yet. Run "subscribe" first.`);

const statusFor: Record<Action, string> = {
  subscribe: 'active',
  upgrade: 'active',
  downgrade: 'active',
  'past-due': 'past_due',
  recover: 'active',
  'cancel-at-period-end': 'active',
  cancel: 'canceled',
};
const sub = subscriptionObject({
  id: subId,
  customer: cusId,
  status: statusFor[action],
  prices: [{ id: priceId, amount: plan.price_amount ?? 0, currency: plan.currency, interval: plan.billing_interval === 'year' ? 'year' : 'month' }],
  periodStart,
  periodEnd,
  cancelAtPeriodEnd: action === 'cancel-at-period-end',
  canceledAt: action === 'cancel' || action === 'cancel-at-period-end' ? now : null,
  endedAt: action === 'cancel' ? now : null,
  metadata: { keyvane_customer_id: customer },
});

const events = [];
if (action === 'subscribe') {
  events.push(eventEnvelope('checkout.session.completed', checkoutSessionObject({ id: `cs_sim_${hash}`, customer: cusId, subscription: subId, clientReferenceId: customer }), now));
  events.push(eventEnvelope('customer.subscription.created', sub, now));
  events.push(eventEnvelope('invoice.paid', { id: `in_sim_${now}`, object: 'invoice', customer: cusId, subscription: subId, amount_paid: plan.price_amount ?? 0, currency: plan.currency }, now));
} else if (action === 'past-due') {
  events.push(eventEnvelope('invoice.payment_failed', { id: `in_sim_${now}`, object: 'invoice', customer: cusId, subscription: subId, amount_due: plan.price_amount ?? 0, currency: plan.currency }, now));
  events.push(eventEnvelope('customer.subscription.updated', sub, now));
} else if (action === 'cancel') {
  events.push(eventEnvelope('customer.subscription.deleted', sub, now));
} else {
  events.push(eventEnvelope('customer.subscription.updated', sub, now));
}

console.log(`\nSimulating "${action}" for customer ${customer} on plan ${plan.key} (${priceId}) → ${baseUrl}`);
for (const event of events) {
  const payload = JSON.stringify(event);
  try {
    const res = await fetch(`${baseUrl}/v1/webhooks/stripe/${project.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(payload, secret) },
      body: payload,
    });
    console.log(`  ${event.type.padEnd(34)} ${res.status} ${await res.text()}`);
  } catch (err) {
    fail(`Could not reach ${baseUrl}. Is the server running (npm run dev)? ${(err as Error).message}`);
  }
}
console.log(`\nCheck it: GET ${baseUrl}/v1/entitlements?customer=${customer}\n`);
ctx.db.close();
