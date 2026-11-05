/**
 * Builders for realistic Stripe webhook payloads. Used by the test suite and by
 * `npm run stripe:simulate`, so you can try purchases, upgrades, failed payments and
 * cancellations locally without a Stripe account.
 */

export interface SubscriptionFixture {
  id: string;
  customer: string;
  status: string;
  prices: { id: string; amount: number; currency?: string; interval?: string }[];
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: number | null;
  endedAt?: number | null;
  metadata?: Record<string, string>;
  /** Billing period on items (Stripe API ≥ 2025-03-31) or on the subscription (older versions). */
  periodOnItems?: boolean;
}

export function subscriptionObject(f: SubscriptionFixture) {
  const onItems = f.periodOnItems ?? true;
  return {
    id: f.id,
    object: 'subscription',
    customer: f.customer,
    status: f.status,
    metadata: f.metadata ?? {},
    cancel_at_period_end: f.cancelAtPeriodEnd ?? false,
    cancel_at: f.cancelAtPeriodEnd ? f.periodEnd : null,
    canceled_at: f.canceledAt ?? null,
    ended_at: f.endedAt ?? null,
    trial_end: null,
    ...(onItems ? {} : { current_period_start: f.periodStart, current_period_end: f.periodEnd }),
    items: {
      object: 'list',
      data: f.prices.map((price, i) => ({
        id: `si_${f.id.replace(/^sub_/, '')}_${i}`,
        object: 'subscription_item',
        quantity: 1,
        ...(onItems ? { current_period_start: f.periodStart, current_period_end: f.periodEnd } : {}),
        price: {
          id: price.id,
          object: 'price',
          currency: price.currency ?? 'usd',
          unit_amount: price.amount,
          recurring: { interval: price.interval ?? 'month', interval_count: 1 },
        },
      })),
    },
  };
}

let counter = 0;

export function eventEnvelope(type: string, object: Record<string, unknown>, created: number, id?: string) {
  return {
    id: id ?? `evt_sim_${created}_${++counter}_${Math.random().toString(36).slice(2, 8)}`,
    object: 'event',
    type,
    created,
    livemode: false,
    api_version: '2025-03-31.basil',
    data: { object },
  };
}

export function checkoutSessionObject(opts: { id: string; customer: string; subscription: string; clientReferenceId: string; email?: string }) {
  return {
    id: opts.id,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    customer: opts.customer,
    subscription: opts.subscription,
    client_reference_id: opts.clientReferenceId,
    customer_details: { email: opts.email ?? null, name: null },
    metadata: {},
  };
}
