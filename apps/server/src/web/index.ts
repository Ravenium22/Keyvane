import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import type { Ctx } from '../types.ts';
import { getAsset } from './assets.ts';
import { mountAuth } from './auth.ts';
import { mountActivity } from './dashboard/activity.ts';
import { mountCustomers } from './dashboard/customers.ts';
import { mountKeys } from './dashboard/keys.ts';
import { mountLicenses } from './dashboard/licenses.ts';
import { mountOverview } from './dashboard/overview.ts';
import { mountProducts } from './dashboard/products.ts';
import { mountSettings } from './dashboard/settings.ts';
import { mountStripe } from './dashboard/stripe.ts';
import { docsPage } from './docs.ts';
import { buildVsBuyPage, changelogPage, homePage, pricingPage } from './marketing.ts';
import { mountSeo } from './seo.ts';
import { mountLegal } from './legal.ts';
import { requireUser, sessionMiddleware, type WebEnv } from './session.ts';

export function createWeb(ctx: Ctx): Hono<WebEnv> {
  const web = new Hono<WebEnv>();
  const publicOrigin = new URL(ctx.config.publicUrl).origin;

  web.get('/assets/*', (c) => {
    const path = c.req.path.slice('/assets/'.length);
    const asset = getAsset(path);
    if (!asset) return c.text('Not found', 404);
    c.header('Content-Type', asset.type);
    const immutable = c.req.query('v') || path.startsWith('fonts/');
    c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    if (path.startsWith('fonts/')) c.header('Access-Control-Allow-Origin', '*');
    return c.body(new Uint8Array(asset.body));
  });
  web.get('/favicon.ico', (c) => c.redirect('/assets/favicon.svg', 301));
  mountSeo(web, ctx);

  const analyticsHost = ctx.config.analytics.plausibleDomain ? ['https://plausible.io'] : [];
  web.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...analyticsHost],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", ...analyticsHost],
        formAction: ["'self'", 'https://buy.stripe.com'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
      crossOriginResourcePolicy: 'same-origin',
    }),
  );
  web.use(
    '*',
    csrf({ origin: (origin, c) => origin === publicOrigin || origin === new URL(c.req.url).origin }),
  );
  web.use('*', sessionMiddleware(ctx));

  web.get('/', (c) => c.html(homePage(ctx, c.get('user')).toString()));
  web.get('/pricing', (c) => c.html(pricingPage(ctx, c.get('user')).toString()));
  web.get('/changelog', (c) => c.html(changelogPage(ctx, c.get('user')).toString()));
  web.get('/compare/build-vs-buy', (c) => c.html(buildVsBuyPage(ctx, c.get('user')).toString()));
  web.get('/docs', (c) => {
    const page = docsPage(ctx, '', c.get('user'));
    return page ? c.html(page.toString()) : c.notFound();
  });
  web.get('/docs/:slug', (c) => {
    const page = docsPage(ctx, c.req.param('slug'), c.get('user'));
    return page ? c.html(page.toString()) : c.notFound();
  });

  mountLegal(web, ctx);
  mountAuth(web, ctx);

  web.use('/app', requireUser());
  web.use('/app/*', requireUser());
  mountOverview(web, ctx);
  mountProducts(web, ctx);
  mountCustomers(web, ctx);
  mountLicenses(web, ctx);
  mountStripe(web, ctx);
  mountKeys(web, ctx);
  mountActivity(web, ctx);
  mountSettings(web, ctx);

  return web;
}
