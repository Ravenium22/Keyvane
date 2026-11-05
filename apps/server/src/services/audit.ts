import { parseJson } from '../db/sqlite.ts';
import { newId } from '../lib/ids.ts';
import type { Actor, AuditLogRow, Ctx } from '../types.ts';

export interface AuditTarget {
  type: string;
  id: string;
}

export function audit(
  ctx: Ctx,
  projectId: string,
  actor: Actor,
  action: string,
  target: AuditTarget | null = null,
  data: Record<string, unknown> = {},
): void {
  ctx.db.insert('audit_logs', {
    id: newId('aud'),
    project_id: projectId,
    actor_type: actor.type,
    actor_id: 'id' in actor ? (actor.id ?? null) : null,
    actor_label: actor.label ?? null,
    action,
    target_type: target?.type ?? null,
    target_id: target?.id ?? null,
    data: JSON.stringify(data),
    created_at: ctx.now().toISOString(),
  });
}

export interface AuditQuery {
  limit?: number;
  startingAfter?: string;
  targetIds?: string[];
  actionPrefix?: string;
}

export function listAudit(ctx: Ctx, projectId: string, query: AuditQuery = {}): { data: AuditLogRow[]; hasMore: boolean } {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const where = ['project_id = ?'];
  const params: string[] = [projectId];
  if (query.startingAfter) {
    where.push('id < ?');
    params.push(query.startingAfter);
  }
  if (query.targetIds && query.targetIds.length > 0) {
    where.push(`target_id IN (${query.targetIds.map(() => '?').join(', ')})`);
    params.push(...query.targetIds);
  }
  if (query.actionPrefix) {
    where.push('action LIKE ?');
    params.push(`${query.actionPrefix}%`);
  }
  const rows = ctx.db.all<AuditLogRow>(
    `SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit + 1}`,
    ...params,
  );
  return { data: rows.slice(0, limit), hasMore: rows.length > limit };
}

export function auditData(row: AuditLogRow): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(row.data, {});
}
