import { addDays, dayKey } from '../lib/time.ts';
import type { Ctx } from '../types.ts';

export type Metric =
  | 'entitlement_checks'
  | 'license_validations'
  | 'usage_recorded'
  | 'usage_denied'
  | 'webhooks_processed'
  | 'webhooks_failed'
  | `revenue_${string}`;

/** Increment a per-project daily counter. Cheap enough to call on every API request. */
export function bump(ctx: Ctx, projectId: string, metric: Metric, by = 1): void {
  ctx.db.run(
    `INSERT INTO daily_stats (project_id, day, metric, value) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id, day, metric) DO UPDATE SET value = value + excluded.value`,
    projectId,
    dayKey(ctx.now()),
    metric,
    by,
  );
}

/** Daily values for the last `days` days (oldest first), with zero-filled gaps. */
export function series(ctx: Ctx, projectId: string, metric: Metric, days: number): { day: string; value: number }[] {
  const today = ctx.now();
  const start = dayKey(addDays(today, -(days - 1)));
  const rows = ctx.db.all<{ day: string; value: number }>(
    'SELECT day, value FROM daily_stats WHERE project_id = ? AND metric = ? AND day >= ?',
    projectId,
    metric,
    start,
  );
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  const out: { day: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(addDays(today, -i));
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

export function total(ctx: Ctx, projectId: string, metric: Metric, days: number): number {
  const start = dayKey(addDays(ctx.now(), -(days - 1)));
  const row = ctx.db.get<{ total: number | null }>(
    'SELECT SUM(value) AS total FROM daily_stats WHERE project_id = ? AND metric = ? AND day >= ?',
    projectId,
    metric,
    start,
  );
  return row?.total ?? 0;
}

export function allTime(ctx: Ctx, projectId: string, metric: Metric): number {
  const row = ctx.db.get<{ total: number | null }>(
    'SELECT SUM(value) AS total FROM daily_stats WHERE project_id = ? AND metric = ?',
    projectId,
    metric,
  );
  return row?.total ?? 0;
}
