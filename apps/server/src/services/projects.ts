import { decrypt, deriveKey, encrypt } from '../lib/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { str } from '../lib/validate.ts';
import type { Actor, Ctx, ProjectRow } from '../types.ts';
import { createApiKey } from './api-keys.ts';
import { audit } from './audit.ts';

export type ProjectRole = 'owner' | 'admin' | 'member';
export type ProjectWithRole = ProjectRow & { role: ProjectRole };

const keyCache = new Map<string, Buffer>();
function providerSecretKey(ctx: Ctx): Buffer {
  let key = keyCache.get(ctx.config.secret);
  if (!key) {
    key = deriveKey(ctx.config.secret, 'provider-secrets');
    keyCache.set(ctx.config.secret, key);
  }
  return key;
}

export function createProject(ctx: Ctx, ownerId: string, input: { name: unknown }, actor: Actor): ProjectRow {
  const name = str(input.name, 'name', { required: true, max: 80 });
  const now = ctx.now().toISOString();
  const project: ProjectRow = {
    id: newId('proj'),
    name,
    owner_id: ownerId,
    stripe_webhook_secret: null,
    stripe_connected_at: null,
    stripe_last_event_at: null,
    created_at: now,
    updated_at: now,
  };
  ctx.db.transaction(() => {
    ctx.db.insert('projects', { ...project });
    ctx.db.insert('project_members', { project_id: project.id, user_id: ownerId, role: 'owner', created_at: now });
    // Publishable keys are safe to embed in apps, so every project starts with one.
    createApiKey(ctx, project.id, { type: 'publishable', name: 'Default publishable key' }, actor);
    audit(ctx, project.id, actor, 'project.created', { type: 'project', id: project.id }, { name });
  });
  return project;
}

export function listProjectsForUser(ctx: Ctx, userId: string): ProjectWithRole[] {
  return ctx.db.all<ProjectWithRole>(
    `SELECT projects.*, project_members.role AS role FROM projects
     JOIN project_members ON project_members.project_id = projects.id
     WHERE project_members.user_id = ? ORDER BY projects.created_at ASC`,
    userId,
  );
}

export function getProjectForUser(ctx: Ctx, projectId: string, userId: string): ProjectWithRole | null {
  return (
    ctx.db.get<ProjectWithRole>(
      `SELECT projects.*, project_members.role AS role FROM projects
       JOIN project_members ON project_members.project_id = projects.id
       WHERE projects.id = ? AND project_members.user_id = ?`,
      projectId,
      userId,
    ) ?? null
  );
}

export function getProject(ctx: Ctx, projectId: string): ProjectRow | null {
  return ctx.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', projectId) ?? null;
}

export function renameProject(ctx: Ctx, projectId: string, input: { name: unknown }, actor: Actor): void {
  const name = str(input.name, 'name', { required: true, max: 80 });
  ctx.db.update('projects', { id: projectId }, { name, updated_at: ctx.now().toISOString() });
  audit(ctx, projectId, actor, 'project.updated', { type: 'project', id: projectId }, { name });
}

export function deleteProject(ctx: Ctx, projectId: string): void {
  ctx.db.transaction(() => {
    // Licenses reference plans without cascade; remove them first, then let cascades do the rest.
    ctx.db.run('DELETE FROM licenses WHERE project_id = ?', projectId);
    ctx.db.run('DELETE FROM projects WHERE id = ?', projectId);
  });
}

// ---------------------------------------------------------------------------
// Stripe connection (webhook signing secret, encrypted at rest)
// ---------------------------------------------------------------------------

export function setStripeWebhookSecret(ctx: Ctx, projectId: string, secret: string | null, actor: Actor): void {
  const now = ctx.now().toISOString();
  if (secret === null) {
    ctx.db.run(
      'UPDATE projects SET stripe_webhook_secret = NULL, stripe_connected_at = NULL, updated_at = ? WHERE id = ?',
      now,
      projectId,
    );
    audit(ctx, projectId, actor, 'stripe.disconnected', { type: 'project', id: projectId });
    return;
  }
  const value = secret.trim();
  if (!/^whsec_[A-Za-z0-9+/=_-]{8,}$/.test(value)) {
    throw badRequest(
      'invalid_webhook_secret',
      'That does not look like a Stripe webhook signing secret. It starts with "whsec_".',
      'webhook_secret',
    );
  }
  ctx.db.update(
    'projects',
    { id: projectId },
    { stripe_webhook_secret: encrypt(value, providerSecretKey(ctx)), stripe_connected_at: now, updated_at: now },
  );
  audit(ctx, projectId, actor, 'stripe.connected', { type: 'project', id: projectId });
}

export function getStripeWebhookSecret(ctx: Ctx, project: ProjectRow): string | null {
  if (!project.stripe_webhook_secret) return null;
  try {
    return decrypt(project.stripe_webhook_secret, providerSecretKey(ctx));
  } catch {
    // Wrong KEYVANE_SECRET (e.g. rotated) — treat as not configured so the owner re-enters it.
    return null;
  }
}

export function webhookUrl(ctx: Ctx, projectId: string): string {
  return `${ctx.config.publicUrl}/v1/webhooks/stripe/${projectId}`;
}
