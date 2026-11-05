import type { Ctx } from '../types.ts';

/** Growth and reliability metrics from section 18 of the business plan. */
export function platformMetrics(ctx: Ctx, days = 7): [string, number][] {
  const since = new Date(ctx.now().getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const one = (sql: string, ...params: string[]) => ctx.db.get<{ n: number | null }>(sql, ...params)?.n ?? 0;
  const api = "('entitlement_checks', 'license_validations', 'usage_recorded')";
  return [
    ['Registered developers', one('SELECT COUNT(*) AS n FROM users')],
    [`New developers (last ${days} days)`, one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since)],
    ['Created projects', one('SELECT COUNT(*) AS n FROM projects')],
    ['Projects with a product', one('SELECT COUNT(DISTINCT project_id) AS n FROM products')],
    ['Activated projects (any API call, ever)', one(`SELECT COUNT(DISTINCT project_id) AS n FROM daily_stats WHERE metric IN ${api} AND value > 0`)],
    [`Active projects (API calls in last ${days} days)`, one(`SELECT COUNT(DISTINCT project_id) AS n FROM daily_stats WHERE metric IN ${api} AND value > 0 AND day >= ?`, since)],
    ['Projects connected to Stripe (event received)', one('SELECT COUNT(*) AS n FROM projects WHERE stripe_last_event_at IS NOT NULL')],
    ['Customers (end users)', one('SELECT COUNT(*) AS n FROM customers')],
    ['Active licenses', one("SELECT COUNT(*) AS n FROM licenses WHERE status = 'active'")],
    ['Active subscriptions', one("SELECT COUNT(*) AS n FROM subscriptions WHERE status IN ('active', 'trialing')")],
    [`Entitlement checks (last ${days} days)`, one("SELECT SUM(value) AS n FROM daily_stats WHERE metric = 'entitlement_checks' AND day >= ?", since)],
    [`License validations (last ${days} days)`, one("SELECT SUM(value) AS n FROM daily_stats WHERE metric = 'license_validations' AND day >= ?", since)],
    [`Usage units metered (last ${days} days)`, one("SELECT SUM(value) AS n FROM daily_stats WHERE metric = 'usage_recorded' AND day >= ?", since)],
    ['Stripe events processed (all time)', one("SELECT COUNT(*) AS n FROM webhook_events WHERE status IN ('processed', 'ignored')")],
    ['Stripe events failed (all time)', one("SELECT COUNT(*) AS n FROM webhook_events WHERE status = 'failed'")],
  ];
}
