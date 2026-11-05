import { parseJson } from '../db/sqlite.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { EMAIL_PATTERN, mergeMetadata, metadata, nullableStr, str, type Metadata } from '../lib/validate.ts';
import type { Actor, Ctx, CustomerRow } from '../types.ts';
import { audit } from './audit.ts';

/**
 * Customers are the end users of a developer's product. They are identified by the
 * developer's own user ID (`external_id`), so apps never need to store Keyvane IDs.
 */

export const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_.:@|+\-]{1,200}$/;

export function customerMetadata(customer: CustomerRow): Metadata {
  return parseJson<Metadata>(customer.metadata, {});
}

export function getCustomerById(ctx: Ctx, projectId: string, id: string): CustomerRow | null {
  return ctx.db.get<CustomerRow>('SELECT * FROM customers WHERE id = ? AND project_id = ?', id, projectId) ?? null;
}

/** Look a customer up by Keyvane ID or by the developer's external ID. */
export function getCustomer(ctx: Ctx, projectId: string, idOrExternalId: string): CustomerRow | null {
  return (
    ctx.db.get<CustomerRow>(
      `SELECT * FROM customers WHERE project_id = ? AND (id = ? OR external_id = ?)
       ORDER BY id = ? DESC LIMIT 1`,
      projectId,
      idOrExternalId,
      idOrExternalId,
      idOrExternalId,
    ) ?? null
  );
}

export function requireCustomer(ctx: Ctx, projectId: string, idOrExternalId: string): CustomerRow {
  const customer = getCustomer(ctx, projectId, idOrExternalId);
  if (!customer) throw notFound(`Customer "${idOrExternalId}"`, 'customer_not_found');
  return customer;
}

function validateExternalId(value: unknown, field = 'external_id'): string | undefined {
  return str(value, field, {
    max: 200,
    pattern: EXTERNAL_ID_PATTERN,
    patternMessage: `${field} may contain letters, numbers and _ . : @ | + - (max 200 characters).`,
  });
}

function validateEmail(value: unknown): string | null | undefined {
  const email = nullableStr(value, 'email', { max: 254 });
  if (email && !EMAIL_PATTERN.test(email)) throw badRequest('parameter_invalid', 'email must be a valid email address.', 'email');
  return email === undefined || email === null ? email : email.toLowerCase();
}

function insertCustomer(ctx: Ctx, projectId: string, fields: Partial<CustomerRow>): CustomerRow {
  const now = ctx.now().toISOString();
  const customer: CustomerRow = {
    id: newId('cust'),
    project_id: projectId,
    external_id: fields.external_id ?? null,
    email: fields.email ?? null,
    name: fields.name ?? null,
    stripe_customer_id: fields.stripe_customer_id ?? null,
    metadata: fields.metadata ?? '{}',
    last_seen_at: null,
    created_at: now,
    updated_at: now,
  };
  ctx.db.insert('customers', { ...customer });
  return customer;
}

export interface CustomerInput {
  externalId?: unknown;
  email?: unknown;
  name?: unknown;
  metadata?: unknown;
}

/** Create a customer, or update the one with the same external ID. */
export function upsertCustomer(
  ctx: Ctx,
  projectId: string,
  input: CustomerInput,
  actor: Actor,
): { customer: CustomerRow; created: boolean } {
  const externalId = validateExternalId(input.externalId);
  const email = validateEmail(input.email);
  const name = nullableStr(input.name, 'name', { max: 120 });
  const meta = metadata(input.metadata);
  if (!externalId && !email) {
    throw badRequest('parameter_missing', 'Provide an external_id (your user ID) or an email.', 'external_id');
  }
  return ctx.db.transaction(() => {
    const existing = externalId
      ? ctx.db.get<CustomerRow>('SELECT * FROM customers WHERE project_id = ? AND external_id = ?', projectId, externalId)
      : undefined;
    if (existing) {
      const patch: Partial<CustomerRow> = {};
      if (email !== undefined) patch.email = email;
      if (name !== undefined) patch.name = name;
      if (meta !== undefined) patch.metadata = JSON.stringify(mergeMetadata(customerMetadata(existing), meta));
      if (Object.keys(patch).length > 0) {
        ctx.db.update('customers', { id: existing.id }, { ...patch, updated_at: ctx.now().toISOString() });
      }
      return { customer: { ...existing, ...patch }, created: false };
    }
    const customer = insertCustomer(ctx, projectId, {
      external_id: externalId ?? null,
      email: email ?? null,
      name: name ?? null,
      metadata: JSON.stringify(mergeMetadata({}, meta)),
    });
    audit(ctx, projectId, actor, 'customer.created', { type: 'customer', id: customer.id }, {
      external_id: customer.external_id,
      email: customer.email,
    });
    return { customer, created: true };
  });
}

/** Used by usage and license APIs: find the customer by ID / external ID, creating it if needed. */
export function ensureCustomer(ctx: Ctx, projectId: string, idOrExternalId: string, actor: Actor): CustomerRow {
  const existing = getCustomer(ctx, projectId, idOrExternalId);
  if (existing) return existing;
  if (/^cust_[0-9a-z]{26}$/.test(idOrExternalId)) throw notFound(`Customer "${idOrExternalId}"`, 'customer_not_found');
  const externalId = validateExternalId(idOrExternalId, 'customer');
  const customer = insertCustomer(ctx, projectId, { external_id: externalId ?? null });
  audit(ctx, projectId, actor, 'customer.created', { type: 'customer', id: customer.id }, { external_id: externalId });
  return customer;
}

export function updateCustomer(ctx: Ctx, projectId: string, customerId: string, input: CustomerInput, actor: Actor): CustomerRow {
  const customer = getCustomerById(ctx, projectId, customerId);
  if (!customer) throw notFound('Customer', 'customer_not_found');
  const patch: Partial<CustomerRow> = {};
  if (input.externalId !== undefined) {
    const externalId = validateExternalId(input.externalId) ?? null;
    if (externalId && externalId !== customer.external_id) {
      const clash = ctx.db.get<CustomerRow>('SELECT id FROM customers WHERE project_id = ? AND external_id = ?', projectId, externalId);
      if (clash) throw badRequest('external_id_taken', `Another customer already has external ID "${externalId}".`, 'external_id');
    }
    patch.external_id = externalId;
  }
  if (input.email !== undefined) patch.email = validateEmail(input.email) ?? null;
  if (input.name !== undefined) patch.name = nullableStr(input.name, 'name', { max: 120 }) ?? null;
  if (input.metadata !== undefined) patch.metadata = JSON.stringify(mergeMetadata(customerMetadata(customer), metadata(input.metadata)));
  ctx.db.update('customers', { id: customer.id }, { ...patch, updated_at: ctx.now().toISOString() });
  audit(ctx, projectId, actor, 'customer.updated', { type: 'customer', id: customer.id }, patch);
  return { ...customer, ...patch };
}

export function listCustomers(
  ctx: Ctx,
  projectId: string,
  opts: { query?: string; email?: string; limit?: number; startingAfter?: string } = {},
): { data: CustomerRow[]; hasMore: boolean } {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const where = ['project_id = ?'];
  const params: string[] = [projectId];
  if (opts.query) {
    where.push('(external_id LIKE ? OR email LIKE ? OR name LIKE ? OR id = ? OR stripe_customer_id = ?)');
    const like = `%${opts.query.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, opts.query, opts.query);
  }
  if (opts.email) {
    where.push('email = ?');
    params.push(opts.email.toLowerCase());
  }
  if (opts.startingAfter) {
    where.push('id < ?');
    params.push(opts.startingAfter);
  }
  const rows = ctx.db.all<CustomerRow>(
    `SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit + 1}`,
    ...params,
  );
  return { data: rows.slice(0, limit), hasMore: rows.length > limit };
}

export function countCustomers(ctx: Ctx, projectId: string): number {
  return ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM customers WHERE project_id = ?', projectId)?.n ?? 0;
}

/** Track activity without writing on every request. */
export function touchCustomer(ctx: Ctx, customer: CustomerRow): void {
  const now = ctx.now();
  if (customer.last_seen_at && now.getTime() - Date.parse(customer.last_seen_at) < 3_600_000) return;
  ctx.db.update('customers', { id: customer.id }, { last_seen_at: now.toISOString() });
}

/**
 * Link a Stripe customer to a Keyvane customer. Stripe events can arrive in any order, so
 * this is called from every handler and must converge to the same result:
 *   - the customer with this Stripe ID and the customer with this external ID become one record;
 *   - missing email/name are filled in.
 */
export function linkStripeCustomer(
  ctx: Ctx,
  projectId: string,
  input: { stripeCustomerId: string | null; externalId?: string | null; email?: string | null; name?: string | null },
): CustomerRow | null {
  const { stripeCustomerId } = input;
  const externalId = input.externalId && EXTERNAL_ID_PATTERN.test(input.externalId) ? input.externalId : null;
  const email = input.email && EMAIL_PATTERN.test(input.email) ? input.email.toLowerCase() : null;
  const name = input.name ? input.name.slice(0, 120) : null;
  if (!stripeCustomerId && !externalId) return null;

  const byStripe = stripeCustomerId
    ? ctx.db.get<CustomerRow>('SELECT * FROM customers WHERE project_id = ? AND stripe_customer_id = ?', projectId, stripeCustomerId)
    : undefined;
  const byExternal = externalId
    ? ctx.db.get<CustomerRow>('SELECT * FROM customers WHERE project_id = ? AND external_id = ?', projectId, externalId)
    : undefined;

  let target: CustomerRow;
  if (byStripe && byExternal && byStripe.id !== byExternal.id) {
    // The same person was created twice (e.g. via the API and via a Stripe event): merge.
    target = mergeCustomers(ctx, byStripe, byExternal);
  } else if (byExternal) {
    target = byExternal;
  } else if (byStripe) {
    target = byStripe;
  } else {
    target = insertCustomer(ctx, projectId, {
      external_id: externalId,
      stripe_customer_id: stripeCustomerId,
      email,
      name,
    });
    audit(ctx, projectId, { type: 'stripe' }, 'customer.created', { type: 'customer', id: target.id }, {
      external_id: externalId,
      stripe_customer_id: stripeCustomerId,
    });
    return target;
  }

  const patch: Partial<CustomerRow> = {};
  if (stripeCustomerId && target.stripe_customer_id !== stripeCustomerId && !target.stripe_customer_id) {
    patch.stripe_customer_id = stripeCustomerId;
  }
  if (externalId && !target.external_id) patch.external_id = externalId;
  if (email && !target.email) patch.email = email;
  if (name && !target.name) patch.name = name;
  if (Object.keys(patch).length > 0) {
    ctx.db.update('customers', { id: target.id }, { ...patch, updated_at: ctx.now().toISOString() });
    target = { ...target, ...patch };
  }
  return target;
}

/** Move everything from `source` into `target` and delete `source`. Returns the updated target. */
export function mergeCustomers(ctx: Ctx, source: CustomerRow, target: CustomerRow): CustomerRow {
  const { db } = ctx;
  db.run('UPDATE licenses SET customer_id = ? WHERE customer_id = ?', target.id, source.id);
  db.run('UPDATE subscriptions SET customer_id = ? WHERE customer_id = ?', target.id, source.id);
  const counters = db.all<{ feature_id: string; period_key: string; used: number }>(
    'SELECT feature_id, period_key, used FROM usage_counters WHERE subject_id = ?',
    source.id,
  );
  const now = ctx.now().toISOString();
  for (const c of counters) {
    db.run(
      `INSERT INTO usage_counters (project_id, subject_id, feature_id, period_key, used, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (subject_id, feature_id, period_key) DO UPDATE SET used = used + excluded.used, updated_at = excluded.updated_at`,
      target.project_id,
      target.id,
      c.feature_id,
      c.period_key,
      c.used,
      now,
    );
  }
  db.run('DELETE FROM usage_counters WHERE subject_id = ?', source.id);
  db.run('UPDATE usage_events SET subject_id = ? WHERE subject_id = ?', target.id, source.id);
  db.run('UPDATE usage_events SET customer_id = ? WHERE customer_id = ?', target.id, source.id);
  db.run('UPDATE audit_logs SET target_id = ? WHERE target_id = ?', target.id, source.id);
  db.run('DELETE FROM customers WHERE id = ?', source.id);

  const patch: Partial<CustomerRow> = {
    stripe_customer_id: target.stripe_customer_id ?? source.stripe_customer_id,
    external_id: target.external_id ?? source.external_id,
    email: target.email ?? source.email,
    name: target.name ?? source.name,
    metadata: JSON.stringify({ ...customerMetadata(source), ...customerMetadata(target) }),
    updated_at: now,
  };
  db.update('customers', { id: target.id }, patch);
  audit(ctx, target.project_id, { type: 'system' }, 'customer.merged', { type: 'customer', id: target.id }, {
    merged_customer_id: source.id,
  });
  return { ...target, ...patch } as CustomerRow;
}

/**
 * Permanently delete a customer and their personal data: licenses (and device activations),
 * usage history and audit entries about them. Stripe subscription records are kept but
 * unlinked; if Stripe sends another event for them, a new customer record is created.
 */
export function deleteCustomer(ctx: Ctx, projectId: string, customerId: string, actor: Actor): void {
  const customer = getCustomerById(ctx, projectId, customerId);
  if (!customer) throw notFound('Customer', 'customer_not_found');
  ctx.db.transaction(() => {
    const licenseIds = ctx.db.all<{ id: string }>('SELECT id FROM licenses WHERE customer_id = ?', customer.id).map((r) => r.id);
    const subjects = [customer.id, ...licenseIds];
    const placeholders = subjects.map(() => '?').join(', ');
    ctx.db.run(`DELETE FROM usage_counters WHERE subject_id IN (${placeholders})`, ...subjects);
    ctx.db.run(`DELETE FROM usage_events WHERE subject_id IN (${placeholders}) OR customer_id = ?`, ...subjects, customer.id);
    ctx.db.run(`DELETE FROM audit_logs WHERE project_id = ? AND target_id IN (${placeholders})`, projectId, ...subjects);
    ctx.db.run('DELETE FROM licenses WHERE customer_id = ?', customer.id);
    ctx.db.run('UPDATE subscriptions SET customer_id = NULL WHERE customer_id = ?', customer.id);
    ctx.db.run('DELETE FROM customers WHERE id = ?', customer.id);
    audit(ctx, projectId, actor, 'customer.deleted', null, { licenses_deleted: licenseIds.length });
  });
}
