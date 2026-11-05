import { parseJson } from '../db/sqlite.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { generateLicenseKey, normalizeLicenseKey } from '../lib/license-keys.ts';
import { addDays } from '../lib/time.ts';
import { int, mergeMetadata, metadata, nullableStr, str, timestamp, type Metadata } from '../lib/validate.ts';
import type {
  ActivationRow,
  Actor,
  Ctx,
  CustomerRow,
  LicenseRow,
  LicenseSource,
  PlanRow,
  ProductRow,
  SubscriptionRow,
} from '../types.ts';
import { audit } from './audit.ts';
import { requirePlan, resolvePlan, resolveProduct } from './catalog.ts';
import { ensureCustomer, getCustomerById } from './customers.ts';

// ---------------------------------------------------------------------------
// License state: the single place that decides whether a license grants access.
// Computed on read from stored facts + the current time, so expirations, grace
// periods and period ends take effect without background jobs.
// ---------------------------------------------------------------------------

export type EffectiveStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'inactive'
  | 'suspended'
  | 'revoked';

export type ValidationCode =
  | 'valid'
  | 'not_found'
  | 'revoked'
  | 'suspended'
  | 'expired'
  | 'subscription_canceled'
  | 'payment_overdue'
  | 'subscription_inactive'
  | 'product_mismatch'
  | 'not_activated'
  | 'activation_limit_reached';

export interface LicenseState {
  valid: boolean;
  code: ValidationCode;
  status: EffectiveStatus;
  message: string;
  /** When access ends (or ended), if known: expiry, end of grace period or end of paid period. */
  accessUntil: string | null;
}

const date = (value: string) => value.slice(0, 10);

export function evaluateLicense(
  license: LicenseRow,
  product: Pick<ProductRow, 'cancellation_policy' | 'grace_period_days'>,
  subscription: SubscriptionRow | null,
  now: Date,
): LicenseState {
  const nowIso = now.toISOString();
  if (license.status === 'revoked') {
    return { valid: false, code: 'revoked', status: 'revoked', message: 'This license has been revoked.', accessUntil: license.status_changed_at };
  }
  if (license.status === 'suspended') {
    return { valid: false, code: 'suspended', status: 'suspended', message: 'This license is suspended.', accessUntil: license.status_changed_at };
  }
  if (license.expires_at && nowIso >= license.expires_at) {
    return { valid: false, code: 'expired', status: 'expired', message: `This license expired on ${date(license.expires_at)}.`, accessUntil: license.expires_at };
  }

  const ok = (status: EffectiveStatus, message: string, accessUntil: string | null): LicenseState => ({
    valid: true,
    code: 'valid',
    status,
    message,
    accessUntil: earliest(accessUntil, license.expires_at),
  });

  if (!subscription) return ok('active', 'License is active.', null);

  switch (subscription.status) {
    case 'active':
    case 'trialing': {
      const status: EffectiveStatus = subscription.status === 'trialing' ? 'trialing' : 'active';
      // Scheduled cancellation: if the end date passed but the final event never arrived, stop access anyway.
      const scheduledEnd = subscription.cancel_at ?? (subscription.cancel_at_period_end ? subscription.current_period_end : null);
      if (scheduledEnd && nowIso >= scheduledEnd) {
        return {
          valid: false,
          code: 'subscription_canceled',
          status: 'canceled',
          message: `The subscription ended on ${date(scheduledEnd)}.`,
          accessUntil: scheduledEnd,
        };
      }
      if (scheduledEnd) return ok(status, `Subscription is ${status} and will end on ${date(scheduledEnd)}.`, scheduledEnd);
      return ok(status, `Subscription is ${status}.`, null);
    }
    case 'past_due': {
      const since = subscription.past_due_since ?? subscription.updated_at;
      const graceEnd = addDays(new Date(since), product.grace_period_days).toISOString();
      if (product.grace_period_days > 0 && nowIso < graceEnd) {
        return ok('past_due', `Payment failed; access continues during the grace period until ${date(graceEnd)}.`, graceEnd);
      }
      return { valid: false, code: 'payment_overdue', status: 'past_due', message: 'Payment is overdue and the grace period has ended.', accessUntil: graceEnd };
    }
    case 'unpaid':
      return { valid: false, code: 'payment_overdue', status: 'past_due', message: 'The subscription is unpaid.', accessUntil: subscription.past_due_since };
    case 'canceled': {
      const endedAt = subscription.ended_at ?? subscription.canceled_at ?? subscription.updated_at;
      // `period_end` keeps paid-for access, but not for subscriptions that ended because payment failed.
      const accessUntil =
        product.cancellation_policy === 'period_end' && !subscription.past_due_since && subscription.current_period_end
          ? latest(subscription.current_period_end, endedAt)
          : endedAt;
      if (nowIso < accessUntil) return ok('canceled', `Subscription was canceled; access continues until ${date(accessUntil)}.`, accessUntil);
      return { valid: false, code: 'subscription_canceled', status: 'canceled', message: `The subscription was canceled on ${date(endedAt)}.`, accessUntil };
    }
    default:
      // incomplete, incomplete_expired, paused, or a status we do not know yet.
      return {
        valid: false,
        code: 'subscription_inactive',
        status: 'inactive',
        message: `The subscription is ${subscription.status.replace(/_/g, ' ')}.`,
        accessUntil: null,
      };
  }
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: string, b: string): string {
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface LicenseContext {
  license: LicenseRow;
  product: ProductRow;
  plan: PlanRow;
  customer: CustomerRow | null;
  subscription: SubscriptionRow | null;
  state: LicenseState;
  activations: number;
}

export function licenseMetadata(license: LicenseRow): Metadata {
  return parseJson<Metadata>(license.metadata, {});
}

export function getLicense(ctx: Ctx, projectId: string, id: string): LicenseRow | null {
  return ctx.db.get<LicenseRow>('SELECT * FROM licenses WHERE id = ? AND project_id = ?', id, projectId) ?? null;
}

export function requireLicense(ctx: Ctx, projectId: string, id: string): LicenseRow {
  const license = getLicense(ctx, projectId, id);
  if (!license) throw notFound('License', 'license_not_found');
  return license;
}

export function getLicenseByKey(ctx: Ctx, projectId: string, key: string): LicenseRow | null {
  return (
    ctx.db.get<LicenseRow>('SELECT * FROM licenses WHERE key = ? AND project_id = ?', normalizeLicenseKey(key), projectId) ?? null
  );
}

export function loadLicenseContext(ctx: Ctx, license: LicenseRow): LicenseContext {
  const product = ctx.db.get<ProductRow>('SELECT * FROM products WHERE id = ?', license.product_id);
  const plan = ctx.db.get<PlanRow>('SELECT * FROM plans WHERE id = ?', license.plan_id);
  if (!product || !plan) throw new Error(`License ${license.id} references a missing product or plan`);
  const customer = license.customer_id ? getCustomerById(ctx, license.project_id, license.customer_id) : null;
  const subscription = license.subscription_id
    ? (ctx.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', license.subscription_id) ?? null)
    : null;
  const activations = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activations WHERE license_id = ?', license.id)?.n ?? 0;
  return { license, product, plan, customer, subscription, state: evaluateLicense(license, product, subscription, ctx.now()), activations };
}

export interface CreateLicenseInput {
  product?: unknown;
  plan?: unknown;
  customer?: unknown;
  expiresAt?: unknown;
  /** Alternative to expiresAt: number of days from now. */
  durationDays?: unknown;
  maxActivations?: unknown;
  metadata?: unknown;
  note?: unknown;
}

export function createLicense(
  ctx: Ctx,
  projectId: string,
  input: CreateLicenseInput,
  source: Exclude<LicenseSource, 'stripe'>,
  actor: Actor,
): LicenseRow {
  const product = resolveProduct(ctx, projectId, str(input.product, 'product'));
  const plan = resolvePlan(ctx, product, str(input.plan, 'plan', { required: true }));
  const customerRef = str(input.customer, 'customer', { max: 200 });
  let expiresAt = timestamp(input.expiresAt, 'expires_at') ?? null;
  const durationDays = int(input.durationDays, 'duration_days', { min: 1, max: 36500 });
  if (!expiresAt && durationDays) expiresAt = addDays(ctx.now(), durationDays).toISOString();
  const maxActivations = int(input.maxActivations, 'max_activations', { min: 1, max: 100000 });
  const meta = mergeMetadata({}, metadata(input.metadata));
  const note = str(input.note, 'note', { max: 500 }) ?? null;

  return ctx.db.transaction(() => {
    const customer = customerRef ? ensureCustomer(ctx, projectId, customerRef, actor) : null;
    const license = insertLicense(ctx, {
      project_id: projectId,
      product_id: product.id,
      plan_id: plan.id,
      customer_id: customer?.id ?? null,
      subscription_id: null,
      source,
      expires_at: expiresAt,
      max_activations: maxActivations === undefined ? plan.max_activations : maxActivations,
      metadata: JSON.stringify(meta),
      note,
    });
    audit(ctx, projectId, actor, 'license.created', { type: 'license', id: license.id }, {
      product: product.key,
      plan: plan.key,
      customer: customer?.external_id ?? customer?.id ?? null,
      expires_at: expiresAt,
      source,
    });
    return license;
  });
}

/** Low-level insert with a freshly generated, unique key. */
export function insertLicense(
  ctx: Ctx,
  fields: Pick<
    LicenseRow,
    'project_id' | 'product_id' | 'plan_id' | 'customer_id' | 'subscription_id' | 'source' | 'expires_at' | 'max_activations'
  > & { metadata?: string; note?: string | null },
): LicenseRow {
  const now = ctx.now().toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateLicenseKey();
    if (ctx.db.get('SELECT 1 FROM licenses WHERE key = ?', key)) continue;
    const license: LicenseRow = {
      id: newId('lic'),
      key,
      status: 'active',
      metadata: fields.metadata ?? '{}',
      note: fields.note ?? null,
      status_reason: null,
      status_changed_at: null,
      last_validated_at: null,
      created_at: now,
      updated_at: now,
      ...fields,
    } as LicenseRow;
    ctx.db.insert('licenses', { ...license });
    return license;
  }
  throw new Error('Could not generate a unique license key');
}

export interface ListLicensesOptions {
  customerId?: string;
  productId?: string;
  planId?: string;
  status?: string;
  query?: string;
  limit?: number;
  startingAfter?: string;
}

export function listLicenses(ctx: Ctx, projectId: string, opts: ListLicensesOptions = {}): { data: LicenseRow[]; hasMore: boolean } {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const where = ['licenses.project_id = ?'];
  const params: string[] = [projectId];
  if (opts.customerId) {
    where.push('licenses.customer_id = ?');
    params.push(opts.customerId);
  }
  if (opts.productId) {
    where.push('licenses.product_id = ?');
    params.push(opts.productId);
  }
  if (opts.planId) {
    where.push('licenses.plan_id = ?');
    params.push(opts.planId);
  }
  if (opts.status === 'active' || opts.status === 'suspended' || opts.status === 'revoked') {
    where.push('licenses.status = ?');
    params.push(opts.status);
  }
  if (opts.query) {
    const q = opts.query.trim();
    where.push(
      '(licenses.key = ? OR licenses.id = ? OR customers.external_id LIKE ? OR customers.email LIKE ? OR licenses.note LIKE ?)',
    );
    const like = `%${q.replace(/[%_]/g, '')}%`;
    params.push(normalizeLicenseKey(q), q, like, like, like);
  }
  if (opts.startingAfter) {
    where.push('licenses.id < ?');
    params.push(opts.startingAfter);
  }
  const rows = ctx.db.all<LicenseRow>(
    `SELECT licenses.* FROM licenses LEFT JOIN customers ON customers.id = licenses.customer_id
     WHERE ${where.join(' AND ')} ORDER BY licenses.id DESC LIMIT ${limit + 1}`,
    ...params,
  );
  return { data: rows.slice(0, limit), hasMore: rows.length > limit };
}

export interface UpdateLicenseInput {
  plan?: unknown;
  expiresAt?: unknown;
  maxActivations?: unknown;
  metadata?: unknown;
  note?: unknown;
}

export function updateLicense(ctx: Ctx, projectId: string, licenseId: string, input: UpdateLicenseInput, actor: Actor): LicenseRow {
  const license = requireLicense(ctx, projectId, licenseId);
  const patch: Partial<LicenseRow> = {};
  if (input.plan !== undefined) {
    const product = ctx.db.get<ProductRow>('SELECT * FROM products WHERE id = ?', license.product_id);
    if (!product) throw notFound('Product');
    const plan = resolvePlan(ctx, product, str(input.plan, 'plan', { required: true }));
    if (license.source === 'stripe' && plan.id !== license.plan_id) {
      throw conflict(
        'managed_by_stripe',
        'This license is managed by a Stripe subscription. Change the subscription in Stripe instead; Keyvane will follow.',
        'plan',
      );
    }
    patch.plan_id = plan.id;
  }
  if (input.expiresAt !== undefined) patch.expires_at = timestamp(input.expiresAt, 'expires_at') ?? null;
  if (input.maxActivations !== undefined) {
    patch.max_activations = int(input.maxActivations, 'max_activations', { min: 1, max: 100000 }) ?? null;
  }
  if (input.metadata !== undefined) patch.metadata = JSON.stringify(mergeMetadata(licenseMetadata(license), metadata(input.metadata)));
  if (input.note !== undefined) patch.note = nullableStr(input.note, 'note', { max: 500 }) ?? null;
  if (Object.keys(patch).length === 0) return license;
  ctx.db.update('licenses', { id: license.id }, { ...patch, updated_at: ctx.now().toISOString() });
  const changes: Record<string, unknown> = { ...patch };
  if (patch.plan_id) changes.plan = requirePlan(ctx, projectId, patch.plan_id).key;
  delete changes.plan_id;
  audit(ctx, projectId, actor, 'license.updated', { type: 'license', id: license.id }, changes);
  return requireLicense(ctx, projectId, licenseId);
}

export type LicenseAction = 'suspend' | 'reinstate' | 'revoke';

/**
 * Suspend (reversible) or revoke (permanent) a license, or reinstate a suspended one.
 * These are admin decisions and always win over the subscription state.
 */
export function setLicenseStatus(
  ctx: Ctx,
  projectId: string,
  licenseId: string,
  action: LicenseAction,
  reason: string | null,
  actor: Actor,
): LicenseRow {
  const license = requireLicense(ctx, projectId, licenseId);
  if (license.status === 'revoked') {
    throw conflict('license_revoked', 'This license has been revoked. Revocation is permanent; create a new license instead.');
  }
  const status = action === 'suspend' ? 'suspended' : action === 'revoke' ? 'revoked' : 'active';
  if (action === 'reinstate' && license.status === 'active') return license;
  const now = ctx.now().toISOString();
  ctx.db.update(
    'licenses',
    { id: license.id },
    { status, status_reason: action === 'reinstate' ? null : (reason?.slice(0, 300) ?? null), status_changed_at: now, updated_at: now },
  );
  audit(ctx, projectId, actor, `license.${action === 'reinstate' ? 'reinstated' : action === 'suspend' ? 'suspended' : 'revoked'}`, {
    type: 'license',
    id: license.id,
  }, reason ? { reason } : {});
  return requireLicense(ctx, projectId, licenseId);
}

// ---------------------------------------------------------------------------
// Validation & device activations
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  code: ValidationCode;
  message: string;
  context: LicenseContext | null;
  activation: ActivationRow | null;
}

const FINGERPRINT_PATTERN = /^[\x21-\x7e]{1,200}$/;

function validateFingerprint(input: unknown, required: boolean): string | undefined {
  const value = str(input, 'fingerprint', {
    required,
    max: 200,
    pattern: FINGERPRINT_PATTERN,
    patternMessage: 'fingerprint must be 1-200 printable characters without spaces.',
  });
  return value;
}

function notFoundResult(): ValidationResult {
  return { valid: false, code: 'not_found', message: 'License key not found.', context: null, activation: null };
}

function invalid(context: LicenseContext, code: ValidationCode, message: string): ValidationResult {
  return { valid: false, code, message, context, activation: null };
}

function markValidated(ctx: Ctx, license: LicenseRow): void {
  const now = ctx.now();
  if (license.last_validated_at && now.getTime() - Date.parse(license.last_validated_at) < 60_000) return;
  ctx.db.update('licenses', { id: license.id }, { last_validated_at: now.toISOString() });
}

export function validateLicense(
  ctx: Ctx,
  projectId: string,
  input: { key?: unknown; fingerprint?: unknown; product?: unknown },
): ValidationResult {
  const key = str(input.key, 'key', { required: true, max: 200 });
  const fingerprint = validateFingerprint(input.fingerprint, false);
  const productRef = str(input.product, 'product');
  const license = getLicenseByKey(ctx, projectId, key);
  if (!license) return notFoundResult();
  const context = loadLicenseContext(ctx, license);
  if (productRef && productRef !== context.product.id && productRef !== context.product.key) {
    return invalid(context, 'product_mismatch', `This license is for "${context.product.name}", not "${productRef}".`);
  }
  markValidated(ctx, license);
  if (!context.state.valid) return invalid(context, context.state.code, context.state.message);
  let activation: ActivationRow | null = null;
  if (fingerprint) {
    activation =
      ctx.db.get<ActivationRow>('SELECT * FROM activations WHERE license_id = ? AND fingerprint = ?', license.id, fingerprint) ?? null;
    if (!activation) return invalid(context, 'not_activated', 'This device is not activated for this license.');
    touchActivation(ctx, activation);
  }
  return { valid: true, code: 'valid', message: context.state.message, context, activation };
}

function touchActivation(ctx: Ctx, activation: ActivationRow): void {
  const now = ctx.now();
  if (now.getTime() - Date.parse(activation.last_seen_at) < 60_000) return;
  ctx.db.update('activations', { id: activation.id }, { last_seen_at: now.toISOString() });
}

export function activateLicense(
  ctx: Ctx,
  projectId: string,
  input: { key?: unknown; fingerprint?: unknown; name?: unknown; product?: unknown },
  meta: { ip?: string | null },
  actor: Actor,
): ValidationResult {
  const key = str(input.key, 'key', { required: true, max: 200 });
  const fingerprint = validateFingerprint(input.fingerprint, true) as string;
  const name = str(input.name, 'name', { max: 100 }) ?? null;
  const productRef = str(input.product, 'product');
  return ctx.db.transaction(() => {
    const license = getLicenseByKey(ctx, projectId, key);
    if (!license) return notFoundResult();
    const context = loadLicenseContext(ctx, license);
    if (productRef && productRef !== context.product.id && productRef !== context.product.key) {
      return invalid(context, 'product_mismatch', `This license is for "${context.product.name}", not "${productRef}".`);
    }
    if (!context.state.valid) return invalid(context, context.state.code, context.state.message);
    const now = ctx.now().toISOString();
    const existing = ctx.db.get<ActivationRow>(
      'SELECT * FROM activations WHERE license_id = ? AND fingerprint = ?',
      license.id,
      fingerprint,
    );
    if (existing) {
      ctx.db.update('activations', { id: existing.id }, { last_seen_at: now, name: name ?? existing.name, ip: meta.ip ?? existing.ip });
      return { valid: true, code: 'valid', message: 'Device is already activated.', context, activation: { ...existing, last_seen_at: now } };
    }
    if (license.max_activations !== null && context.activations >= license.max_activations) {
      return invalid(
        context,
        'activation_limit_reached',
        `This license is already active on ${context.activations} of ${license.max_activations} allowed device${license.max_activations === 1 ? '' : 's'}. Deactivate one first.`,
      );
    }
    const activation: ActivationRow = {
      id: newId('actv'),
      project_id: projectId,
      license_id: license.id,
      fingerprint,
      name,
      ip: meta.ip ?? null,
      created_at: now,
      last_seen_at: now,
    };
    ctx.db.insert('activations', { ...activation });
    markValidated(ctx, license);
    audit(ctx, projectId, actor, 'license.activated', { type: 'license', id: license.id }, { fingerprint, name });
    return {
      valid: true,
      code: 'valid',
      message: 'Device activated.',
      context: { ...context, activations: context.activations + 1 },
      activation,
    };
  });
}

export function deactivateLicense(
  ctx: Ctx,
  projectId: string,
  input: { key?: unknown; fingerprint?: unknown },
  actor: Actor,
): { deactivated: boolean; license: LicenseRow | null } {
  const key = str(input.key, 'key', { required: true, max: 200 });
  const fingerprint = validateFingerprint(input.fingerprint, true) as string;
  const license = getLicenseByKey(ctx, projectId, key);
  if (!license) throw notFound('License key', 'license_not_found');
  const result = ctx.db.run('DELETE FROM activations WHERE license_id = ? AND fingerprint = ?', license.id, fingerprint);
  if (result.changes > 0) {
    audit(ctx, projectId, actor, 'license.deactivated', { type: 'license', id: license.id }, { fingerprint });
  }
  return { deactivated: result.changes > 0, license };
}

export function listActivations(ctx: Ctx, licenseId: string): ActivationRow[] {
  return ctx.db.all<ActivationRow>('SELECT * FROM activations WHERE license_id = ? ORDER BY created_at DESC', licenseId);
}

export function removeActivation(ctx: Ctx, projectId: string, activationId: string, actor: Actor): void {
  const activation = ctx.db.get<ActivationRow>('SELECT * FROM activations WHERE id = ? AND project_id = ?', activationId, projectId);
  if (!activation) throw notFound('Activation');
  ctx.db.run('DELETE FROM activations WHERE id = ?', activation.id);
  audit(ctx, projectId, actor, 'license.deactivated', { type: 'license', id: activation.license_id }, {
    fingerprint: activation.fingerprint,
    name: activation.name,
  });
}

export function countLicenses(ctx: Ctx, projectId: string): { total: number; active: number } {
  const row = ctx.db.get<{ total: number; active: number }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN licenses.status = 'active'
         AND (licenses.expires_at IS NULL OR licenses.expires_at > ?)
         AND (licenses.subscription_id IS NULL OR subscriptions.status IN ('active', 'trialing', 'past_due'))
         THEN 1 ELSE 0 END) AS active
     FROM licenses LEFT JOIN subscriptions ON subscriptions.id = licenses.subscription_id
     WHERE licenses.project_id = ?`,
    ctx.now().toISOString(),
    projectId,
  );
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}
