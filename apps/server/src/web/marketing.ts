import { html, type HtmlChild, type SafeHtml } from '../lib/html.ts';
import type { Ctx, UserRow } from '../types.ts';
import { assetUrl } from './assets.ts';
import { DEFAULT_DESCRIPTION, marketingPage, SITE_NAME } from './layout.ts';
import { PRICING } from './pricing.ts';
import { badge, highlight, icon, type IconName } from './ui.ts';

/** Public marketing pages: home, pricing, changelog and the build-vs-buy comparison. */

// ---------------------------------------------------------------------------
// Structured data (JSON-LD). Every fact here is also visible on the page.
// ---------------------------------------------------------------------------

function organization(ctx: Ctx) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: ctx.config.publicUrl,
    logo: `${ctx.config.publicUrl}${assetUrl('brand/icon-512.png')}`,
    sameAs: [ctx.config.githubUrl],
    ...(ctx.config.contactEmail ? { email: ctx.config.contactEmail } : {}),
  };
}

function website(ctx: Ctx) {
  return { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: ctx.config.publicUrl, description: DEFAULT_DESCRIPTION };
}

function softwareApplication(ctx: Ctx) {
  const priced = PRICING.filter((t) => /^\$\d+$/.test(t.price));
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: ctx.config.publicUrl,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web, Linux, macOS, Windows',
    description:
      'Open-core licensing and entitlement platform for indie developers and small SaaS teams: license keys, plans, feature access and usage limits, synced with Stripe subscriptions.',
    offers: priced.map((t) => ({
      '@type': 'Offer',
      name: t.name,
      price: t.price.replace('$', ''),
      priceCurrency: 'USD',
      ...(t.period ? { description: `${t.price} per month` } : {}),
    })),
    softwareHelp: `${ctx.config.publicUrl}/docs`,
    license: `${ctx.config.githubUrl}/blob/main/LICENSE`,
  };
}

function faqPage(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

export function breadcrumbs(ctx: Ctx, items: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${ctx.config.publicUrl}${path}` })),
  };
}

// ---------------------------------------------------------------------------
// Shared content
// ---------------------------------------------------------------------------

const COMPARE: [string, string][] = [
  ['Separate free and paying users', 'A default Free plan and paid plans, checked with one call'],
  ['Generate and email license keys', 'Keys with expiry, revocation and device limits, created automatically on purchase'],
  ['Cut off access when a subscription ends', 'Access follows the subscription, including grace periods and your cancellation policy'],
  ['Give each plan different features', 'An entitlement matrix you edit in the dashboard, no deploy needed'],
  ['Enforce usage and device limits', 'Atomic usage metering and per-device activation limits'],
  ['Mirror Stripe changes into your database', 'Signed, idempotent and order-safe webhook processing with replay'],
  ['Handle upgrades, renewals and failed payments', 'Upgrades keep this month’s usage; failed payments get a grace period'],
];

const STEPS: { title: string; text: string }[] = [
  { title: 'Create your product', text: 'Add the software you sell, for example an AI PDF Analyzer.' },
  { title: 'Define plans', text: 'Free, Pro and Business, each with the features and usage limits it unlocks.' },
  { title: 'Connect Stripe', text: 'Point one Stripe webhook at Keyvane and map your prices to plans. No Stripe API keys needed.' },
  { title: 'Integrate the SDK', text: 'Ask what a customer may do, record usage or validate a license key.' },
  { title: 'A customer buys', text: 'Stripe creates the subscription. Keyvane verifies the event and grants the plan within seconds.' },
  { title: 'Access stays in sync', text: 'Upgrades, failed payments and cancellations update access without code on your side.' },
];

const CAPABILITIES: { title: string; text: string; items: [IconName, string, string][] }[] = [
  {
    title: 'Decide access',
    text: 'One source of truth for what every plan includes.',
    items: [
      ['layers', 'Plans and an entitlement matrix', 'On/off features and limits per plan, changed without a deploy'],
      ['gauge', 'Usage limits', 'Atomic and idempotent, resetting daily, monthly, yearly or never'],
      ['users', 'Customer view', 'Plan, usage, licenses, subscriptions and history per customer'],
    ],
  },
  {
    title: 'Issue and protect keys',
    text: 'For desktop apps, CLIs, plugins and APIs.',
    items: [
      ['key', 'License keys', 'Expiry, suspension and revocation, issued by hand or on purchase'],
      ['device', 'Device activations', 'Per-plan seat limits with privacy-friendly fingerprints'],
      ['lock', 'Publishable keys', 'Validate keys from client apps without exposing your secret key'],
    ],
  },
  {
    title: 'Stay in sync with Stripe',
    text: 'Payment events become access, reliably.',
    items: [
      ['refresh', 'Subscription sync', 'Checkout, Payment Links and the Billing API, linked to your user IDs'],
      ['shield', 'Grace periods and policies', 'Keep access while Stripe retries; choose when cancellations end it'],
      ['activity', 'Replay and audit log', 'Every event stored, failures replayable, every change attributed'],
    ],
  },
];

const GUARANTEES: [string, string][] = [
  ['Verified', 'Every webhook is checked against its Stripe signature and a five-minute replay window before anything is stored.'],
  ['Stored', 'Each event is saved with its payload and outcome, so you can see exactly what Keyvane did and why.'],
  ['Idempotent', 'Duplicate deliveries are acknowledged and never applied twice. Usage records accept idempotency keys.'],
  ['Atomic', 'Each event is applied in one transaction, and usage limits are checked and consumed in one step.'],
  ['Order-safe', 'Older snapshots never overwrite newer ones, and an ended subscription is never brought back.'],
  ['On time', 'Grace periods, expirations and scheduled cancellations take effect at request time, with no cron jobs to miss.'],
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Keyvane?',
    a: 'Keyvane is an open-core licensing and entitlement platform for independent developers and small SaaS teams. It turns Stripe subscription events into license keys, plan-based feature access and usage limits, and answers one API call: what may this customer do right now?',
  },
  {
    q: 'Is Keyvane a payment processor?',
    a: 'No. Keyvane never touches card data or money and is not a Merchant of Record. Stripe keeps charging your customers, sending invoices and handling taxes. Keyvane manages licenses, access and usage rights on top of it.',
  },
  {
    q: 'Do I have to give Keyvane my Stripe API key?',
    a: 'No. Keyvane only needs the signing secret of one webhook endpoint you create in Stripe, and it verifies every event with it.',
  },
  {
    q: 'What happens if a webhook is missed, duplicated or arrives out of order?',
    a: 'Every event is stored and applied in a transaction. Duplicates are acknowledged without being applied twice, older snapshots cannot roll access back, and failures return an error so Stripe retries. You can replay any failed event from the dashboard.',
  },
  {
    q: 'Can I use Keyvane for desktop apps and CLIs?',
    a: 'Yes. License keys with device activation limits work today with a publishable key that is safe to embed in your app. Signed offline license files are on the roadmap.',
  },
  {
    q: 'Which payment providers are supported?',
    a: 'Stripe subscriptions, through Checkout, Payment Links or the Billing API. More providers are planned. Your app asks Keyvane for entitlements instead of asking the provider, so adding one will not change your access code.',
  },
  {
    q: 'Is Keyvane open source?',
    a: 'The SDK, examples and documentation are MIT-licensed. The platform is source-available under the Functional Source License (FSL-1.1-MIT): you can read, modify and self-host it for your own products, and every release becomes MIT two years after it ships.',
  },
  {
    q: 'What if Keyvane is unreachable?',
    a: 'Your app decides. The SDK raises typed errors, so you can keep free features working and pause paid ones, or the reverse. Short-lived caching of entitlements absorbs brief network blips.',
  },
];

function codeSample(baseUrl: string): string {
  return `import { Keyvane } from '@keyvane/sdk';

const keyvane = new Keyvane({ baseUrl: '${baseUrl}' });

// What may this customer do right now?
const access = await keyvane.entitlements.get({ customer: user.id });
if (!access.can('export')) return showUpgrade('Export is on Pro');

// Consume one analysis. The limit is enforced atomically.
const usage = await keyvane.usage.record({
  customer: user.id,
  feature: 'pdf_analysis',
  idempotencyKey: job.id,
});
if (!usage.allowed) return showUpgrade(usage.message);`;
}

function proofPanel(): SafeHtml {
  return html`<figure class="proof" aria-label="Example entitlement response for a Pro customer">
    <div class="proof-request"><span class="method">GET</span><span>/v1/entitlements?customer=user_42</span></div>
    <div class="proof-body">
      <div class="proof-head"><span class="who">user_42</span><span class="row" style="gap:.4rem">${badge('Pro', 'accent', { dot: false })}${badge('active', 'green')}</span></div>
      <div class="proof-row"><span>PDF analyses</span><span class="val">186 of 500 this month</span><div class="meter" aria-hidden="true"><span style="width:37%"></span></div></div>
      <div class="proof-row"><span>Export to Markdown</span><span class="val on">Included</span></div>
      <div class="proof-row"><span>Priority processing</span><span class="val off">Business plan</span></div>
      <div class="proof-foot"><span>Stripe subscription · renews Dec 5</span><span class="mono">KV-7K2QD-•••••-•••••-PZ3VB</span></div>
    </div>
  </figure>`;
}

export function pricingGrid(ctx: Ctx): SafeHtml {
  const signup = ctx.config.signupsEnabled ? '/signup' : '/login';
  const contact = ctx.config.contactEmail ? `mailto:${ctx.config.contactEmail}?subject=Keyvane%20Business` : signup;
  return html`<div class="pricing-grid">
    ${PRICING.map(
      (tier) => html`<div class="price-card ${tier.featured ? 'featured' : ''}">
        ${tier.featured ? html`<span class="tag">Recommended</span>` : ''}
        <div class="price-name">${tier.name}</div>
        <div class="price">${tier.price}${tier.period ? html`<small> ${tier.period}</small>` : ''}</div>
        <p class="price-desc">${tier.description}</p>
        <ul class="price-features">${tier.features.map((f) => html`<li>${icon('check', 'icon icon-sm')}<span>${f}</span></li>`)}</ul>
        <a class="btn ${tier.featured ? 'btn-primary' : 'btn-secondary'} btn-block" href="${tier.cta === 'contact' ? contact : signup}">${tier.cta === 'contact' ? 'Talk to us' : tier.price === '$0' ? 'Start free' : `Start with ${tier.name}`}</a>
      </div>`,
    )}
  </div>`;
}

function faqList(items: { q: string; a: string }[]): SafeHtml {
  return html`<div class="faq">${items.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</div>`;
}

function ctaBand(ctx: Ctx, user: UserRow | null): SafeHtml {
  const signup = ctx.config.signupsEnabled ? '/signup' : '/login';
  return html`<section class="section-ink cta-band">
    <div class="container">
      <h2>Build independently. Launch globally. Monetize simply.</h2>
      <p>Connect your first product in about ten minutes. Free during the public beta.</p>
      <div class="row">
        <a class="btn btn-primary btn-lg" href="${user ? '/app' : signup}">${user ? 'Open the dashboard' : 'Create a free account'}</a>
        <a class="btn btn-secondary btn-lg" href="/docs/getting-started">Read the quickstart</a>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function homePage(ctx: Ctx, user: UserRow | null): SafeHtml {
  const signup = ctx.config.signupsEnabled ? '/signup' : '/login';
  const content = html`
  <section class="hero">
    <div class="container hero-grid">
      <div>
        <h1>Sell your software. Let <em>Keyvane</em> handle access.</h1>
        <p class="lede">License keys, plans, feature access and usage limits in one API, kept in sync with your Stripe subscriptions. Stop rebuilding monetization infrastructure for every product.</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="${user ? '/app' : signup}">${user ? 'Open the dashboard' : 'Start free'}</a>
          <a class="btn btn-secondary btn-lg" href="/docs/getting-started">Read the quickstart</a>
        </div>
        <ul class="hero-facts">
          <li>${icon('check', 'icon icon-sm')}Works with your Stripe account</li>
          <li>${icon('check', 'icon icon-sm')}MIT-licensed SDK</li>
          <li>${icon('check', 'icon icon-sm')}Self-hostable</li>
        </ul>
      </div>
      ${proofPanel()}
    </div>
  </section>

  <section class="section section-alt" id="problem">
    <div class="container">
      <div class="section-head">
        <h2>Charging for software means building the same plumbing every time.</h2>
        <p>Plans, keys, limits and Stripe edge cases take weeks to get right, and your customers never pay you for them.</p>
      </div>
      <div class="table-wrap" style="border:0;background:transparent">
        <table class="compare">
          <thead><tr><th scope="col">What you would build yourself</th><th scope="col">What Keyvane gives you</th></tr></thead>
          <tbody>${COMPARE.map(([diy, kv]) => html`<tr><td><span class="ic-row">${icon('x', 'icon icon-sm')}<span>${diy}</span></span></td><td><span class="ic-row">${icon('check', 'icon icon-sm')}<span>${kv}</span></span></td></tr>`)}</tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section" id="how-it-works">
    <div class="container">
      <div class="section-head">
        <h2>From first sale to cancellation, access stays correct.</h2>
        <p>Your payment provider keeps charging customers. Keyvane turns its events into product access.</p>
      </div>
      <ol class="steps-list">${STEPS.map((s) => html`<li><h3>${s.title}</h3><p>${s.text}</p></li>`)}</ol>
      <div class="split" style="margin-top:4.5rem">
        <div>
          <h2>Three calls cover most products.</h2>
          <p>Register customers with your own user IDs, ask what they may do, and record usage. The TypeScript and Python SDKs have zero dependencies, and the same calls work over plain HTTP from any language.</p>
          <div class="row"><a class="btn btn-secondary" href="/docs/sdk">SDK reference</a><a class="btn btn-ghost" href="/docs/api-reference">REST API</a></div>
        </div>
        <pre class="code" tabindex="0" aria-label="SDK example"><code class="language-ts">${highlight(codeSample(ctx.config.publicUrl))}</code></pre>
      </div>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container split">
      <div>
        <h2>Alex sells an AI PDF Analyzer.</h2>
        <p>Three plans, one metered feature and one Pro-only feature. Alex defines them in Keyvane, connects Stripe and adds a few lines of code. When a customer buys Pro, their limit jumps from 10 to 500 analyses within seconds of the Stripe event. When they cancel, they drop back to Free.</p>
        <p class="small subtle">These are the prices of Alex’s product, not Keyvane’s. The example app is in the repository.</p>
        <a class="btn btn-secondary" href="/docs/getting-started">Try the example</a>
      </div>
      <div class="table-wrap">
        <table class="table example-table">
          <thead><tr><th scope="col">Plan</th><th scope="col">Monthly price</th><th scope="col">PDF analyses</th><th scope="col">Export</th></tr></thead>
          <tbody>
            <tr><td><strong>Free</strong></td><td>$0</td><td>10</td><td><span class="sr-only">Not included</span>—</td></tr>
            <tr><td><strong>Pro</strong></td><td>$12</td><td>500</td><td>Included</td></tr>
            <tr><td><strong>Business</strong></td><td>$39</td><td>3,000</td><td>Included</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section" id="features">
    <div class="container">
      <div class="section-head">
        <h2>Everything between “payment received” and “feature unlocked”.</h2>
        <p>Built for products with a handful of plans, without hundreds of settings to learn first.</p>
      </div>
      <div class="capabilities">
        ${CAPABILITIES.map(
          (group) => html`<div class="capability">
            <h3>${group.title}</h3>
            <p>${group.text}</p>
            <ul>${group.items.map(([ic, title, text]) => html`<li>${icon(ic, 'icon icon-sm')}<div><strong>${title}</strong><span>${text}</span></div></li>`)}</ul>
          </div>`,
        )}
      </div>
    </div>
  </section>

  <section class="section section-ink" id="reliability">
    <div class="container">
      <div class="section-head">
        <h2>Built for the edge cases that cost you customers.</h2>
        <p>Webhooks arrive late, twice or out of order, and payments fail. Keyvane is designed so access stays right anyway.</p>
      </div>
      <dl class="guarantees">${GUARANTEES.map(([t, d]) => html`<div><dt>${t}</dt><dd>${d}</dd></div>`)}</dl>
      <p style="margin-top:2.5rem"><a href="/docs/security" style="color:oklch(0.85 0.1 55)">How Keyvane protects access decisions</a></p>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <h2>Stripe charges. Keyvane grants access. Your app asks.</h2>
        <p>Keyvane is not a payment processor, Merchant of Record or tax engine, and it never touches card data. It does one job: turning commercial events into licenses, access and usage rights.</p>
      </div>
      <div class="flow">
        <div class="flow-node"><h3>Stripe</h3><p>Payments, invoices, taxes and the customer portal</p></div>
        <div class="flow-arrow">${icon('arrow')}<span>signed webhooks</span></div>
        <div class="flow-node focus"><h3>Keyvane</h3><p>Plans, entitlements, license keys, usage limits and the audit log</p></div>
        <div class="flow-arrow">${icon('arrow')}<span>SDK or REST</span></div>
        <div class="flow-node"><h3>Your app</h3><p>A web app, API, desktop app or CLI asks what a customer may do</p></div>
      </div>
    </div>
  </section>

  <section class="section section-alt">
    <div class="container split">
      <div>
        <h2>Open source where you integrate.</h2>
        <p>The SDK, integration examples and documentation are MIT-licensed, so you can read exactly how access decisions are made and contribute fixes. The platform is source-available and free to self-host for your own products.</p>
        <div class="row">
          <a class="btn btn-secondary" href="${ctx.config.githubUrl}" rel="noopener">${icon('github')}View on GitHub</a>
          <a class="btn btn-ghost" href="/docs/pricing-and-licensing">Licensing details</a>
        </div>
      </div>
      <pre class="code" tabindex="0" aria-label="License validation example"><code><span class="tok-c"># Validate a license key from a desktop app or CLI</span>
curl ${ctx.config.publicUrl}/v1/licenses/validate \\
  -H <span class="tok-s">"Authorization: Bearer kv_pk_…"</span> \\
  -d key=<span class="tok-s">KV-7K2QD-9XWMN-4RT8H-PZ3VB</span> \\
  -d fingerprint=<span class="tok-s">macbook-a1b2</span>

{ <span class="tok-p">"valid"</span>: <span class="tok-k">true</span>, <span class="tok-p">"code"</span>: <span class="tok-s">"valid"</span>, <span class="tok-p">"plan"</span>: <span class="tok-s">"pro"</span>, … }</code></pre>
    </div>
  </section>

  <section class="section" id="pricing">
    <div class="container">
      <div class="section-head">
        <h2>Pricing that grows with your product.</h2>
        <p>A subscription, never a commission on your revenue. Free while Keyvane is in public beta.</p>
      </div>
      ${pricingGrid(ctx)}
      <p class="pricing-note">Beta pricing in USD; it may change as we learn from early users. <a href="/pricing">Pricing details</a></p>
    </div>
  </section>

  <section class="section section-alt" id="faq">
    <div class="container">
      <div class="section-head"><h2>Questions developers ask</h2></div>
      ${faqList(FAQ)}
    </div>
  </section>

  ${ctaBand(ctx, user)}`;

  return marketingPage(ctx, {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    user,
    content,
    canonical: '/',
    jsonLd: [organization(ctx), website(ctx), softwareApplication(ctx), faqPage(FAQ)],
  });
}

const PRICING_FAQ: { q: string; a: string }[] = [
  { q: 'Do you take a percentage of my revenue?', a: 'No. Keyvane is a flat subscription. Payments go straight from your customers to your Stripe account.' },
  { q: 'What does the public beta mean for pricing?', a: 'Every feature is available on every plan and plan limits are not enforced while Keyvane is in public beta. Prices are a starting point and may change based on what we learn from early users.' },
  { q: 'Can I self-host instead?', a: 'Yes. You can run Keyvane for your own products under the Functional Source License with no plan limits. The hosted service exists for people who would rather not operate it.' },
  { q: 'What is an active license?', a: 'A license that currently grants access: not revoked, suspended or expired, and backed by a subscription in good standing if it came from Stripe.' },
  { q: 'Do I need a credit card to start?', a: 'No. Create an account and connect your first product for free.' },
];

export function pricingPage(ctx: Ctx, user: UserRow | null): SafeHtml {
  return marketingPage(ctx, {
    title: 'Pricing',
    description: 'Keyvane pricing: Developer (free), Indie ($19/month), Startup ($59/month) and Business (custom). No commission on your revenue.',
    user,
    canonical: '/pricing',
    jsonLd: [softwareApplication(ctx), faqPage(PRICING_FAQ), breadcrumbs(ctx, [['Home', '/'], ['Pricing', '/pricing']])],
    content: html`
      <section class="page-hero"><div class="container">
        <h1>Simple pricing, no revenue share.</h1>
        <p class="lede">Start free, upgrade when you have paying customers. Keyvane charges a subscription and never takes a cut of your sales.</p>
      </div></section>
      <section class="section-tight" style="padding-top:0"><div class="container">
        ${pricingGrid(ctx)}
        <p class="pricing-note">Beta pricing in USD. During the public beta every feature is available on every plan and limits are not enforced.</p>
      </div></section>
      <section class="section section-alt"><div class="container">
        <div class="section-head"><h2>Pricing questions</h2></div>
        ${faqList(PRICING_FAQ)}
      </div></section>
      ${ctaBand(ctx, user)}`,
  });
}

export interface ChangelogEntry {
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-11-05',
    title: 'Keyvane 0.1: public beta',
    items: [
      'Products with Free, Pro and Business plans, on/off and metered features, and an entitlement matrix',
      'License keys with expiry, suspension, revocation and device activation limits',
      'Stripe subscription sync with signature checks, idempotency, ordering guards, grace periods and replay',
      'Atomic, idempotent usage metering with daily, monthly, yearly and lifetime resets',
      'REST API v1 with secret and publishable keys, and the MIT-licensed @keyvane/sdk',
      'Customer access view, audit log, CSV exports, customer deletion and password reset by email',
      'Example web app and license-key CLI, a Stripe event simulator and self-hosting with Docker',
    ],
  },
];

export function changelogPage(ctx: Ctx, user: UserRow | null): SafeHtml {
  return marketingPage(ctx, {
    title: 'Changelog',
    description: 'New features and improvements in Keyvane, newest first.',
    user,
    canonical: '/changelog',
    jsonLd: [breadcrumbs(ctx, [['Home', '/'], ['Changelog', '/changelog']])],
    content: html`
      <section class="page-hero"><div class="container">
        <h1>Changelog</h1>
        <p class="lede">What changed in Keyvane, newest first. Follow along on <a href="${ctx.config.githubUrl}" rel="noopener">GitHub</a>.</p>
      </div></section>
      <section class="section-tight" style="padding-top:0"><div class="container changelog">
        ${CHANGELOG.map(
          (e) => html`<article id="${e.date}">
            <time datetime="${e.date}">${new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</time>
            <div><h2>${e.title}</h2><ul>${e.items.map((i) => html`<li>${i}</li>`)}</ul></div>
          </article>`,
        )}
      </div></section>`,
  });
}

const BUILD_VS_BUY: [string, string, string][] = [
  ['Plan and feature checks', 'A plans table, a features table and checks scattered through your code', 'One call: access.can(feature), with plans edited in a dashboard'],
  ['Usage limits', 'Counters, period resets and race conditions under concurrent requests', 'Atomic check-and-consume with idempotency keys and calendar resets'],
  ['License keys', 'Key generation, storage, validation endpoints and rate limiting', 'Keys, expiry, suspension, revocation and a publishable key for clients'],
  ['Device limits', 'Fingerprints, activation tables and a way to free seats', 'Activations with per-plan limits, managed from the dashboard'],
  ['Stripe webhooks', 'Signature checks, duplicates, out-of-order events and retries', 'Verified, stored, idempotent, order-safe processing with replay'],
  ['Failed payments and cancellations', 'Grace periods, period-end access and dunning edge cases', 'A grace period and cancellation policy per product'],
  ['Support and audits', 'Database queries when a customer asks why they lost access', 'A customer view and an audit log of every change and its cause'],
  ['Ongoing maintenance', 'Every Stripe API change and every new product repeats the work', 'Maintained once, shared across all your products'],
];

export function buildVsBuyPage(ctx: Ctx, user: UserRow | null): SafeHtml {
  return marketingPage(ctx, {
    title: 'Build licensing yourself or use Keyvane?',
    description:
      'An honest comparison of building license keys, plan checks, usage limits and Stripe webhook handling yourself versus using Keyvane, and when building it yourself is the right call.',
    user,
    canonical: '/compare/build-vs-buy',
    type: 'article',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Build licensing yourself or use Keyvane?',
        datePublished: '2026-11-05',
        dateModified: '2026-11-05',
        author: { '@type': 'Organization', name: SITE_NAME },
        publisher: organization(ctx),
      },
      breadcrumbs(ctx, [['Home', '/'], ['Build vs. buy', '/compare/build-vs-buy']]),
    ],
    content: html`
      <section class="page-hero"><div class="container">
        <h1>Build licensing yourself or use Keyvane?</h1>
        <p class="lede">Most developers can build a plan check in an afternoon. The cost is in everything around it: limits under concurrency, keys and devices, and Stripe events that arrive late, twice or out of order. Here is what each path involves.</p>
      </div></section>
      <section class="section-tight" style="padding-top:0"><div class="container">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">Area</th><th scope="col">Building it yourself</th><th scope="col">With Keyvane</th></tr></thead>
            <tbody>${BUILD_VS_BUY.map(([area, diy, kv]) => html`<tr><td><strong>${area}</strong></td><td>${diy}</td><td>${kv}</td></tr>`)}</tbody>
          </table>
        </div>
      </div></section>
      <section class="section section-alt"><div class="container split" style="align-items:start">
        <div>
          <h2>When building it yourself is the right call</h2>
          <p>If you sell a single plan with no limits and no license keys, a boolean column updated by one Stripe webhook may be all you need. Build it, verify the webhook signature, and handle <code>customer.subscription.deleted</code>.</p>
          <p>Keyvane starts paying off when you have several plans, metered features, desktop or CLI customers with keys, or more than one product to monetize.</p>
        </div>
        <div>
          <h2>What you keep either way</h2>
          <p>Your Stripe account, your customers and your pricing stay yours. Keyvane identifies customers by your own user IDs, exports to CSV at any time, and can be self-hosted from source.</p>
          <div class="row"><a class="btn btn-primary" href="/docs/getting-started">Try the quickstart</a><a class="btn btn-ghost" href="/docs/stripe">Read the Stripe guide</a></div>
        </div>
      </div></section>
      ${ctaBand(ctx, user)}`,
  });
}

export function errorPage(ctx: Ctx, status: number, title: string, message: HtmlChild): string {
  return marketingPage(ctx, {
    title,
    user: null,
    noindex: true,
    content: html`<section class="page-hero"><div class="container">
      <p class="muted">Error ${status}</p>
      <h1>${title}</h1>
      <p class="lede">${message}</p>
      <div class="row"><a class="btn btn-primary" href="/">Go to the homepage</a><a class="btn btn-secondary" href="/docs">Documentation</a></div>
    </div></section>`,
  }).toString();
}
