import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie';
import { hmacSha256Hex } from '../lib/crypto.ts';
import { clientIp } from '../lib/request.ts';
import type { ProjectWithRole } from '../services/projects.ts';
import { createSession, deleteSession, getUserBySession, SESSION_DAYS } from '../services/users.ts';
import type { Actor, Ctx, UserRow } from '../types.ts';

export type FlashType = 'success' | 'error' | 'info';
export interface Flash {
  type: FlashType;
  message: string;
}

export type WebEnv = {
  Variables: {
    user: UserRow | null;
    sessionToken: string | null;
    project: ProjectWithRole;
    projects: ProjectWithRole[];
  };
};
export type WebContext = Context<WebEnv>;

export const SESSION_COOKIE = 'kv_session';
const FLASH_COOKIE = 'kv_flash';
export const LAST_PROJECT_COOKIE = 'kv_project';

const signingKeys = new Map<string, string>();
function cookieSecret(ctx: Ctx): string {
  let key = signingKeys.get(ctx.config.secret);
  if (!key) {
    key = hmacSha256Hex(ctx.config.secret, 'keyvane-cookie-signing');
    signingKeys.set(ctx.config.secret, key);
  }
  return key;
}

const secureCookies = (ctx: Ctx) => ctx.config.publicUrl.startsWith('https://');

export function sessionMiddleware(ctx: Ctx): MiddlewareHandler<WebEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE) ?? null;
    const user = token ? getUserBySession(ctx, token) : null;
    c.set('user', user);
    c.set('sessionToken', user ? token : null);
    await next();
  };
}

export function requireUser(): MiddlewareHandler<WebEnv> {
  return async (c, next) => {
    if (!c.get('user')) {
      const path = new URL(c.req.url).pathname + new URL(c.req.url).search;
      return c.redirect(`/login?next=${encodeURIComponent(path)}`, 303);
    }
    await next();
  };
}

export function startSession(ctx: Ctx, c: Context, user: UserRow): void {
  const { token } = createSession(ctx, user.id, { ip: clientIp(c, ctx.config), userAgent: c.req.header('user-agent') });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: secureCookies(ctx),
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export function endSession(ctx: Ctx, c: Context): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) deleteSession(ctx, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function setFlash(ctx: Ctx, c: Context, type: FlashType, message: string): Promise<void> {
  await setSignedCookie(c, FLASH_COOKIE, JSON.stringify({ type, message: message.slice(0, 500) }), cookieSecret(ctx), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: secureCookies(ctx),
    path: '/',
    maxAge: 60,
  });
}

/** Read and clear the flash message. Call it only when rendering a page. */
export async function consumeFlash(ctx: Ctx, c: Context): Promise<Flash | null> {
  const value = await getSignedCookie(c, cookieSecret(ctx), FLASH_COOKIE);
  if (value === undefined) return null;
  deleteCookie(c, FLASH_COOKIE, { path: '/' });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Flash;
    return parsed && typeof parsed.message === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberProject(ctx: Ctx, c: Context, projectId: string): void {
  setCookie(c, LAST_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: secureCookies(ctx),
    path: '/',
    maxAge: 365 * 86400,
  });
}

export function userActor(user: UserRow): Actor {
  return { type: 'user', id: user.id, label: user.email };
}

/** Only allow relative, same-site redirect targets. */
export function safeNext(next: string | undefined | null, fallback = '/app'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
