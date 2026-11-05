import { parseJson } from '../db/sqlite.ts';
import type { Ctx, SubscriptionRow } from '../types.ts';

export function getSubscription(ctx: Ctx, id: string): SubscriptionRow | null {
  return ctx.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', id) ?? null;
}

export function listSubscriptionsForCustomer(ctx: Ctx, customerId: string): SubscriptionRow[] {
  return ctx.db.all<SubscriptionRow>('SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY id DESC', customerId);
}

export function subscriptionPriceIds(sub: SubscriptionRow): string[] {
  return parseJson<string[]>(sub.price_ids, []);
}

/** Normalize a subscription amount to a monthly figure (minor units) for MRR. */
export function monthlyAmount(sub: SubscriptionRow): number {
  if (sub.amount === null) return 0;
  const count = sub.interval_count && sub.interval_count > 0 ? sub.interval_count : 1;
  switch (sub.billing_interval) {
    case 'year':
      return Math.round(sub.amount / (12 * count));
    case 'week':
      return Math.round((sub.amount * 52) / (12 * count));
    case 'day':
      return Math.round((sub.amount * 365) / (12 * count));
    case 'month':
    default:
      return Math.round(sub.amount / count);
  }
}

/** Monthly recurring revenue by currency, from subscriptions that are currently paying. */
export function mrrByCurrency(ctx: Ctx, projectId: string): Record<string, number> {
  const subs = ctx.db.all<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE project_id = ? AND status IN ('active', 'past_due')`,
    projectId,
  );
  const out: Record<string, number> = {};
  for (const sub of subs) {
    if (!sub.currency) continue;
    out[sub.currency] = (out[sub.currency] ?? 0) + monthlyAmount(sub);
  }
  return out;
}

export function countSubscriptions(ctx: Ctx, projectId: string): { active: number; trialing: number; pastDue: number } {
  const rows = ctx.db.all<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM subscriptions WHERE project_id = ? GROUP BY status',
    projectId,
  );
  const get = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { active: get('active'), trialing: get('trialing'), pastDue: get('past_due') + get('unpaid') };
}
