export type ResetPeriod = 'day' | 'month' | 'year' | 'never';

export const RESET_PERIODS: readonly ResetPeriod[] = ['day', 'month', 'year', 'never'];

export function iso(date: Date): string {
  return date.toISOString();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The usage bucket a moment falls into, in UTC. */
export function periodKey(period: ResetPeriod, now: Date): string {
  const s = now.toISOString();
  switch (period) {
    case 'day':
      return s.slice(0, 10);
    case 'month':
      return s.slice(0, 7);
    case 'year':
      return s.slice(0, 4);
    case 'never':
      return 'all';
  }
}

/** When the current usage bucket resets (UTC), or null for lifetime limits. */
export function periodResetsAt(period: ResetPeriod, now: Date): Date | null {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  switch (period) {
    case 'day':
      return new Date(Date.UTC(y, m, d + 1));
    case 'month':
      return new Date(Date.UTC(y, m + 1, 1));
    case 'year':
      return new Date(Date.UTC(y + 1, 0, 1));
    case 'never':
      return null;
  }
}

/** Convert a unix timestamp (seconds) from a provider payload to ISO, tolerating null/undefined. */
export function fromUnix(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}
