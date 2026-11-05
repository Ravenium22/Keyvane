import { badRequest } from './errors.ts';

/**
 * Small, explicit input validators shared by the REST API and the dashboard forms.
 * Convention: `undefined` = not provided, `null` = explicitly cleared.
 */

type StrOpts = {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
  trim?: boolean;
};

export function str(input: unknown, field: string, opts: StrOpts & { required: true }): string;
export function str(input: unknown, field: string, opts?: StrOpts): string | undefined;
export function str(input: unknown, field: string, opts: StrOpts = {}): string | undefined {
  if (input === undefined || input === null || (typeof input === 'string' && input.trim() === '')) {
    if (opts.required) throw badRequest('parameter_missing', `${field} is required.`, field);
    return undefined;
  }
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw badRequest('parameter_invalid', `${field} must be a string.`, field);
  }
  let value = String(input);
  if (opts.trim !== false) value = value.trim();
  if (opts.min !== undefined && value.length < opts.min) {
    throw badRequest('parameter_invalid', `${field} must be at least ${opts.min} characters.`, field);
  }
  if (opts.max !== undefined && value.length > opts.max) {
    throw badRequest('parameter_invalid', `${field} must be at most ${opts.max} characters.`, field);
  }
  if (opts.pattern && !opts.pattern.test(value)) {
    throw badRequest('parameter_invalid', opts.patternMessage ?? `${field} has an invalid format.`, field);
  }
  return value;
}

/** Like str(), but an explicit empty string / null clears the value (returns null). */
export function nullableStr(input: unknown, field: string, opts: StrOpts = {}): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || (typeof input === 'string' && input.trim() === '')) return null;
  return str(input, field, opts) ?? null;
}

type IntOpts = { required?: boolean; min?: number; max?: number };

/** Parses integers from numbers or numeric strings. Empty string / null => null. */
export function int(input: unknown, field: string, opts: IntOpts = {}): number | null | undefined {
  if (input === undefined) {
    if (opts.required) throw badRequest('parameter_missing', `${field} is required.`, field);
    return undefined;
  }
  if (input === null || (typeof input === 'string' && input.trim() === '')) {
    if (opts.required) throw badRequest('parameter_missing', `${field} is required.`, field);
    return null;
  }
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isInteger(n)) throw badRequest('parameter_invalid', `${field} must be a whole number.`, field);
  if (opts.min !== undefined && n < opts.min) {
    throw badRequest('parameter_invalid', `${field} must be at least ${opts.min}.`, field);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw badRequest('parameter_invalid', `${field} must be at most ${opts.max}.`, field);
  }
  return n;
}

export function bool(input: unknown): boolean {
  return input === true || input === 'true' || input === 'on' || input === '1' || input === 1;
}

export function oneOf<T extends string>(
  input: unknown,
  field: string,
  values: readonly T[],
  opts: { required?: boolean } = {},
): T | undefined {
  const value = str(input, field, { required: opts.required });
  if (value === undefined) return undefined;
  if (!(values as readonly string[]).includes(value)) {
    throw badRequest('parameter_invalid', `${field} must be one of: ${values.join(', ')}.`, field);
  }
  return value as T;
}

/** Accepts ISO-8601 timestamps or YYYY-MM-DD dates (interpreted as end of that day, UTC). */
export function timestamp(input: unknown, field: string): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || (typeof input === 'string' && input.trim() === '')) return null;
  if (typeof input !== 'string') throw badRequest('parameter_invalid', `${field} must be an ISO-8601 date.`, field);
  const value = input.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest('parameter_invalid', `${field} must be an ISO-8601 date.`, field);
  }
  return date.toISOString();
}

export type Metadata = Record<string, string | number | boolean | null>;

export function metadata(input: unknown, field = 'metadata'): Metadata | undefined {
  if (input === undefined) return undefined;
  if (input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('parameter_invalid', `${field} must be an object.`, field);
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 50) throw badRequest('parameter_invalid', `${field} can have at most 50 keys.`, field);
  const out: Metadata = {};
  for (const [k, v] of entries) {
    if (k.length > 40) throw badRequest('parameter_invalid', `${field} keys must be at most 40 characters.`, field);
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') {
      if (v.length > 500) throw badRequest('parameter_invalid', `${field} values must be at most 500 characters.`, field);
      out[k] = v;
    } else throw badRequest('parameter_invalid', `${field} values must be strings, numbers, booleans or null.`, field);
  }
  return out;
}

export const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
export const KEY_MESSAGE = 'must start with a letter or number and contain only lowercase letters, numbers, ".", "_" or "-" (max 63).';

export function slugify(name: string, separator = '-'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')
    .slice(0, 63);
  return slug || 'item';
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Merge metadata like Stripe does: keys are added or replaced, and a `null` value removes the key. */
export function mergeMetadata(existing: Metadata, patch: Metadata | undefined): Metadata {
  const out: Metadata = { ...existing };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}
