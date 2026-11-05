/**
 * Fixed-window, in-memory rate limiter. Keyvane runs as a single process (SQLite),
 * so in-memory state is exact. Swap for Redis if you ever run several instances.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  hit(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = this.now();
    if (this.windows.size > 50_000) this.sweep(now);
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count++;
    return {
      allowed: window.count <= this.limit,
      remaining: Math.max(0, this.limit - window.count),
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}
