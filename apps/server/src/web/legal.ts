import { existsSync, readFileSync } from 'node:fs';
import type { Hono } from 'hono';
import { Marked } from 'marked';
import { html, raw } from '../lib/html.ts';
import type { Ctx } from '../types.ts';
import { marketingPage } from './layout.ts';
import type { WebEnv } from './session.ts';

/** Privacy policy and terms, published only once KEYVANE_LEGAL_ENTITY is configured. */

const LEGAL_DIR = new URL('../../../../legal/', import.meta.url);
export const LEGAL_PAGES = { privacy: 'Privacy Policy', terms: 'Terms of Service' } as const;

function render(ctx: Ctx, file: string): string | null {
  const url = new URL(file, LEGAL_DIR);
  if (!existsSync(url) || !ctx.config.legalEntity) return null;
  const source = readFileSync(url, 'utf8')
    .replaceAll('{{entity}}', ctx.config.legalEntity)
    .replaceAll('{{jurisdiction}}', ctx.config.legalJurisdiction)
    .replaceAll('{{contact}}', ctx.config.contactEmail ?? `${ctx.config.githubUrl}/issues`)
    .replaceAll('{{url}}', ctx.config.publicUrl)
    .replaceAll('{{updated}}', ctx.config.legalUpdated);
  return new Marked({ gfm: true }).parse(source) as string;
}

export function mountLegal(app: Hono<WebEnv>, ctx: Ctx): void {
  for (const [slug, title] of Object.entries(LEGAL_PAGES)) {
    app.get(`/legal/${slug}`, (c) => {
      const body = render(ctx, `${slug}.md`);
      if (!body) return c.notFound();
      return c.html(
        marketingPage(ctx, {
          title,
          description: `${title} for Keyvane.`,
          user: c.get('user'),
          canonical: `/legal/${slug}`,
          content: html`<div class="container docs" style="grid-template-columns:minmax(0,1fr)"><article class="prose">${raw(body)}</article></div>`,
        }).toString(),
      );
    });
  }
}
