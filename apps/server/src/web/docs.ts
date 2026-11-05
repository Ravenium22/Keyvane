import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { Marked, type Tokens } from 'marked';
import { html, raw, type SafeHtml } from '../lib/html.ts';
import type { Ctx, UserRow } from '../types.ts';
import { documentShell, siteFooter, siteHeader } from './layout.ts';

/**
 * Renders the Markdown files in /docs (the same files you read on GitHub) at /docs/*.
 */

export interface DocPage {
  slug: string;
  file: string;
  title: string;
  section: string;
  /** One line for llms.txt and link previews. */
  summary: string;
}

export const DOC_PAGES: DocPage[] = [
  { slug: '', file: 'README.md', title: 'Introduction', section: 'Get started', summary: 'What Keyvane is, how it fits between Stripe and your app, and where to start.' },
  { slug: 'getting-started', file: 'getting-started.md', title: 'Quickstart', section: 'Get started', summary: 'Run Keyvane, define plans, check entitlements and simulate a purchase in about 10 minutes.' },
  { slug: 'concepts', file: 'concepts.md', title: 'Core concepts', section: 'Get started', summary: 'Projects, products, plans, features, customers, licenses and exactly how access is decided.' },
  { slug: 'stripe', file: 'stripe.md', title: 'Stripe integration', section: 'Guides', summary: 'Connect a Stripe webhook, map prices to plans, identify customers and test the subscription lifecycle.' },
  { slug: 'license-keys', file: 'license-keys.md', title: 'License keys & devices', section: 'Guides', summary: 'Issue, validate and revoke license keys and enforce device activation limits for desktop apps and CLIs.' },
  { slug: 'nextjs', file: 'nextjs.md', title: 'Next.js', section: 'Guides', summary: 'Gate features and meter usage in a Next.js App Router app with server components and route handlers.' },
  { slug: 'express', file: 'express.md', title: 'Express & Node APIs', section: 'Guides', summary: 'Middleware that checks plans and consumes usage limits in an Express or other Node.js API.' },
  { slug: 'electron', file: 'electron.md', title: 'Electron & desktop apps', section: 'Guides', summary: 'License-key activation, device limits and offline grace for Electron apps.' },
  { slug: 'stripe-webhook-edge-cases', file: 'stripe-webhook-edge-cases.md', title: 'Stripe webhook edge cases', section: 'Articles', summary: 'Seven Stripe webhook edge cases that silently break access, and how to handle each one.' },
  { slug: 'sdk', file: 'sdk.md', title: 'JavaScript SDK', section: 'Reference', summary: 'Every method of @keyvane/sdk: entitlements, usage, customers, licenses, products, errors and retries.' },
  { slug: 'python', file: 'python.md', title: 'Python SDK', section: 'Reference', summary: 'The zero-dependency Python client: entitlements, usage limits and license keys, with a FastAPI example.' },
  { slug: 'api-reference', file: 'api-reference.md', title: 'REST API', section: 'Reference', summary: 'REST API v1: authentication, errors, pagination, idempotency and every endpoint with examples.' },
  { slug: 'agents', file: 'agents.md', title: 'AI coding agents', section: 'Reference', summary: 'How Claude Code, Cursor and other agents can integrate Keyvane: llms.txt, SKILL.md and OpenAPI.' },
  { slug: 'self-hosting', file: 'self-hosting.md', title: 'Self-hosting', section: 'Operations', summary: 'Deploy Keyvane with Docker or Fly.io: configuration, backups, upgrades and a production checklist.' },
  { slug: 'security', file: 'security.md', title: 'Security & reliability', section: 'Operations', summary: 'How credentials are stored, how forms and webhooks are protected and how access decisions stay correct.' },
  { slug: 'pricing-and-licensing', file: 'pricing-and-licensing.md', title: 'Pricing & licensing', section: 'Project', summary: 'What is MIT, what is FSL-licensed, and Keyvane Cloud plans.' },
  { slug: 'roadmap', file: 'roadmap.md', title: 'Roadmap', section: 'Project', summary: 'What shipped in the MVP and what is planned for the public beta and the commercial platform.' },
];

const DOCS_DIR = new URL('../../../../docs/', import.meta.url);
const bySlug = new Map(DOC_PAGES.map((p) => [p.slug, p]));
const byFile = new Map(DOC_PAGES.map((p) => [p.file, p]));
const cache = new Map<string, { html: string; title: string; description: string }>();

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function createRenderer(ctx: Ctx, currentFile: string): Marked {
  const repoBlob = `${ctx.config.githubUrl.replace(/\/+$/, '')}/blob/main`;
  return new Marked({
    gfm: true,
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        if (token.depth === 1) return `<h1>${inner}</h1>\n`;
        const id = slugifyHeading(inner);
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}">${inner}</a></h${token.depth}>\n`;
      },
      link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        let href = token.href;
        const match = /^(?:\.\/)?([A-Za-z0-9._-]+\.md)(#.*)?$/.exec(href);
        if (match && byFile.has(match[1] as string)) {
          const page = byFile.get(match[1] as string) as DocPage;
          href = `/docs${page.slug ? `/${page.slug}` : ''}${match[2] ?? ''}`;
        } else if (!/^[a-z]+:|^#|^\//i.test(href)) {
          // Relative link to a file elsewhere in the repository → GitHub.
          href = `${repoBlob}/${posix.normalize(posix.join('docs', posix.dirname(currentFile), href))}`;
        }
        const external = /^https?:\/\//.test(href) && !href.startsWith(ctx.config.publicUrl);
        const title = token.title ? ` title="${token.title.replace(/"/g, '&quot;')}"` : '';
        return `<a href="${href.replace(/"/g, '&quot;')}"${title}${external ? ' rel="noopener"' : ''}>${text}</a>`;
      },
    },
  });
}

/** The page's Markdown source, with sample URLs pointing at this deployment. */
export function readDocMarkdown(ctx: Ctx, page: DocPage): string | null {
  const url = new URL(page.file, DOCS_DIR);
  if (!existsSync(url)) return null;
  return readFileSync(url, 'utf8').replaceAll('https://keyvane.example.com', ctx.config.publicUrl);
}

export function docUpdatedAt(page: DocPage): string {
  const url = new URL(page.file, DOCS_DIR);
  return existsSync(url) ? statSync(url).mtime.toISOString() : new Date(0).toISOString();
}

export function docPath(page: DocPage): string {
  return `/docs${page.slug ? `/${page.slug}` : ''}`;
}

export function findDocPage(slug: string): DocPage | undefined {
  return bySlug.get(slug);
}

function renderDoc(ctx: Ctx, page: DocPage): { html: string; title: string; description: string } | null {
  const cacheKey = `${ctx.config.publicUrl}|${page.file}`;
  const cached = ctx.config.env === 'production' ? cache.get(cacheKey) : undefined;
  if (cached) return cached;
  const source = readDocMarkdown(ctx, page);
  if (source === null) return null;
  // First paragraph after the H1 doubles as the meta description.
  const firstParagraph = source.split(/\n\s*\n/).find((block) => block.trim() && !block.trim().startsWith('#'))?.trim() ?? page.title;
  const description = firstParagraph.replace(/[*_`>]|\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').slice(0, 300);
  const htmlOut = (createRenderer(ctx, page.file).parse(source) as string).replace(/<pre>/g, '<pre tabindex="0">');
  const rendered = { html: htmlOut, title: page.title, description };
  cache.set(cacheKey, rendered);
  return rendered;
}

export function docsPage(ctx: Ctx, slug: string, user: UserRow | null): SafeHtml | null {
  const page = bySlug.get(slug);
  if (!page) return null;
  const doc = renderDoc(ctx, page);
  if (!doc) return null;
  const sections = [...new Set(DOC_PAGES.map((p) => p.section))];
  const nav = html`<nav class="docs-nav" aria-label="Documentation">
    ${sections.map(
      (section) => html`<div class="nav-label">${section}</div>
        ${DOC_PAGES.filter((p) => p.section === section).map(
          (p) => html`<a href="/docs${p.slug ? `/${p.slug}` : ''}" class="${p.slug === slug ? 'active' : ''}">${p.title}</a>`,
        )}`,
    )}
  </nav>`;
  const path = docPath(page);
  const updated = docUpdatedAt(page);
  const editUrl = `${ctx.config.githubUrl.replace(/\/+$/, '')}/blob/main/docs/${page.file}`;
  return documentShell({
    ctx,
    analytics: true,
    title: page.slug ? `${page.title} · Docs` : 'Documentation',
    description: doc.description,
    canonical: path,
    type: 'article',
    markdown: `${path === '/docs' ? '/docs' : path}.md`,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: page.title,
        description: doc.description,
        dateModified: updated,
        author: { '@type': 'Organization', name: 'Keyvane' },
        url: `${ctx.config.publicUrl}${path}`,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Docs', item: `${ctx.config.publicUrl}/docs` },
          ...(page.slug ? [{ '@type': 'ListItem', position: 2, name: page.title, item: `${ctx.config.publicUrl}${path}` }] : []),
        ],
      },
    ],
    body: html`${siteHeader(ctx, user)}
      <div class="container docs">${nav}<main class="prose" id="main">
        <div class="doc-meta"><span>${page.section}</span><span>Updated ${updated.slice(0, 10)}</span><a href="${path}.md">View as Markdown</a><a href="${editUrl}" rel="noopener">Edit on GitHub</a></div>
        ${raw(doc.html)}
      </main></div>
      ${siteFooter(ctx)}`,
  });
}
