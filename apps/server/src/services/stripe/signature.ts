import { hmacSha256Hex, safeEqual } from '../../lib/crypto.ts';

/**
 * Stripe webhook signature verification (no Stripe SDK needed).
 * Header format: `Stripe-Signature: t=1700000000,v1=<hex hmac>,v1=<hex hmac>`
 * Signed payload: `${t}.${rawBody}` with HMAC-SHA256 using the endpoint's `whsec_` secret.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureResult = { ok: true; timestamp: number } | { ok: false; reason: string };

export function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; now?: Date } = {},
): SignatureResult {
  if (!header) return { ok: false, reason: 'Missing Stripe-Signature header.' };
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) {
    return { ok: false, reason: 'Malformed Stripe-Signature header.' };
  }
  const expected = hmacSha256Hex(secret, `${timestamp}.${payload}`);
  if (!signatures.some((sig) => safeEqual(sig, expected))) {
    return {
      ok: false,
      reason: 'Signature mismatch. Make sure Keyvane has the signing secret of this exact webhook endpoint.',
    };
  }
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return { ok: false, reason: 'Signature timestamp is outside the tolerance window (possible replay).' };
  }
  return { ok: true, timestamp };
}

/** Build a valid Stripe-Signature header. Used by tests and the local event simulator. */
export function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${payload}`)}`;
}
