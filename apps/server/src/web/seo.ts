import { readFileSync } from 'node:fs';
import type { Hono } from 'hono';
import { openApiSpec } from '../api/openapi.ts';
import type { Ctx } from '../types.ts';
import { assetUrl } from './assets.ts';
import { DOC_PAGES, docPath, docUpdatedAt, findDocPage, readDocMarkdown } from './docs.ts';
import { DEFAULT_DESCRIPTION } from './layout.ts';
import { CHANGELOG, FAQ } from './marketing.ts';
import { PRICING } from './pricing.ts';
import type { WebEnv } from './session.ts';

/**
 * Discovery files for search engines and AI agents: robots.txt, sitemap.xml, llms.txt,
 * llms-full.txt, Markdown mirrors of every docs page, the OpenAPI spec, an agent skill
 * file, security.txt and the web app manifest.
 */

const SITE_UPDATED = CHANGELOG[0]?.date ?? '2026-11-05';
const PUBLIC_PAGES: [string, string][] = [
  ['/', SITE_UPDATED],
  ['/pricing', SITE_UPDATED],
  ['/changelog', SITE_UPDATED],
  ['/compare/build-vs-buy', SITE_UPDATED],
];

const SKILL_FILE = new URL('../../../../docs/SKILL.md', import.meta.url);

function pricingText(): string {
  return PRICING.map((t) => `- **${t.name}**: ${t.price}${t.period ? ` ${t.period}` : ''}. ${t.description} Includes: ${t.features.join('; ')}.`).join('\n');
}

function llmsTxt(ctx: Ctx): string {
  const base = ctx.config.publicUrl;
  const docs = DOC_PAGES.map((p) => `- [${p.title}](${base}${docPath(p)}.md): ${p.summary}`).join('\n');
  return `# Keyvane

> ${DEFAULT_DESCRIPTION}

Keyvane is an open-core licensing and entitlement platform for independent developers and small SaaS teams. It connects Stripe subscription events to product access: license keys, plan-based feature access and usage limits, through one REST API and MIT-licensed SDKs for TypeScript (\`@keyvane/sdk\`) and Python (\`keyvane\`). It is not a payment processor or Merchant of Record; Stripe keeps charging customers.

Key facts:
- Your app asks \`GET /v1/entitlements?customer=<your user id>\` (or \`keyvane.entitlements.get()\`) what a customer may do; \`POST /v1/usage\` consumes metered usage atomically and idempotently.
- License keys (\`KV-XXXXX-XXXXX-XXXXX-XXXXX\`) support expiry, suspension, revocation and device activation limits; publishable keys (\`kv_pk_\`) can validate keys from client apps.
- Stripe sync needs only a webhook signing secret, not Stripe API keys. Events are verified, stored, idempotent, transactional and order-safe; failed events can be replayed.
- Self-hostable: one Node.js 22 process with SQLite. The platform is FSL-1.1-MIT (MIT after two years); SDK, examples and docs are MIT.
- Pricing (beta, USD, no revenue commission): Developer free, Indie $19/month, Startup $59/month, Business custom.

## Docs

${docs}

## API

- [OpenAPI 3.1 spec](${base}/openapi.json): machine-readable description of REST API v1
- [Agent skill](${base}/SKILL.md): step-by-step instructions for coding agents integrating Keyvane into an app

## Optional

- [Pricing](${base}/pricing): plans and limits
- [Build vs. buy](${base}/compare/build-vs-buy): when to build licensing yourself
- [Changelog](${base}/changelog): dated release notes
- [Full content in one file](${base}/llms-full.txt)
- [Source code](${ctx.config.githubUrl})
`;
}

function llmsFullTxt(ctx: Ctx): string {
  const parts = [
    `# Keyvane: complete documentation\n\nSource: ${ctx.config.publicUrl} · Generated ${new Date().toISOString().slice(0, 10)}\n\n${DEFAULT_DESCRIPTION}`,
    `# Pricing\n\n${pricingText()}\n\nNo commission on revenue. During the public beta every feature is available on every plan and limits are not enforced.`,
    `# Frequently asked questions\n\n${FAQ.map((f) => `## ${f.q}\n\n${f.a}`).join('\n\n')}`,
  ];
  for (const page of DOC_PAGES) {
    const md = readDocMarkdown(ctx, page);
    if (md) parts.push(`<!-- ${ctx.config.publicUrl}${docPath(page)} -->\n\n${md.trim()}`);
  }
  return `${parts.join('\n\n---\n\n')}\n`;
}

function sitemap(ctx: Ctx): string {
  const base = ctx.config.publicUrl;
  const urls = [
    ...PUBLIC_PAGES.map(([path, lastmod]) => ({ loc: `${base}${path}`, lastmod })),
    ...DOC_PAGES.map((p) => ({ loc: `${base}${docPath(p)}`, lastmod: docUpdatedAt(p).slice(0, 10) })),
    ...(ctx.config.legalEntity
      ? ['privacy', 'terms'].map((slug) => ({ loc: `${base}/legal/${slug}`, lastmod: ctx.config.legalUpdated }))
      : []),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

export function mountSeo(app: Hono<WebEnv>, ctx: Ctx): void {
  const base = ctx.config.publicUrl;
  const text = (body: string, type = 'text/plain; charset=utf-8') =>
    new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' } });

  app.get('/robots.txt', () =>
    text(`# Search engines and AI agents are welcome on public pages.
User-agent: *
Allow: /
Disallow: /app/
Disallow: /login
Disallow: /signup
Disallow: /forgot-password
Disallow: /reset-password
Disallow: /v1/

Sitemap: ${base}/sitemap.xml
`),
  );

  app.get('/sitemap.xml', () => text(sitemap(ctx), 'application/xml; charset=utf-8'));
  app.get('/llms.txt', () => text(llmsTxt(ctx), 'text/markdown; charset=utf-8'));
  app.get('/llms-full.txt', () => text(llmsFullTxt(ctx), 'text/markdown; charset=utf-8'));
  app.get('/openapi.json', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json(openApiSpec(base));
  });
  app.get('/SKILL.md', () => text(readFileSync(SKILL_FILE, 'utf8').replaceAll('https://keyvane.example.com', base), 'text/markdown; charset=utf-8'));

  // Markdown mirrors of the docs, for agents and "copy as Markdown".
  app.get('/docs.md', () => {
    const page = findDocPage('');
    const md = page ? readDocMarkdown(ctx, page) : null;
    return md ? text(md, 'text/markdown; charset=utf-8') : new Response('Not found', { status: 404 });
  });
  app.get('/docs/:file{[a-z0-9-]+\\.md}', (c) => {
    const page = findDocPage(c.req.param('file').replace(/\.md$/, ''));
    const md = page ? readDocMarkdown(ctx, page) : null;
    return md ? text(md, 'text/markdown; charset=utf-8') : c.notFound();
  });

  app.get('/.well-known/security.txt', () => {
    const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
    return text(`Contact: ${ctx.config.githubUrl.replace(/\/+$/, '')}/security/advisories/new
${ctx.config.contactEmail ? `Contact: mailto:${ctx.config.contactEmail}\n` : ''}Expires: ${expires}
Policy: ${ctx.config.githubUrl.replace(/\/+$/, '')}/blob/main/SECURITY.md
Preferred-Languages: en, tr
Canonical: ${base}/.well-known/security.txt
`);
  });

  app.get('/site.webmanifest', () =>
    text(
      JSON.stringify(
        {
          name: 'Keyvane',
          short_name: 'Keyvane',
          description: DEFAULT_DESCRIPTION,
          start_url: '/app',
          display: 'standalone',
          background_color: '#f8f9fc',
          theme_color: '#c2410c',
          icons: [
            { src: assetUrl('brand/icon-192.png'), sizes: '192x192', type: 'image/png' },
            { src: assetUrl('brand/icon-512.png'), sizes: '512x512', type: 'image/png' },
            { src: assetUrl('favicon.svg'), sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        null,
        2,
      ),
      'application/manifest+json',
    ),
  );
}
