/**
 * AI PDF Analyzer — the example product from the Keyvane plan.
 *
 *   Free      10 analyses / month
 *   Pro       500 analyses / month + Export to Markdown
 *   Business  3,000 analyses / month + Export + Priority processing
 *
 * Every Keyvane integration point is marked with "Keyvane:". Everything else is a
 * normal web app. Run `npm run seed:demo` in the repo root first to get API keys.
 */
import { createHash, randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { Entitlements, Keyvane, KeyvaneError } from '@keyvane/sdk';
import { analyzePdf, samplePdf, type Analysis } from './analyze.ts';

const PRODUCT = process.env.KEYVANE_PRODUCT ?? 'pdf-analyzer';
const PAYMENT_LINKS: Record<string, string | undefined> = {
  pro: process.env.STRIPE_PAYMENT_LINK_PRO,
  business: process.env.STRIPE_PAYMENT_LINK_BUSINESS,
};

// Keyvane: one client for the whole app. Reads KEYVANE_URL and KEYVANE_SECRET_KEY.
// A short cache keeps page loads fast; recording usage invalidates it automatically.
const keyvane = new Keyvane({ cacheTtlMs: 5_000 });

interface StoredAnalysis extends Analysis {
  id: string;
  file: string;
  createdAt: Date;
  priority: boolean;
}
const results = new Map<string, StoredAnalysis[]>(); // in-memory "database" of past analyses per user

const app = new Hono();

const userOf = (c: Context) => getCookie(c, 'pdf_user') ?? null;
const customerId = (user: string) => `user_${user}`; // your own user ID — Keyvane never needs its own IDs

/**
 * Keyvane: what may this user do right now? If Keyvane is unreachable we "fail closed"
 * for paid features: the app keeps working on the free tier. (Choose what fits your product.)
 */
async function loadAccess(user: string): Promise<{ access: Entitlements | null; error: string | null }> {
  try {
    return { access: await keyvane.entitlements.get({ customer: customerId(user), product: PRODUCT }), error: null };
  } catch (err) {
    const message = err instanceof KeyvaneError ? err.message : String(err);
    return { access: null, error: `Could not reach Keyvane (${message}). Paid features are disabled until it is back.` };
  }
}

function upgradeUrl(plan: string, user: string): string | null {
  const link = PAYMENT_LINKS[plan];
  // Keyvane: client_reference_id tells Keyvane which of *your* users paid.
  return link ? `${link}?client_reference_id=${encodeURIComponent(customerId(user))}` : null;
}

const layout = (body: unknown, flash?: string | null) => html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI PDF Analyzer</title>
<style>
  :root { color-scheme: light dark; --b:#e4e4ee; --m:#666680; --p:#5a4bf4; }
  body { font: 15px/1.55 system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 32px 20px; }
  header { display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; margin-bottom: 24px; }
  h1 { margin: 0; font-size: 1.5rem; } .muted { color: var(--m); } .small { font-size: .85rem; }
  .card { border: 1px solid var(--b); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
  .row { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }
  .badge { display:inline-block; padding: 2px 10px; border-radius: 99px; background: #eeecff; color: #3f30c9; font-weight: 600; font-size: .8rem; }
  .meter { height: 10px; background: #eee; border-radius: 99px; overflow: hidden; margin: 8px 0; } .meter span { display:block; height:100%; background: var(--p); }
  button, .btn { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--p); background: var(--p); color: #fff; cursor: pointer; text-decoration: none; display:inline-block; }
  .btn.secondary, button.secondary { background: transparent; color: var(--p); }
  .locked { opacity: .55; cursor: not-allowed; }
  .flash { padding: 10px 14px; border-radius: 10px; background: #fff4dc; color: #7a4f00; margin-bottom: 16px; }
  .error { background: #fdeaea; color: #a32020; }
  pre { background: #12121f; color: #e6e6f2; padding: 14px; border-radius: 10px; overflow: auto; font-size: 12px; }
  input[type=text] { font: inherit; padding: 8px 10px; border: 1px solid var(--b); border-radius: 8px; }
</style></head>
<body>${flash ? html`<div class="flash">${flash}</div>` : ''}${body}
<p class="small muted" style="margin-top:32px">Example app · monetized with <a href="https://github.com/Ravenium22/keyvane">Keyvane</a></p>
</body></html>`;

const takeFlash = (c: Context) => {
  const message = getCookie(c, 'pdf_flash');
  if (message) deleteCookie(c, 'pdf_flash');
  return message ? decodeURIComponent(message) : null;
};
const redirectWith = (c: Context, message: string, to = '/') => {
  setCookie(c, 'pdf_flash', encodeURIComponent(message), { path: '/', maxAge: 30 });
  return c.redirect(to, 303);
};

app.get('/', async (c) => {
  const user = userOf(c);
  const flash = takeFlash(c);
  if (!user) {
    return c.html(
      layout(
        html`<header><h1>AI PDF Analyzer</h1></header>
        <div class="card"><h2>Sign in</h2>
          <p class="muted">Pick any username. This demo has no passwords. Each username is a separate customer in Keyvane.</p>
          <form method="post" action="/login" class="row"><input type="text" name="user" placeholder="alex" required pattern="[a-z0-9_-]{2,30}"><button>Continue</button></form>
        </div>`,
        flash,
      ),
    );
  }

  const { access, error } = await loadAccess(user);
  const analyses = access?.feature('pdf_analysis');
  const metered = analyses?.type === 'metered' ? analyses : null;
  const plan = access?.plan;
  const canExport = access?.can('export') ?? false;
  const history = results.get(user) ?? [];

  return c.html(
    layout(
      html`<header>
        <h1>AI PDF Analyzer</h1>
        <div class="row">
          <span>Signed in as <strong>${user}</strong></span>
          <span class="badge">${plan?.name ?? 'No plan'}</span>
          ${access?.can('priority_processing') ? html`<span class="badge">⚡ Priority</span>` : ''}
          <form method="post" action="/logout"><button class="secondary">Sign out</button></form>
        </div>
      </header>
      ${error ? html`<div class="flash error">${error}</div>` : ''}

      <div class="card">
        <h2 style="margin-top:0">Analyze a PDF</h2>
        ${metered
          ? html`<div class="small muted">${metered.used} of ${metered.limit ?? '∞'} analyses used this month${metered.resets_at ? html` · resets ${metered.resets_at.slice(0, 10)}` : ''}</div>
              ${metered.limit ? html`<div class="meter"><span style="width:${Math.min(100, Math.round((metered.used / metered.limit) * 100))}%"></span></div>` : ''}`
          : ''}
        <form method="post" action="/analyze" enctype="multipart/form-data" class="row" style="margin-top:10px">
          <input type="file" name="file" accept="application/pdf">
          <button>Analyze</button>
          <button class="secondary" name="sample" value="1">Use a sample PDF</button>
        </form>
      </div>

      ${history.map(
        (a) => html`<div class="card">
          <div class="row" style="justify-content:space-between">
            <strong>${a.file}</strong>
            <span class="small muted">${a.pages} page(s) · ${a.words} words${a.priority ? ' · ⚡ priority' : ''}</span>
          </div>
          <p>${a.summary}</p>
          ${a.keywords.length ? html`<p class="small muted">Keywords: ${a.keywords.join(', ')}</p>` : ''}
          ${canExport
            ? html`<a class="btn secondary" href="/export/${a.id}">Export to Markdown</a>`
            : html`<span class="btn secondary locked" title="Upgrade to Pro">Export to Markdown · Pro</span>`}
        </div>`,
      )}

      ${!plan || plan.key === 'free'
        ? html`<div class="card">
            <h2 style="margin-top:0">Upgrade</h2>
            <p class="muted">Pro: 500 analyses / month and Markdown export. Business: 3,000 analyses and priority processing.</p>
            <div class="row">
              ${(['pro', 'business'] as const).map((p) => {
                const url = upgradeUrl(p, user);
                return url
                  ? html`<a class="btn" href="${url}">Upgrade to ${p === 'pro' ? 'Pro' : 'Business'}</a>`
                  : html`<span class="btn locked">Upgrade to ${p === 'pro' ? 'Pro' : 'Business'}</span>`;
              })}
            </div>
            ${PAYMENT_LINKS.pro
              ? ''
              : html`<p class="small muted">No Stripe Payment Link configured. Simulate a purchase instead:<br>
                  <code>npm run stripe:simulate -- subscribe --customer ${customerId(user)} --plan pro</code></p>`}
          </div>`
        : ''}

      <details class="card"><summary>What Keyvane returned</summary><pre>${JSON.stringify(access?.toJSON() ?? null, null, 2)}</pre></details>`,
      flash,
    ),
  );
});

app.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const user = String(form.user ?? '').toLowerCase().trim();
  if (!/^[a-z0-9_-]{2,30}$/.test(user)) return redirectWith(c, 'Usernames are 2–30 lowercase letters, numbers, - or _.');
  // Keyvane: register the customer at sign-up so they show up in your dashboard.
  try {
    await keyvane.customers.upsert({ externalId: customerId(user), name: user });
  } catch {
    /* not fatal for the demo */
  }
  setCookie(c, 'pdf_user', user, { path: '/', httpOnly: true, sameSite: 'Lax' });
  return c.redirect('/', 303);
});

app.post('/logout', (c) => {
  deleteCookie(c, 'pdf_user', { path: '/' });
  return c.redirect('/', 303);
});

app.post('/analyze', async (c) => {
  const user = userOf(c);
  if (!user) return c.redirect('/', 303);
  const form = await c.req.parseBody();
  let name = 'sample.pdf';
  let buffer: Buffer;
  if (form.sample) buffer = samplePdf();
  else if (form.file instanceof File && form.file.size > 0) {
    name = form.file.name;
    buffer = Buffer.from(await form.file.arrayBuffer());
  } else return redirectWith(c, 'Choose a PDF file first (or use the sample).');
  if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) return redirectWith(c, 'That file is not a PDF.');
  if (buffer.length > 20 * 1024 * 1024) return redirectWith(c, 'PDFs up to 20 MB, please.');

  // Keyvane: consume one analysis. The limit check and the increment are atomic, so
  // concurrent requests can never exceed the plan. The idempotency key makes re-analyzing
  // the same file in the same month free (and makes retries safe).
  const month = new Date().toISOString().slice(0, 7);
  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 24);
  let usage;
  try {
    usage = await keyvane.usage.record({
      customer: customerId(user),
      product: PRODUCT,
      feature: 'pdf_analysis',
      idempotencyKey: `${customerId(user)}:${digest}:${month}`,
    });
  } catch (err) {
    return redirectWith(c, `Could not check your plan: ${err instanceof Error ? err.message : err}`);
  }
  if (!usage.allowed) {
    return redirectWith(
      c,
      usage.code === 'limit_exceeded'
        ? `You have used all ${usage.feature.type === 'metered' ? usage.feature.limit : ''} analyses this month. Upgrade for more.`
        : usage.message,
    );
  }

  const { access } = await loadAccess(user);
  const analysis = analyzePdf(buffer);
  const list = results.get(user) ?? [];
  list.unshift({ ...analysis, id: randomUUID(), file: name, createdAt: new Date(), priority: access?.can('priority_processing') ?? false });
  results.set(user, list.slice(0, 5));
  return redirectWith(c, usage.replayed ? `Analyzed ${name} again. No extra usage was counted.` : `Analyzed ${name}.`);
});

app.get('/export/:id', async (c) => {
  const user = userOf(c);
  if (!user) return c.redirect('/', 303);
  // Keyvane: gate a Pro-only feature.
  const { access } = await loadAccess(user);
  if (!access?.can('export')) return c.text('Export to Markdown is available on the Pro and Business plans.', 402);
  const analysis = (results.get(user) ?? []).find((a) => a.id === c.req.param('id'));
  if (!analysis) return c.notFound();
  const md = `# ${analysis.title ?? analysis.file}\n\n- Pages: ${analysis.pages}\n- Words: ${analysis.words}\n- Keywords: ${analysis.keywords.join(', ')}\n\n## Summary\n\n${analysis.summary}\n`;
  c.header('Content-Disposition', `attachment; filename="${analysis.file.replace(/\.pdf$/i, '')}.md"`);
  return c.body(md, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`AI PDF Analyzer running on http://localhost:${port} (Keyvane: ${process.env.KEYVANE_URL ?? 'KEYVANE_URL not set'})`);
});
