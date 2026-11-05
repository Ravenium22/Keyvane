import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { setupCloudBilling } from '../src/dev/cloud-billing-setup.ts';
import { accountPlan, assertWithinPlan } from '../src/services/cloud-billing.ts';
import { createLicense } from '../src/services/licenses.ts';
import { createUser } from '../src/services/users.ts';
import { createTestCtx, seed, systemActor, type TestCtx } from './helpers.ts';

async function cloud(ctx: TestCtx) {
  const operator = await createUser(ctx, { email: 'founder@keyvane.example', password: 'operator-password' });
  const { project } = setupCloudBilling(ctx, operator);
  ctx.config.billing.projectId = project.id;
  ctx.config.billing.upgradeLinks = { indie: 'https://buy.stripe.com/test_indie', startup: 'https://buy.stripe.com/test_startup' };
  return { operator, billingProject: project };
}

describe('Keyvane Cloud billing (dogfooding)', () => {
  it('shows each developer their plan, quotas and upgrade links', async () => {
    const ctx = createTestCtx();
    await cloud(ctx);
    const s = await seed(ctx); // a developer with one product
    const plan = accountPlan(ctx, s.user);
    assert.equal(plan?.plan?.key, 'developer');
    assert.deepEqual(plan?.limits, { products: 1, active_licenses: null });
    assert.equal(plan?.usage.products, 1);
    assert.deepEqual(plan?.upgrades.map((u) => u.key), ['indie', 'startup']);
    const url = new URL(plan?.upgrades[0]?.url ?? '');
    assert.equal(url.searchParams.get('client_reference_id'), s.user.id);
    assert.equal(url.searchParams.get('prefilled_email'), s.user.email);
  });

  it('enforces quotas only when enabled, and an upgrade lifts them', async () => {
    const ctx = createTestCtx();
    const { billingProject } = await cloud(ctx);
    const s = await seed(ctx);
    assertWithinPlan(ctx, s.user, 'products'); // not enforced by default
    ctx.config.billing.enforceLimits = true;
    assert.throws(() => assertWithinPlan(ctx, s.user, 'products'), /Developer plan includes 1 product/);
    // The developer buys Indie: a license on the billing project for their user ID.
    createLicense(ctx, billingProject.id, { plan: 'indie', customer: s.user.id }, 'api', systemActor);
    assertWithinPlan(ctx, s.user, 'products');
    assert.equal(accountPlan(ctx, s.user)?.upgrades.map((u) => u.key).join(), 'startup');
  });

  it('blocks product creation in the dashboard at the limit with an upgrade message', async () => {
    const ctx = createTestCtx();
    await cloud(ctx);
    ctx.config.billing.enforceLimits = true;
    const app = createApp(ctx);
    const origin = 'http://keyvane.test';
    const jar = new Map<string, string>();
    const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const store = (res: Response) => {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const [name, ...rest] = (pair ?? '').split('=');
        if (!name) continue;
        if (/max-age=0/i.test(c) || rest.join('=') === '') jar.delete(name);
        else jar.set(name, rest.join('='));
      }
    };
    const post = async (path: string, data: Record<string, string>) => {
      const res = await app.request(`${origin}${path}`, {
        method: 'POST',
        headers: { origin, cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
      });
      store(res);
      return res;
    };
    await post('/signup', { email: 'dev@example.com', password: 'dev-password-1' });
    const created = await post('/app/projects', { name: 'Mine', demo: '1' });
    const projectPath = created.headers.get('location') ?? '';
    const blocked = await post(`${projectPath}/products`, { name: 'Second product', template: 'tiers' });
    assert.equal(blocked.status, 303);
    const page = await app.request(`${origin}${blocked.headers.get('location')}`, { headers: { cookie: cookieHeader() } });
    assert.match(await page.text(), /Developer plan includes 1 product/);
  });
});

describe('operator admin page', () => {
  it('is only visible to configured admin emails', async () => {
    const ctx = createTestCtx();
    ctx.config.adminEmails = ['boss@example.com'];
    const app = createApp(ctx);
    const origin = 'http://keyvane.test';
    const signup = async (email: string) => {
      const res = await app.request(`${origin}/signup`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, password: 'some-password-1' }).toString(),
      });
      return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    };
    const boss = await signup('boss@example.com');
    const other = await signup('dev@example.com');
    const ok = await app.request(`${origin}/app/admin`, { headers: { cookie: boss } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Registered developers/);
    assert.equal((await app.request(`${origin}/app/admin`, { headers: { cookie: other } })).status, 404);
  });
});
