import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/db/migrations.ts';
import { Db } from '../src/db/sqlite.ts';
import { createDemoCatalog, type DemoCatalog } from '../src/dev/demo-catalog.ts';
import { eventEnvelope, subscriptionObject } from '../src/dev/stripe-fixtures.ts';
import { signStripePayload } from '../src/services/stripe/signature.ts';
import { createApiKey } from '../src/services/api-keys.ts';
import { createProject, setStripeWebhookSecret } from '../src/services/projects.ts';
import { createUser } from '../src/services/users.ts';
import type { Actor, Ctx, ProjectRow, UserRow } from '../src/types.ts';

export class TestClock {
  private t: number;
  constructor(iso = '2026-11-05T12:00:00.000Z') {
    this.t = Date.parse(iso);
  }
  now = (): Date => new Date(this.t);
  set(iso: string): void {
    this.t = Date.parse(iso);
  }
  advanceDays(days: number): void {
    this.t += days * 86_400_000;
  }
  advanceSeconds(seconds: number): void {
    this.t += seconds * 1000;
  }
  unix(): number {
    return Math.floor(this.t / 1000);
  }
}

export type TestCtx = Ctx & { clock: TestClock };

export function createTestCtx(): TestCtx {
  const clock = new TestClock();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    KEYVANE_SECRET: 'test-secret-0123456789-abcdefghijklmnop',
    KEYVANE_PUBLIC_URL: 'http://keyvane.test',
  });
  const db = new Db(':memory:');
  migrate(db);
  return { db, config, now: clock.now, clock };
}

export const systemActor: Actor = { type: 'system', label: 'test' };

export const WEBHOOK_SECRET = 'whsec_test_0123456789abcdef';

export interface Seeded extends DemoCatalog {
  user: UserRow;
  project: ProjectRow;
  secretKey: string;
  publishableKey: string;
}

let userCounter = 0;

export async function seed(ctx: TestCtx): Promise<Seeded> {
  const user = await createUser(ctx, { email: `dev${++userCounter}@example.com`, password: 'correct horse battery', name: 'Alex' });
  const actor: Actor = { type: 'user', id: user.id, label: user.email };
  const project = createProject(ctx, user.id, { name: 'Alex Labs' }, actor);
  const catalog = createDemoCatalog(ctx, project.id, actor);
  const secretKey = createApiKey(ctx, project.id, { type: 'secret', name: 'Test' }, actor).token;
  const publishableKey = createApiKey(ctx, project.id, { type: 'publishable', name: 'Test' }, actor).token;
  setStripeWebhookSecret(ctx, project.id, WEBHOOK_SECRET, actor);
  return { user, project, secretKey, publishableKey, ...catalog };
}

// ---------------------------------------------------------------------------
// Stripe payload builders (thin wrappers over src/dev/stripe-fixtures.ts)
// ---------------------------------------------------------------------------

let eventCounter = 0;

export function stripeEvent(ctx: TestCtx, type: string, object: Record<string, unknown>, overrides: { created?: number; id?: string } = {}) {
  return eventEnvelope(type, object, overrides.created ?? ctx.clock.unix(), overrides.id ?? `evt_test_${++eventCounter}`);
}

export interface SubscriptionOptions {
  id?: string;
  customer?: string;
  status?: string;
  price?: string;
  prices?: string[];
  periodStart?: number;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: number | null;
  endedAt?: number | null;
  metadata?: Record<string, string>;
  periodOnItems?: boolean;
}

export function stripeSubscription(ctx: TestCtx, opts: SubscriptionOptions = {}) {
  const start = opts.periodStart ?? ctx.clock.unix();
  const prices = opts.prices ?? [opts.price ?? 'price_demo_pro_monthly'];
  return subscriptionObject({
    id: opts.id ?? 'sub_test_1',
    customer: opts.customer ?? 'cus_test_1',
    status: opts.status ?? 'active',
    prices: prices.map((id) => ({ id, amount: id.includes('business') ? 3900 : 1200, interval: id.includes('yearly') ? 'year' : 'month' })),
    periodStart: start,
    periodEnd: opts.periodEnd ?? start + 30 * 86400,
    cancelAtPeriodEnd: opts.cancelAtPeriodEnd,
    canceledAt: opts.canceledAt,
    endedAt: opts.endedAt,
    metadata: opts.metadata,
    periodOnItems: opts.periodOnItems,
  });
}

export function signedRequest(ctx: TestCtx, event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  return { payload, signature: signStripePayload(payload, secret, ctx.clock.unix()) };
}
