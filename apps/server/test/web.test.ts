import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { DOC_PAGES, docPath } from '../src/web/docs.ts';
import { createTestCtx } from './helpers.ts';

const ORIGIN = 'http://keyvane.test';

/** A tiny browser: keeps cookies and sends same-origin form posts. */
function browser(app: ReturnType<typeof createApp>) {
  const jar = new Map<string, string>();
  const store = (res: Response) => {
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      const value = rest.join('=');
      if (!name) continue;
      if (/max-age=0/i.test(cookie) || value === '') jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
  };
  const headers = (extra: Record<string, string> = {}) => ({
    cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    ...extra,
  });
  return {
    jar,
    async get(path: string) {
      const res = await app.request(`${ORIGIN}${path}`, { headers: headers() });
      store(res);
      return { status: res.status, location: res.headers.get('location'), html: await res.text() };
    },
    async post(path: string, data: Record<string, string> = {}, opts: { origin?: string | null } = {}) {
      const extra: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
      if (opts.origin !== null) extra.origin = opts.origin ?? ORIGIN;
      const res = await app.request(`${ORIGIN}${path}`, { method: 'POST', headers: headers(extra), body: new URLSearchParams(data).toString() });
      store(res);
      return { status: res.status, location: res.headers.get('location'), html: await res.text() };
    },
    async follow(path: string, data?: Record<string, string>) {
      let res = data ? await this.post(path, data) : await this.get(path);
      for (let i = 0; i < 5 && res.status >= 300 && res.status < 400 && res.location; i++) {
        res = await this.get(res.location.replace(ORIGIN, ''));
      }
      return res;
    },
  };
}

async function signedUpBrowser() {
  const ctx = createTestCtx();
  const app = createApp(ctx);
  const b = browser(app);
  const signup = await b.post('/signup', { email: 'founder@example.com', password: 'super-secret-1', name: 'Founder' });
  assert.equal(signup.status, 303);
  assert.equal(signup.location, '/app/projects/new?welcome=1');
  const created = await b.post('/app/projects', { name: 'Acme', demo: '1' });
  assert.equal(created.status, 303);
  const projectPath = created.location as string;
  assert.match(projectPath, /^\/app\/p\/proj_/);
  return { ctx, app, b, projectPath };
}

describe('discovery files for search engines and agents', () => {
  it('serves robots.txt, sitemap, llms.txt, markdown docs, OpenAPI and the agent skill', async () => {
    const ctx = createTestCtx();
    const app = createApp(ctx);
    const get = async (path: string) => {
      const res = await app.request(`${ORIGIN}${path}`);
      return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
    };
    const robots = await get('/robots.txt');
    assert.match(robots.body, /User-agent: \*\nAllow: \//);
    assert.match(robots.body, /Sitemap: http:\/\/keyvane\.test\/sitemap\.xml/);
    const sitemap = await get('/sitemap.xml');
    assert.match(sitemap.body, /<loc>http:\/\/keyvane\.test\/docs\/stripe<\/loc>/);
    assert.match(sitemap.body, /<loc>http:\/\/keyvane\.test\/pricing<\/loc>/);
    const llms = await get('/llms.txt');
    assert.match(llms.body, /^# Keyvane/);
    assert.match(llms.body, /\(http:\/\/keyvane\.test\/docs\/getting-started\.md\)/);
    const md = await get('/docs/getting-started.md');
    assert.match(md.type, /text\/markdown/);
    assert.match(md.body, /^# Quickstart/);
    const full = await get('/llms-full.txt');
    assert.ok(full.body.length > 20000);
    const spec = JSON.parse((await get('/openapi.json')).body) as { openapi: string; paths: Record<string, unknown> };
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/entitlements'] && spec.paths['/licenses/validate']);
    assert.match((await get('/SKILL.md')).body, /name: keyvane/);
    assert.match((await get('/.well-known/security.txt')).body, /Contact: https:\/\/github\.com/);
    assert.equal((await get('/docs/does-not-exist.md')).status, 404);
  });

  it('renders every docs page, its Markdown mirror and its llms.txt entry', async () => {
    const app = createApp(createTestCtx());
    const llms = await (await app.request(`${ORIGIN}/llms.txt`)).text();
    for (const page of DOC_PAGES) {
      const path = docPath(page);
      const html = await app.request(`${ORIGIN}${path}`);
      assert.equal(html.status, 200, path);
      assert.match(await html.text(), new RegExp(`<h1[^>]*>`), path);
      assert.equal((await app.request(`${ORIGIN}${path}.md`)).status, 200, `${path}.md`);
      assert.ok(llms.includes(`${ORIGIN}${path}.md`), `llms.txt lists ${path}`);
    }
    assert.ok(DOC_PAGES.some((p) => p.slug === 'python'));
  });

  it('adds canonical URLs, social cards and structured data to public pages', async () => {
    const ctx = createTestCtx();
    const b = browser(createApp(ctx));
    const home = await b.get('/');
    assert.match(home.html, /<link rel="canonical" href="http:\/\/keyvane\.test\/">/);
    assert.match(home.html, /<meta property="og:image" content="http:\/\/keyvane\.test\/assets\/brand\/og-default\.png\?v=/);
    assert.match(home.html, /"@type":"SoftwareApplication"/);
    assert.match(home.html, /"@type":"FAQPage"/);
    const docs = await b.get('/docs/stripe');
    assert.match(docs.html, /"@type":"TechArticle"/);
    assert.match(docs.html, /<link rel="alternate" type="text\/markdown" href="\/docs\/stripe\.md">/);
    for (const path of ['/pricing', '/changelog', '/compare/build-vs-buy', '/docs/nextjs', '/docs/express', '/docs/electron', '/docs/stripe-webhook-edge-cases', '/docs/agents']) {
      assert.equal((await b.get(path)).status, 200, path);
    }
    const login = await b.get('/login');
    assert.match(login.html, /<meta name="robots" content="noindex">/);
  });
});

describe('canonical host', () => {
  it('redirects the www host to the public URL with a 301', async () => {
    const app = createApp(createTestCtx());
    const res = await app.request('http://www.keyvane.test/pricing?x=1', { headers: { host: 'www.keyvane.test' } });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), 'http://keyvane.test/pricing?x=1');
    const same = await app.request('http://keyvane.test/pricing', { headers: { host: 'keyvane.test' } });
    assert.equal(same.status, 200);
  });
});

describe('legal pages', () => {
  it('are published only when a legal entity is configured', async () => {
    const off = createTestCtx();
    assert.equal((await createApp(off).request(`${ORIGIN}/legal/privacy`)).status, 404);
    const on = createTestCtx();
    on.config.legalEntity = 'Keyvane Inc.';
    on.config.contactEmail = 'privacy@example.com';
    const res = await createApp(on).request(`${ORIGIN}/legal/privacy`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Keyvane Inc\./);
    assert.doesNotMatch(body, /\{\{entity\}\}/);
    assert.match(await (await createApp(on).request(`${ORIGIN}/legal/terms`)).text(), /laws of the State of Delaware/);
  });
});

describe('marketing site', () => {
  it('renders the landing page with pricing and positioning', async () => {
    const ctx = createTestCtx();
    const b = browser(createApp(ctx));
    const home = await b.get('/');
    assert.equal(home.status, 200);
    assert.match(home.html, /Sell your software\. Let <em>Keyvane<\/em> handle access\./);
    assert.match(home.html, /not a payment processor/);
    for (const tier of ['Developer', 'Indie', 'Startup', 'Business']) assert.match(home.html, new RegExp(tier));
    assert.match(home.html, /\$19/);
  });

  it('sends security headers on pages', async () => {
    const ctx = createTestCtx();
    const res = await createApp(ctx).request(`${ORIGIN}/`);
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('authentication', () => {
  it('signs up, logs out and logs back in', async () => {
    const { b } = await signedUpBrowser();
    assert.equal((await b.post('/logout')).location, '/');
    const blocked = await b.get('/app');
    assert.equal(blocked.status, 303);
    assert.match(blocked.location ?? '', /^\/login\?next=/);
    const wrong = await b.follow('/login', { email: 'founder@example.com', password: 'nope-nope' });
    assert.match(wrong.html, /Incorrect email or password/);
    const ok = await b.post('/login', { email: 'FOUNDER@example.com', password: 'super-secret-1', next: '/app/account' });
    assert.equal(ok.location, '/app/account');
  });

  it('refuses open redirects and duplicate accounts', async () => {
    const { b } = await signedUpBrowser();
    await b.post('/logout');
    const res = await b.post('/login', { email: 'founder@example.com', password: 'super-secret-1', next: '//evil.example' });
    assert.equal(res.location, '/app');
    await b.post('/logout');
    const dup = await b.follow('/signup', { email: 'founder@example.com', password: 'another-password' });
    assert.match(dup.html, /already exists/);
  });

  it('ignores sign-ups that fill the honeypot field', async () => {
    const ctx = createTestCtx();
    const b = browser(createApp(ctx));
    const res = await b.post('/signup', { email: 'bot@example.com', password: 'bot-password-1', website: 'http://spam.example' });
    assert.equal(res.location, '/signup');
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n, 0);
  });

  it('blocks cross-site form posts (CSRF)', async () => {
    const { b, projectPath } = await signedUpBrowser();
    const evil = await b.post(`${projectPath}/settings`, { name: 'Hacked' }, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const noOrigin = await b.post(`${projectPath}/settings`, { name: 'Hacked' }, { origin: null });
    assert.equal(noOrigin.status, 403);
    const page = await b.get(`${projectPath}/settings`);
    assert.doesNotMatch(page.html, /Hacked/);
  });
});

describe('dashboard', () => {
  it('renders every page for a project with the example product', async () => {
    const { b, projectPath } = await signedUpBrowser();
    const overview = await b.get(projectPath);
    assert.equal(overview.status, 200);
    assert.match(overview.html, /Get started/);
    assert.match(overview.html, /\/v1\/webhooks\/stripe\/proj_/);
    for (const page of ['/products', '/customers', '/licenses', '/stripe', '/api-keys', '/activity', '/settings']) {
      const res = await b.get(`${projectPath}${page}`);
      assert.equal(res.status, 200, `${page} should render`);
    }
    const products = await b.get(`${projectPath}/products`);
    const productPath = /href="(\/app\/p\/[^"]+\/products\/prd_[^"]+)"/.exec(products.html)?.[1];
    assert.ok(productPath);
    const product = await b.get(productPath);
    assert.match(product.html, /AI PDF Analyzer/);
    assert.match(product.html, /What each plan unlocks/);
    assert.equal((await b.get('/app/account')).status, 200);
  });

  it('creates a product from the tier template, adds a feature and saves the matrix', async () => {
    const { ctx, b, projectPath } = await signedUpBrowser();
    const created = await b.post(`${projectPath}/products`, { name: 'Invoice Bot', template: 'tiers' });
    const productPath = created.location as string;
    const feature = await b.post(`${productPath}/features`, { name: 'Invoices', type: 'metered', reset_period: 'month', unit: 'invoices' });
    assert.equal(feature.location, productPath);
    const plans = ctx.db.all<{ id: string; key: string }>("SELECT plans.id, plans.key FROM plans JOIN products ON products.id = plans.product_id WHERE products.key = 'invoice-bot' ORDER BY rank");
    const featureRow = ctx.db.get<{ id: string }>("SELECT id FROM features WHERE key = 'invoices'");
    assert.equal(plans.length, 3);
    const [free, pro] = plans;
    const saved = await b.follow(`${productPath}/entitlements`, {
      [`on__${free?.id}__${featureRow?.id}`]: 'on',
      [`limit__${free?.id}__${featureRow?.id}`]: '5',
      [`on__${pro?.id}__${featureRow?.id}`]: 'on',
      [`limit__${pro?.id}__${featureRow?.id}`]: '',
    });
    assert.match(saved.html, /Entitlements saved/);
    const cells = ctx.db.all<{ plan_id: string; enabled: number; limit_value: number | null }>('SELECT plan_id, enabled, limit_value FROM plan_features WHERE feature_id = ?', featureRow?.id ?? '');
    assert.deepEqual(
      cells.map((c) => ({ ...c })).sort((a, b) => a.plan_id.localeCompare(b.plan_id)),
      [
        { plan_id: free?.id, enabled: 1, limit_value: 5 },
        { plan_id: pro?.id, enabled: 1, limit_value: null },
        { plan_id: plans[2]?.id, enabled: 0, limit_value: null },
      ].sort((a, b) => String(a.plan_id).localeCompare(String(b.plan_id))),
    );
    const bad = await b.follow(`${productPath}/plans`, { name: 'Pro 2', stripe_price_ids: 'price with spaces!' });
    assert.match(bad.html, /not a valid Stripe price ID/);
  });

  it('issues a license, shows the key and runs a test validation', async () => {
    const { ctx, b, projectPath } = await signedUpBrowser();
    const pro = ctx.db.get<{ id: string }>("SELECT id FROM plans WHERE key = 'pro'");
    const created = await b.post(`${projectPath}/licenses`, { plan_id: pro?.id ?? '', customer: 'user_77', duration_days: '30', note: 'Beta' });
    const licensePath = created.location as string;
    assert.match(licensePath, /\/licenses\/lic_/);
    const page = await b.get(licensePath);
    const key = /<code>(KV-[A-Z0-9-]+)<\/code>/.exec(page.html)?.[1];
    assert.ok(key, 'key is displayed');
    const tested = await b.post(`${licensePath}/test`);
    assert.equal(tested.status, 200);
    assert.match(tested.html, /&quot;valid&quot;: true/);
    const suspended = await b.follow(`${licensePath}/status`, { action: 'suspend' });
    assert.match(suspended.html, /License suspended/);
    const customers = await b.get(`${projectPath}/customers`);
    assert.match(customers.html, /user_77/);
  });

  it('shows a new secret key exactly once and connects Stripe', async () => {
    const { b, projectPath } = await signedUpBrowser();
    const created = await b.post(`${projectPath}/api-keys`, { name: 'Server', type: 'secret' });
    assert.equal(created.status, 200);
    const token = /(kv_sk_[A-Za-z0-9]{32})/.exec(created.html)?.[1];
    assert.ok(token);
    const later = await b.get(`${projectPath}/api-keys`);
    assert.doesNotMatch(later.html, new RegExp(token));
    const wrong = await b.follow(`${projectPath}/stripe`, { webhook_secret: 'sk_live_oops' });
    assert.match(wrong.html, /starts with &quot;whsec_&quot;/);
    const ok = await b.follow(`${projectPath}/stripe`, { webhook_secret: 'whsec_abcdefghijklmnop' });
    assert.match(ok.html, /signing secret saved/);
    assert.match(ok.html, /Waiting for the first event/);
  });

  it('does not let users open other people’s projects', async () => {
    const first = await signedUpBrowser();
    const intruder = browser(first.app);
    await intruder.post('/signup', { email: 'intruder@example.com', password: 'super-secret-2' });
    const res = await intruder.get(first.projectPath);
    assert.equal(res.status, 404);
    const post = await intruder.post(`${first.projectPath}/settings`, { name: 'Mine now' });
    assert.equal(post.status, 404);
  });

  it('deletes a project only after typing its name', async () => {
    const { ctx, b, projectPath } = await signedUpBrowser();
    const nope = await b.follow(`${projectPath}/delete`, { confirm: 'wrong' });
    assert.match(nope.html, /does not match/);
    const ok = await b.post(`${projectPath}/delete`, { confirm: 'Acme' });
    assert.equal(ok.location, '/app');
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM projects')?.n, 0);
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses')?.n, 0);
  });
});

describe('account recovery and data rights', () => {
  it('resets a password with a single-use emailed link', async () => {
    const { testOutbox } = await import('../src/services/mailer.ts');
    const { b } = await signedUpBrowser();
    await b.post('/logout');
    testOutbox.length = 0;
    const unknown = await b.follow('/forgot-password', { email: 'nobody@example.com' });
    assert.match(unknown.html, /If an account exists/);
    assert.equal(testOutbox.length, 0, 'no email for unknown accounts');

    await b.post('/forgot-password', { email: 'founder@example.com' });
    assert.equal(testOutbox.length, 1);
    const link = /https?:\/\/\S+\/reset-password\?token=([A-Za-z0-9]+)/.exec(testOutbox[0]?.text ?? '');
    assert.ok(link, 'email contains a reset link');
    const token = link[1] as string;
    assert.match((await b.get(`/reset-password?token=${token}`)).html, /Choose a new password/);
    const done = await b.post('/reset-password', { token, password: 'brand-new-password' });
    assert.equal(done.location, '/app');
    // The link works only once, and the new password works.
    assert.match((await b.get(`/reset-password?token=${token}`)).html, /This link has expired/);
    await b.post('/logout');
    assert.equal((await b.post('/login', { email: 'founder@example.com', password: 'brand-new-password' })).location, '/app');
  });

  it('exports customers and licenses as CSV', async () => {
    const { ctx, b, projectPath } = await signedUpBrowser();
    const pro = ctx.db.get<{ id: string }>("SELECT id FROM plans WHERE key = 'pro'");
    await b.post(`${projectPath}/customers`, { external_id: 'user_csv', name: '=HYPERLINK("http://evil")' });
    await b.post(`${projectPath}/licenses`, { plan_id: pro?.id ?? '', customer: 'user_csv', note: 'Beta, tester' });
    const customers = await b.get(`${projectPath}/customers.csv`);
    assert.equal(customers.status, 200);
    assert.match(customers.html, /^id,external_id,email/);
    assert.match(customers.html, /user_csv/);
    assert.match(customers.html, /"'=HYPERLINK\(""http:\/\/evil""\)"/, 'formula injection is neutralized');
    const licenses = await b.get(`${projectPath}/licenses.csv`);
    assert.match(licenses.html, /"Beta, tester"/);
  });

  it('deletes a customer with their data', async () => {
    const { ctx, b, projectPath } = await signedUpBrowser();
    const pro = ctx.db.get<{ id: string }>("SELECT id FROM plans WHERE key = 'pro'");
    await b.post(`${projectPath}/licenses`, { plan_id: pro?.id ?? '', customer: 'user_gone' });
    const customer = ctx.db.get<{ id: string }>("SELECT id FROM customers WHERE external_id = 'user_gone'");
    const res = await b.post(`${projectPath}/customers/${customer?.id}/delete`);
    assert.equal(res.status, 303);
    assert.equal(ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM customers WHERE external_id = 'user_gone'")?.n, 0);
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM licenses')?.n, 0);
  });

  it('deletes the account and owned projects after confirming the password', async () => {
    const { ctx, b } = await signedUpBrowser();
    const wrong = await b.follow('/app/account/delete', { password: 'not-my-password' });
    assert.match(wrong.html, /incorrect/);
    const ok = await b.post('/app/account/delete', { password: 'super-secret-1' });
    assert.equal(ok.location, '/');
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n, 0);
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM projects')?.n, 0);
  });
});
