import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import type { Config } from '../config.ts';

/** Best-effort client IP. Honours X-Forwarded-For only when TRUST_PROXY is enabled. */
export function clientIp(c: Context, config: Config): string {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    const real = c.req.header('x-real-ip')?.trim();
    if (real) return real;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
