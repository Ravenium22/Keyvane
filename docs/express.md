# Express & Node APIs

Protect API routes by plan and enforce usage limits with two small middlewares. The same pattern works in Fastify, Hono, Koa or any Node.js framework.

**You need:** Node.js 18+, a Keyvane project with a product, and a secret key in `KEYVANE_SECRET_KEY` (plus `KEYVANE_URL`).

```bash
npm install @keyvane/sdk
```

## Middleware

```ts
// keyvane.ts
import type { NextFunction, Request, Response } from 'express';
import { Keyvane, KeyvaneConnectionError } from '@keyvane/sdk';

export const keyvane = new Keyvane({ cacheTtlMs: 5_000 });

/** Allow the request only if the customer's plan includes `feature`. */
export function requireFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const access = await keyvane.entitlements.get({ customer: req.user.id });
      if (!access.can(feature)) {
        return res.status(403).json({ error: `${feature} is not included in your plan`, plan: access.plan?.key });
      }
      next();
    } catch (err) {
      if (err instanceof KeyvaneConnectionError) return res.status(503).json({ error: 'Plan check unavailable, try again' });
      next(err);
    }
  };
}

/** Consume `quantity` units of a metered feature before running the handler. */
export function meter(feature: string, quantity = 1) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const usage = await keyvane.usage.record({
        customer: req.user.id,
        feature,
        quantity,
        idempotencyKey: req.get('Idempotency-Key') ?? undefined,
      });
      if (!usage.allowed) {
        return res.status(429).json({ error: usage.message, code: usage.code, remaining: 0 });
      }
      res.setHeader('X-Usage-Remaining', String(usage.feature.type === 'metered' ? (usage.feature.remaining ?? 'unlimited') : 'n/a'));
      next();
    } catch (err) {
      next(err);
    }
  };
}
```

## Routes

```ts
app.post('/v1/analyses', meter('pdf_analysis'), createAnalysis);
app.get('/v1/exports/:id', requireFeature('export'), downloadExport);
```

## API products sold with license keys

If your customers call **your** API with a key you issued, use Keyvane license keys as the API keys and meter against them:

```ts
const usage = await keyvane.usage.record({ licenseKey: req.get('X-Api-Key')!, feature: 'requests' });
if (!usage.allowed) return res.status(usage.code === 'license_invalid' ? 401 : 429).json({ error: usage.message });
```

Next: [License keys](license-keys.md) · [REST API](api-reference.md)
