import type { Ctx } from '../types.ts';

export interface MaintenanceReport {
  expiredSessions: number;
  passwordResets: number;
  trimmedWebhookPayloads: number;
  deletedUsageEvents: number;
}

/**
 * Housekeeping that keeps the database small and free of stale secrets. Safe to run at
 * any time; the server runs it at startup and every six hours.
 */
export function runMaintenance(ctx: Ctx): MaintenanceReport {
  const now = ctx.now();
  const iso = now.toISOString();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return ctx.db.transaction(() => {
    const expiredSessions = ctx.db.run('DELETE FROM sessions WHERE expires_at <= ?', iso).changes;
    const passwordResets = ctx.db.run('DELETE FROM password_resets WHERE expires_at <= ? OR used_at IS NOT NULL', daysAgo(1)).changes;
    // Processed events keep their status and outcome; only the raw payload is dropped.
    const trimmedWebhookPayloads = ctx.db.run(
      `UPDATE webhook_events SET payload = '{"trimmed":true}'
       WHERE status = 'processed' AND received_at < ? AND payload != '{"trimmed":true}'`,
      daysAgo(ctx.config.retention.webhookPayloadDays),
    ).changes;
    const deletedUsageEvents = ctx.db.run('DELETE FROM usage_events WHERE created_at < ?', daysAgo(ctx.config.retention.usageEventDays)).changes;
    return { expiredSessions, passwordResets, trimmedWebhookPayloads, deletedUsageEvents };
  });
}

export function optimizeDatabase(ctx: Ctx): void {
  ctx.db.exec('PRAGMA optimize');
}
