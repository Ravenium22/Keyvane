import { randomBytes } from 'node:crypto';

/**
 * Prefixed, time-sortable identifiers (ULID-style), e.g. `lic_01jc3k9x8w0v6q2m4n5p7r8s9t`.
 * Monotonic within the same millisecond, so ordering by id matches creation order.
 */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

let lastTime = -1;
let lastRandom: number[] = [];

function randomDigits(count: number): number[] {
  const bytes = randomBytes(count);
  return Array.from(bytes, (b) => b & 31);
}

function increment(digits: number[]): number[] {
  const next = digits.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    const d = next[i] ?? 0;
    if (d < 31) {
      next[i] = d + 1;
      return next;
    }
    next[i] = 0;
  }
  // Overflow (astronomically unlikely): fall back to fresh randomness.
  return randomDigits(digits.length);
}

export function ulid(now: number = Date.now()): string {
  if (now <= lastTime) {
    lastRandom = increment(lastRandom);
    now = lastTime;
  } else {
    lastTime = now;
    lastRandom = randomDigits(16);
  }
  let time = now;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  return timePart + lastRandom.map((d) => ALPHABET[d]).join('');
}

export type IdPrefix =
  | 'usr'
  | 'proj'
  | 'key'
  | 'prd'
  | 'pln'
  | 'ftr'
  | 'cust'
  | 'lsub'
  | 'lic'
  | 'actv'
  | 'use'
  | 'whe'
  | 'aud';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
