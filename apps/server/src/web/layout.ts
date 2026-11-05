import { html, jsonForScript, type HtmlChild, type SafeHtml } from '../lib/html.ts';
import type { ProjectWithRole } from '../services/projects.ts';
import type { Ctx, UserRow } from '../types.ts';
import { assetUrl } from './assets.ts';
import type { Flash } from './session.ts';
import { icon, initials, type IconName } from './ui.ts';

export const SITE_NAME = 'Keyvane';
export const DEFAULT_DESCRIPTION =
  'Keyvane gives independent developers license keys, plans, feature access and usage limits in one API, kept in sync with their Stripe subscriptions.';

export interface SeoOptions {
  /** Path of the canonical URL, e.g. "/pricing". Omit for pages that should not be indexed. */
  canonical?: string;
  /** Social preview image path under /assets, e.g. "brand/og-default.png". */
  image?: string;
  type?: 'website' | 'article';
  /** JSON-LD objects rendered in the head. */
  jsonLd?: unknown[];
  /** Markdown version of the page, for AI agents. */
  markdown?: string;
  noindex?: boolean;
  /** Load the optional analytics script (public pages only, never the dashboard). */
  analytics?: boolean;
}

interface DocumentOptions extends SeoOptions {
  ctx: Ctx;
  title: string;
  description?: string;
  bodyClass?: string;
  body: HtmlChild;
}

export function documentShell(opts: DocumentOptions): SafeHtml {
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const fullTitle = opts.title === SITE_NAME ? opts.title : `${opts.title} · ${SITE_NAME}`;
  const base = opts.ctx.config.publicUrl;
  const canonical = opts.canonical !== undefined ? `${base}${opts.canonical === '/' ? '/' : opts.canonical}` : null;
  const image = `${base}${assetUrl(opts.image ?? 'brand/og-default.png')}`;
  const analytics = opts.analytics ? opts.ctx.config.analytics.plausibleDomain : null;
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">
  ${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
  ${opts.noindex ? html`<meta name="robots" content="noindex">` : ''}
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="${opts.type ?? 'website'}">
  ${canonical ? html`<meta property="og:url" content="${canonical}">` : ''}
  <meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${fullTitle}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">
  <meta name="theme-color" content="#f8f9fc" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#11141d" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="${assetUrl('favicon.svg')}" type="image/svg+xml">
  <link rel="icon" href="${assetUrl('brand/favicon-32.png')}" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="${assetUrl('brand/apple-touch-icon.png')}">
  <link rel="manifest" href="/site.webmanifest">
  ${opts.markdown ? html`<link rel="alternate" type="text/markdown" href="${opts.markdown}">` : ''}
  <link rel="alternate" type="text/plain" title="LLM-friendly site index" href="/llms.txt">
  <link rel="preload" href="/assets/fonts/ibm-plex-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/bricolage-grotesque-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${assetUrl('app.css')}">
  ${(opts.jsonLd ?? []).map((data) => html`<script type="application/ld+json">${jsonForScript(data)}</script>`)}
  ${analytics ? html`<script defer data-domain="${analytics}" src="https://plausible.io/js/script.js"></script>` : ''}
</head>
<body class="${opts.bodyClass ?? ''}">
<a class="skip-link" href="#main">Skip to content</a>
${opts.body}
<script src="${assetUrl('app.js')}" defer></script>
</body>
</html>`;
}

export function brand(href = '/'): SafeHtml {
  return html`<a class="brand" href="${href}" aria-label="Keyvane home"><img src="${assetUrl('logo.svg')}" alt="" width="28" height="28">Keyvane</a>`;
}

export function flashMessage(flash: Flash | null): SafeHtml {
  if (!flash) return html``;
  const iconName: IconName = flash.type === 'success' ? 'check' : flash.type === 'error' ? 'alert' : 'info';
  return html`<div class="flash flash-${flash.type}" role="${flash.type === 'error' ? 'alert' : 'status'}">${icon(iconName)}<div>${flash.message}</div></div>`;
}

// ---------------------------------------------------------------------------
// Marketing / docs
// ---------------------------------------------------------------------------

export function siteHeader(ctx: Ctx, user: UserRow | null): SafeHtml {
  return html`<header class="site-header">
    <div class="container">
      ${brand('/')}
      <nav class="site-nav" aria-label="Main">
        <a href="/#how-it-works">How it works</a>
        <a href="/pricing">Pricing</a>
        <a href="/docs">Docs</a>
        <a href="/changelog">Changelog</a>
        <a href="${ctx.config.githubUrl}" rel="noopener">GitHub</a>
      </nav>
      <div class="actions">
        ${user
          ? html`<a class="btn btn-primary btn-sm" href="/app">Dashboard</a>`
          : html`<a class="btn btn-ghost btn-sm" href="/login">Log in</a>
              ${ctx.config.signupsEnabled ? html`<a class="btn btn-primary btn-sm" href="/signup">Start free</a>` : ''}`}
      </div>
    </div>
  </header>`;
}

export function siteFooter(ctx: Ctx): SafeHtml {
  const legal = !!ctx.config.legalEntity;
  return html`<footer class="site-footer">
    <div class="container footer-grid">
      <div>
        ${brand('/')}
        <p>Licenses, plans and usage limits for software you sell, kept in sync with Stripe.</p>
      </div>
      <div>
        <h3>Product</h3>
        <ul>
          <li><a href="/#how-it-works">How it works</a></li>
          <li><a href="/pricing">Pricing</a></li>
          <li><a href="/compare/build-vs-buy">Build vs. buy</a></li>
          <li><a href="/changelog">Changelog</a></li>
          <li><a href="/docs/roadmap">Roadmap</a></li>
        </ul>
      </div>
      <div>
        <h3>Developers</h3>
        <ul>
          <li><a href="/docs/getting-started">Quickstart</a></li>
          <li><a href="/docs/api-reference">REST API</a></li>
          <li><a href="/docs/sdk">JavaScript SDK</a></li>
          <li><a href="/openapi.json">OpenAPI spec</a></li>
          <li><a href="/llms.txt">llms.txt</a></li>
        </ul>
      </div>
      <div>
        <h3>Project</h3>
        <ul>
          <li><a href="${ctx.config.githubUrl}" rel="noopener">GitHub</a></li>
          <li><a href="/docs/pricing-and-licensing">Open source &amp; licensing</a></li>
          <li><a href="/docs/security">Security</a></li>
          ${legal ? html`<li><a href="/legal/privacy">Privacy</a></li><li><a href="/legal/terms">Terms</a></li>` : ''}
          ${ctx.config.contactEmail ? html`<li><a href="mailto:${ctx.config.contactEmail}">Contact</a></li>` : ''}
        </ul>
      </div>
    </div>
  </footer>`;
}

export function marketingPage(
  ctx: Ctx,
  opts: { title: string; description?: string; user: UserRow | null; content: HtmlChild } & SeoOptions,
): SafeHtml {
  return documentShell({
    analytics: true,
    ...opts,
    ctx,
    bodyClass: 'site',
    body: html`${siteHeader(ctx, opts.user)}<main id="main">${opts.content}</main>${siteFooter(ctx)}`,
  });
}

export function authPage(ctx: Ctx, opts: { title: string; heading: string; subheading?: HtmlChild; flash?: Flash | null; content: HtmlChild; foot?: HtmlChild }): SafeHtml {
  return documentShell({
    ctx,
    title: opts.title,
    noindex: true,
    body: html`<main class="auth" id="main">
      <div class="auth-card">
        <div class="auth-head">${brand('/')}<h1>${opts.heading}</h1>${opts.subheading ? html`<p class="muted">${opts.subheading}</p>` : ''}</div>
        <div class="card"><div class="card-body">${flashMessage(opts.flash ?? null)}${opts.content}</div></div>
        ${opts.foot ? html`<p class="auth-foot">${opts.foot}</p>` : ''}
      </div>
    </main>`,
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type NavKey = 'overview' | 'products' | 'customers' | 'licenses' | 'stripe' | 'keys' | 'activity' | 'settings';

const NAV: { key: NavKey; label: string; icon: IconName; path: string; group: 'build' | 'operate' | 'configure' }[] = [
  { key: 'overview', label: 'Overview', icon: 'home', path: '', group: 'build' },
  { key: 'products', label: 'Products & plans', icon: 'box', path: '/products', group: 'build' },
  { key: 'customers', label: 'Customers', icon: 'users', path: '/customers', group: 'operate' },
  { key: 'licenses', label: 'Licenses', icon: 'key', path: '/licenses', group: 'operate' },
  { key: 'activity', label: 'Activity', icon: 'activity', path: '/activity', group: 'operate' },
  { key: 'stripe', label: 'Stripe', icon: 'card', path: '/stripe', group: 'configure' },
  { key: 'keys', label: 'API keys', icon: 'code', path: '/api-keys', group: 'configure' },
  { key: 'settings', label: 'Settings', icon: 'sliders', path: '/settings', group: 'configure' },
];

export interface DashboardOptions {
  ctx: Ctx;
  user: UserRow;
  project: ProjectWithRole | null;
  projects: ProjectWithRole[];
  active: NavKey | null;
  title: string;
  eyebrow?: HtmlChild;
  lead?: HtmlChild;
  actions?: HtmlChild;
  flash: Flash | null;
  content: HtmlChild;
}

function sidebar(opts: DashboardOptions): SafeHtml {
  const { project, projects, user } = opts;
  const base = project ? `/app/p/${project.id}` : '/app';
  const group = (g: 'build' | 'operate' | 'configure', label: string) => html`<div class="nav-label">${label}</div>
    ${NAV.filter((n) => n.group === g).map(
      (n) => html`<a href="${base}${n.path}" class="${opts.active === n.key ? 'active' : ''}" ${opts.active === n.key ? html`aria-current="page"` : ''}>${icon(n.icon)}${n.label}</a>`,
    )}`;
  return html`<aside class="sidebar">
    ${brand('/app')}
    ${project
      ? html`<details class="switcher">
          <summary><span class="proj-name">${project.name}</span>${icon('chevron', 'icon icon-sm')}</summary>
          <div class="switcher-menu">
            ${projects.map((p) => html`<a href="/app/p/${p.id}" class="${p.id === project.id ? 'current' : ''}">${p.name}</a>`)}
            <a href="/app/projects/new">New project</a>
          </div>
        </details>
        <nav class="nav" aria-label="Project">${group('build', 'Build')}${group('operate', 'Operate')}${group('configure', 'Configure')}</nav>`
      : ''}
    <div class="sidebar-footer nav">
      <a href="/docs" target="_blank" rel="noopener">${icon('book')}Documentation</a>
      <div class="user-chip"><span class="avatar">${initials(user.name ?? user.email)}</span><span>${user.email}</span></div>
      <a href="/app/account">${icon('sliders')}Account</a>
      ${opts.ctx.config.adminEmails.includes(user.email.toLowerCase()) ? html`<a href="/app/admin">${icon('gauge')}Admin</a>` : ''}
      <form method="post" action="/logout" class="inline-form"><button class="btn btn-ghost btn-block" style="justify-content:flex-start;font-weight:500;padding-left:.65rem">${icon('logout')}Log out</button></form>
    </div>
  </aside>`;
}

export function dashboardPage(opts: DashboardOptions): SafeHtml {
  return documentShell({
    ctx: opts.ctx,
    title: opts.project ? `${opts.title} · ${opts.project.name}` : opts.title,
    noindex: true,
    bodyClass: 'dashboard',
    body: html`<div class="shell">
      ${sidebar(opts)}
      <main class="main" id="main">
        <header class="page-header">
          <div>
            ${opts.eyebrow ? html`<p class="eyebrow">${opts.eyebrow}</p>` : ''}
            <h1>${opts.title}</h1>
            ${opts.lead ? html`<p class="lead">${opts.lead}</p>` : ''}
          </div>
          ${opts.actions ? html`<div class="row">${opts.actions}</div>` : ''}
        </header>
        ${flashMessage(opts.flash)}
        ${opts.content}
      </main>
    </div>`,
  });
}
