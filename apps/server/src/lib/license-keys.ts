import { randomInt } from 'node:crypto';

/**
 * License keys look like `KV-7K2QD-9XWMN-4RT8H-PZ3VB`:
 * 20 random Crockford base32 characters = 100 bits of entropy, grouped for readability.
 * The alphabet omits I, L, O and U so keys survive being read aloud or retyped.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 4;
const GROUP_SIZE = 5;
const PREFIX = 'KV';

export function generateLicenseKey(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = '';
    for (let i = 0; i < GROUP_SIZE; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return [PREFIX, ...groups].join('-');
}

/** Normalize user input: trims, uppercases, fixes ambiguous characters and dashes. */
export function normalizeLicenseKey(input: string): string {
  const compact = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith(PREFIX) && compact.length === PREFIX.length + GROUPS * GROUP_SIZE) {
    const body = compact
      .slice(PREFIX.length)
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1');
    const groups: string[] = [];
    for (let i = 0; i < GROUPS; i++) groups.push(body.slice(i * GROUP_SIZE, (i + 1) * GROUP_SIZE));
    return [PREFIX, ...groups].join('-');
  }
  return input.trim();
}

/** `KV-7K2QD-•••••-•••••-PZ3VB` for lists and logs. */
export function maskLicenseKey(key: string): string {
  const parts = key.split('-');
  if (parts.length < 4) return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
  return parts.map((p, i) => (i === 0 || i === 1 || i === parts.length - 1 ? p : '•••••')).join('-');
}
