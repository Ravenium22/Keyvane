import { randomBase62, sha256Hex } from '../lib/crypto.ts';
import { notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { str } from '../lib/validate.ts';
import type { Actor, ApiKeyRow, ApiKeyType, Ctx, ProjectRow } from '../types.ts';
import { audit } from './audit.ts';

/**
 * API keys:
 * - Secret keys (`kv_sk_…`) have full access and must stay on your server. Only a hash is stored.
 * - Publishable keys (`kv_pk_…`) can only validate/activate license keys, so they are safe to
 *   ship inside desktop apps, CLIs and browsers. They are stored in plain text and always visible.
 */

const PREFIX: Record<ApiKeyType, string> = { secret: 'kv_sk_', publishable: 'kv_pk_' };

export function createApiKey(
  ctx: Ctx,
  projectId: string,
  input: { type: ApiKeyType; name?: unknown },
  actor: Actor,
): { apiKey: ApiKeyRow; token: string } {
  const name = str(input.name, 'name', { max: 60 }) ?? (input.type === 'secret' ? 'Secret key' : 'Publishable key');
  const token = PREFIX[input.type] + randomBase62(32);
  const apiKey: ApiKeyRow = {
    id: newId('key'),
    project_id: projectId,
    type: input.type,
    name,
    token_hash: sha256Hex(token),
    token_prefix: `${token.slice(0, 10)}…${token.slice(-4)}`,
    token_plain: input.type === 'publishable' ? token : null,
    last_used_at: null,
    revoked_at: null,
    created_by: 'id' in actor ? (actor.id ?? null) : null,
    created_at: ctx.now().toISOString(),
  };
  ctx.db.insert('api_keys', { ...apiKey });
  audit(ctx, projectId, actor, 'api_key.created', { type: 'api_key', id: apiKey.id }, { name, key_type: input.type });
  return { apiKey, token };
}

export function listApiKeys(ctx: Ctx, projectId: string): ApiKeyRow[] {
  return ctx.db.all<ApiKeyRow>(
    'SELECT * FROM api_keys WHERE project_id = ? ORDER BY revoked_at IS NOT NULL, type DESC, created_at DESC',
    projectId,
  );
}

export function revokeApiKey(ctx: Ctx, projectId: string, keyId: string, actor: Actor): void {
  const key = ctx.db.get<ApiKeyRow>('SELECT * FROM api_keys WHERE id = ? AND project_id = ?', keyId, projectId);
  if (!key) throw notFound('API key');
  if (key.revoked_at) return;
  ctx.db.update('api_keys', { id: keyId }, { revoked_at: ctx.now().toISOString() });
  audit(ctx, projectId, actor, 'api_key.revoked', { type: 'api_key', id: keyId }, { name: key.name, key_type: key.type });
}

export function authenticateApiKey(ctx: Ctx, token: string): { apiKey: ApiKeyRow; project: ProjectRow } | null {
  if (!token.startsWith('kv_sk_') && !token.startsWith('kv_pk_')) return null;
  const apiKey = ctx.db.get<ApiKeyRow>('SELECT * FROM api_keys WHERE token_hash = ?', sha256Hex(token));
  if (!apiKey || apiKey.revoked_at) return null;
  const project = ctx.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', apiKey.project_id);
  if (!project) return null;
  const now = ctx.now();
  // Record usage at most once a minute to avoid a write on every request.
  if (!apiKey.last_used_at || now.getTime() - Date.parse(apiKey.last_used_at) > 60_000) {
    ctx.db.update('api_keys', { id: apiKey.id }, { last_used_at: now.toISOString() });
  }
  return { apiKey, project };
}
