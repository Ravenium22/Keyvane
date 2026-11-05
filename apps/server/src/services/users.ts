import { DUMMY_PASSWORD_HASH, hashPassword, randomBase62, sha256Hex, verifyPassword } from '../lib/crypto.ts';
import { badRequest, conflict } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { addDays } from '../lib/time.ts';
import { EMAIL_PATTERN, str } from '../lib/validate.ts';
import type { Ctx, UserRow } from '../types.ts';

export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePassword(password: unknown, field = 'password'): string {
  const value = str(password, field, { required: true, trim: false, max: 200 });
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw badRequest('password_too_short', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, field);
  }
  return value;
}

export async function createUser(
  ctx: Ctx,
  input: { email: unknown; password: unknown; name?: unknown },
): Promise<UserRow> {
  const email = normalizeEmail(
    str(input.email, 'email', { required: true, max: 254, pattern: EMAIL_PATTERN, patternMessage: 'Enter a valid email address.' }),
  );
  const password = validatePassword(input.password);
  const name = str(input.name, 'name', { max: 100 }) ?? null;
  if (ctx.db.get('SELECT id FROM users WHERE email = ?', email)) {
    throw conflict('email_taken', 'An account with this email already exists. Try logging in instead.', 'email');
  }
  const now = ctx.now().toISOString();
  const user: UserRow = {
    id: newId('usr'),
    email,
    name,
    password_hash: await hashPassword(password),
    created_at: now,
    updated_at: now,
  };
  ctx.db.insert('users', { ...user });
  return user;
}

export async function authenticate(ctx: Ctx, email: string, password: string): Promise<UserRow | null> {
  const user = ctx.db.get<UserRow>('SELECT * FROM users WHERE email = ?', normalizeEmail(email));
  // Always run scrypt so response time does not reveal whether the email exists.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  return user && ok ? user : null;
}

export function getUser(ctx: Ctx, id: string): UserRow | null {
  return ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id) ?? null;
}

export function getUserByEmail(ctx: Ctx, email: string): UserRow | null {
  return ctx.db.get<UserRow>('SELECT * FROM users WHERE email = ?', normalizeEmail(email)) ?? null;
}

export function countUsers(ctx: Ctx): number {
  return ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
}

export function createSession(
  ctx: Ctx,
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): { token: string; expiresAt: Date } {
  const token = randomBase62(43);
  const now = ctx.now();
  const expiresAt = addDays(now, SESSION_DAYS);
  ctx.db.insert('sessions', {
    id: sha256Hex(token),
    user_id: userId,
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
    ip: meta.ip ?? null,
    user_agent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export function getUserBySession(ctx: Ctx, token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = ctx.db.get<UserRow & { session_expires_at: string }>(
    `SELECT users.*, sessions.expires_at AS session_expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?`,
    sha256Hex(token),
  );
  if (!row) return null;
  if (row.session_expires_at <= ctx.now().toISOString()) {
    deleteSession(ctx, token);
    return null;
  }
  const { session_expires_at: _ignored, ...user } = row;
  return user;
}

export function deleteSession(ctx: Ctx, token: string): void {
  ctx.db.run('DELETE FROM sessions WHERE id = ?', sha256Hex(token));
}

export function deleteSessionsForUser(ctx: Ctx, userId: string, exceptToken?: string): void {
  if (exceptToken) {
    ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, sha256Hex(exceptToken));
  } else {
    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }
}

export function updateProfile(ctx: Ctx, userId: string, input: { name?: unknown }): void {
  const name = str(input.name, 'name', { max: 100 }) ?? null;
  ctx.db.update('users', { id: userId }, { name, updated_at: ctx.now().toISOString() });
}

export async function changePassword(
  ctx: Ctx,
  userId: string,
  input: { current: unknown; next: unknown },
): Promise<void> {
  const user = getUser(ctx, userId);
  if (!user) throw badRequest('user_missing', 'User not found.');
  const current = str(input.current, 'current_password', { required: true, trim: false });
  if (!(await verifyPassword(current, user.password_hash))) {
    throw badRequest('invalid_password', 'Your current password is incorrect.', 'current_password');
  }
  const next = validatePassword(input.next, 'new_password');
  ctx.db.update('users', { id: userId }, { password_hash: await hashPassword(next), updated_at: ctx.now().toISOString() });
}

/** Administrative password reset (used by the `admin` CLI for self-hosted installs). */
export async function setPassword(ctx: Ctx, userId: string, password: string): Promise<void> {
  const value = validatePassword(password);
  ctx.db.update('users', { id: userId }, { password_hash: await hashPassword(value), updated_at: ctx.now().toISOString() });
  deleteSessionsForUser(ctx, userId);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export const RESET_TOKEN_MINUTES = 60;

/**
 * Creates a single-use reset token for the account with this email, if there is one.
 * Returns the token so the caller can email it; returns null for unknown emails, but
 * callers must show the same response either way (no account enumeration).
 */
export function createPasswordReset(ctx: Ctx, email: string): { token: string; user: UserRow } | null {
  const user = getUserByEmail(ctx, email);
  if (!user) return null;
  const token = randomBase62(43);
  const now = ctx.now();
  ctx.db.run('DELETE FROM password_resets WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < ?)', user.id, now.toISOString());
  ctx.db.insert('password_resets', {
    id: sha256Hex(token),
    user_id: user.id,
    expires_at: new Date(now.getTime() + RESET_TOKEN_MINUTES * 60_000).toISOString(),
    used_at: null,
    created_at: now.toISOString(),
  });
  return { token, user };
}

export function checkPasswordResetToken(ctx: Ctx, token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = ctx.db.get<{ user_id: string; expires_at: string; used_at: string | null }>(
    'SELECT user_id, expires_at, used_at FROM password_resets WHERE id = ?',
    sha256Hex(token),
  );
  if (!row || row.used_at || row.expires_at <= ctx.now().toISOString()) return null;
  return getUser(ctx, row.user_id);
}

/** Sets a new password with a reset token. Signs out every session of the account. */
export async function resetPasswordWithToken(ctx: Ctx, token: string, password: unknown): Promise<UserRow> {
  const user = checkPasswordResetToken(ctx, token);
  if (!user) throw badRequest('invalid_token', 'This reset link is invalid or has expired. Request a new one.');
  const value = validatePassword(password, 'password');
  const hash = await hashPassword(value);
  ctx.db.transaction(() => {
    ctx.db.update('users', { id: user.id }, { password_hash: hash, updated_at: ctx.now().toISOString() });
    ctx.db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', ctx.now().toISOString(), sha256Hex(token));
    deleteSessionsForUser(ctx, user.id);
  });
  return user;
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/** Deletes the account and every project it owns, with all of their data. */
export async function deleteAccount(ctx: Ctx, userId: string, password: unknown): Promise<void> {
  const user = getUser(ctx, userId);
  if (!user) throw badRequest('user_missing', 'User not found.');
  const value = str(password, 'password', { required: true, trim: false });
  if (!(await verifyPassword(value, user.password_hash))) {
    throw badRequest('invalid_password', 'Your password is incorrect.', 'password');
  }
  ctx.db.transaction(() => {
    const owned = ctx.db.all<{ id: string }>('SELECT id FROM projects WHERE owner_id = ?', userId);
    for (const project of owned) {
      ctx.db.run('DELETE FROM licenses WHERE project_id = ?', project.id);
      ctx.db.run('DELETE FROM projects WHERE id = ?', project.id);
    }
    ctx.db.run('DELETE FROM users WHERE id = ?', userId);
  });
}
