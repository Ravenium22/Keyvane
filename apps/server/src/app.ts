import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createApi } from './api/routes.ts';
import { ApiError } from './lib/errors.ts';
import { randomBase62 } from './lib/crypto.ts';
import type { Ctx } from './types.ts';
import { errorPage } from './web/marketing.ts';
import { createWeb } from './web/index.ts';

const isApi = (path: string) => path === '/v1' || path.startsWith('/v1/');

export function createApp(ctx: Ctx): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const requestId = `req_${randomBase62(16)}`;
    const started = performance.now();
    c.header('X-Request-Id', requestId);
    await next();
    const path = c.req.path;
    if (!ctx.config.requestLogging || path.startsWith('/assets/') || path === '/healthz') return;
    const ms = Math.round(performance.now() - started);
    // Query strings are not logged: they can contain customer identifiers.
    if (ctx.config.env === 'production') {
      console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'request', method: c.req.method, path, status: c.res.status, ms, rid: requestId }));
    } else {
      console.log(`${c.req.method} ${path} ${c.res.status} ${ms}ms ${requestId}`);
    }
  });

  // Send the www host (and any other alias pointed at this server) to the canonical public URL.
  const canonical = new URL(ctx.config.publicUrl);
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase().replace(/:\d+$/, '');
    if (host && host === `www.${canonical.hostname}`) {
      const url = new URL(c.req.url);
      return c.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
    }
    await next();
  });

  app.get('/healthz', (c) => {
    ctx.db.get('SELECT 1');
    return c.json({ ok: true });
  });

  app.route('/v1', createApi(ctx));
  app.route('/', createWeb(ctx));

  app.notFound((c) => {
    if (isApi(c.req.path)) {
      return c.json(new ApiError(404, 'not_found_error', 'route_not_found', 'Unknown API route. See /docs/api-reference.').toJSON(), 404);
    }
    return c.html(errorPage(ctx, 404, 'Page not found', 'The page you are looking for does not exist or has moved.'), 404);
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      if (isApi(c.req.path)) return c.json(err.toJSON(), err.status as 400);
      return c.html(errorPage(ctx, err.status, err.status === 404 ? 'Not found' : 'Something is not right', err.message), err.status as 400);
    }
    if (err instanceof HTTPException) {
      if (isApi(c.req.path)) {
        return c.json(new ApiError(err.status, 'invalid_request_error', 'http_error', err.message || 'Request rejected.').toJSON(), err.status);
      }
      if (err.status === 403) {
        return c.html(errorPage(ctx, 403, 'Request blocked', 'This form was submitted from another site, so it was blocked for your safety. Go back, reload the page and try again.'), 403);
      }
      return err.getResponse();
    }
    console.error(`[keyvane] ${c.req.method} ${c.req.path} failed:`, err);
    if (isApi(c.req.path)) {
      return c.json(new ApiError(500, 'api_error', 'internal_error', 'Something went wrong on our side. Please retry; if it persists, contact support.').toJSON(), 500);
    }
    return c.html(errorPage(ctx, 500, 'Something went wrong', 'An unexpected error occurred. Please try again.'), 500);
  });

  return app;
}
