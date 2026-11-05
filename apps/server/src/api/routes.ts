import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { ApiError, badRequest, forbidden, tooManyRequests, unauthorized } from '../lib/errors.ts';
import { RateLimiter } from '../lib/rate-limit.ts';
import { clientIp } from '../lib/request.ts';
import { int, str } from '../lib/validate.ts';
import { authenticateApiKey } from '../services/api-keys.ts';
import { listProducts, loadCatalog, resolveProduct } from '../services/catalog.ts';
import { deleteCustomer, getCustomer, listCustomers, requireCustomer, touchCustomer, updateCustomer, upsertCustomer } from '../services/customers.ts';
import { checkFeature, resolveCustomerEntitlements, snapshotForLicense } from '../services/entitlements.ts';
import {
  activateLicense,
  createLicense,
  deactivateLicense,
  listLicenses,
  loadLicenseContext,
  requireLicense,
  setLicenseStatus,
  updateLicense,
  validateLicense,
  type LicenseAction,
} from '../services/licenses.ts';
import { bump } from '../services/stats.ts';
import { receiveStripeWebhook } from '../services/stripe/webhooks.ts';
import { recordUsage } from '../services/usage.ts';
import { assertWithinPlan, ownerOf } from '../services/cloud-billing.ts';
import type { Actor, ApiKeyRow, ApiKeyType, Ctx, ProjectRow } from '../types.ts';
import {
  list,
  serializeActivation,
  serializeCheck,
  serializeCustomer,
  serializeEntitlements,
  serializeLicense,
  serializeProduct,
} from './serializers.ts';

export type ApiEnv = { Variables: { apiKey: ApiKeyRow; project: ProjectRow } };
type ApiContext = Context<ApiEnv>;

const actorFor = (c: ApiContext): Actor => {
  const key = c.get('apiKey');
  return { type: 'api_key', id: key.id, label: `${key.name} (${key.token_prefix})` };
};

/** Accept JSON (preferred) or form-encoded bodies, so `curl -d key=value` works too. */
async function readBody(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await c.req.parseBody();
    return Object.fromEntries(Object.entries(form).filter(([, v]) => typeof v === 'string'));
  }
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw badRequest('invalid_json', 'Request body must be a JSON object.');
  }
}

export function createApi(ctx: Ctx): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();
  const secretLimiter = new RateLimiter(ctx.config.rateLimits.secretKey, 60_000, () => ctx.now().getTime());
  const publicLimiter = new RateLimiter(ctx.config.rateLimits.publicLicense, 60_000, () => ctx.now().getTime());

  const auth = (allowed: ApiKeyType[]): MiddlewareHandler<ApiEnv> => async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = (/^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, '') : (c.req.header('x-api-key') ?? '')).trim();
    if (!token) throw unauthorized('Missing API key. Send it as "Authorization: Bearer <key>".');
    const result = authenticateApiKey(ctx, token);
    if (!result) throw unauthorized('Invalid API key. Check that it is correct and has not been revoked.');
    if (!allowed.includes(result.apiKey.type)) {
      throw forbidden(
        'secret_key_required',
        'This endpoint requires a secret API key (kv_sk_…). Publishable keys can only validate, activate and deactivate licenses.',
      );
    }
    const limit =
      result.apiKey.type === 'secret'
        ? secretLimiter.hit(result.apiKey.id)
        : publicLimiter.hit(`${result.apiKey.id}:${clientIp(c, ctx.config)}`);
    c.header('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSeconds));
      throw tooManyRequests();
    }
    c.set('apiKey', result.apiKey);
    c.set('project', result.project);
    await next();
  };
  const secret = auth(['secret']);
  const anyKey = auth(['secret', 'publishable']);

  api.use(
    '*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: () => {
        throw new ApiError(413, 'invalid_request_error', 'payload_too_large', 'Request body is larger than 1 MB.');
      },
    }),
  );

  api.get('/', (c) =>
    c.json({ object: 'api', version: 'v1', docs: `${ctx.config.publicUrl}/docs/api-reference` }),
  );

  // --- Stripe webhooks (authenticated by signature, not API key) ------------
  api.post('/webhooks/stripe/:projectId', async (c) => {
    const payload = await c.req.text();
    const result = receiveStripeWebhook(ctx, c.req.param('projectId'), payload, c.req.header('stripe-signature'));
    return c.json(result.body, result.status as 200);
  });

  // --- Products ---------------------------------------------------------------
  api.get('/products', secret, (c) => {
    const products = listProducts(ctx, c.get('project').id).map((p) => serializeProduct(loadCatalog(ctx, p)));
    return c.json(list(products, false));
  });

  api.get('/products/:id', secret, (c) => {
    const product = resolveProduct(ctx, c.get('project').id, c.req.param('id'));
    return c.json(serializeProduct(loadCatalog(ctx, product)));
  });

  // --- Customers --------------------------------------------------------------
  api.get('/customers', secret, (c) => {
    const projectId = c.get('project').id;
    const externalId = c.req.query('external_id');
    if (externalId) {
      const customer = getCustomer(ctx, projectId, externalId);
      return c.json(list(customer && customer.external_id === externalId ? [serializeCustomer(customer)] : [], false));
    }
    const result = listCustomers(ctx, projectId, {
      email: c.req.query('email'),
      query: c.req.query('query'),
      limit: int(c.req.query('limit'), 'limit', { min: 1, max: 100 }) ?? 20,
      startingAfter: c.req.query('starting_after'),
    });
    return c.json(list(result.data.map(serializeCustomer), result.hasMore));
  });

  api.post('/customers', secret, async (c) => {
    const body = await readBody(c);
    const { customer, created } = upsertCustomer(
      ctx,
      c.get('project').id,
      { externalId: body.external_id, email: body.email, name: body.name, metadata: body.metadata },
      actorFor(c),
    );
    return c.json(serializeCustomer(customer), created ? 201 : 200);
  });

  api.get('/customers/:id', secret, (c) => {
    return c.json(serializeCustomer(requireCustomer(ctx, c.get('project').id, c.req.param('id'))));
  });

  api.patch('/customers/:id', secret, async (c) => {
    const projectId = c.get('project').id;
    const existing = requireCustomer(ctx, projectId, c.req.param('id'));
    const body = await readBody(c);
    const customer = updateCustomer(
      ctx,
      projectId,
      existing.id,
      { externalId: body.external_id, email: body.email, name: body.name, metadata: body.metadata },
      actorFor(c),
    );
    return c.json(serializeCustomer(customer));
  });

  api.delete('/customers/:id', secret, (c) => {
    const projectId = c.get('project').id;
    const existing = requireCustomer(ctx, projectId, c.req.param('id'));
    deleteCustomer(ctx, projectId, existing.id, actorFor(c));
    return c.json({ object: 'customer', id: existing.id, external_id: existing.external_id, deleted: true });
  });

  // --- Entitlements -----------------------------------------------------------
  api.get('/entitlements', secret, (c) => {
    const projectId = c.get('project').id;
    const customer = str(c.req.query('customer'), 'customer', { required: true, max: 200 });
    const snapshot = resolveCustomerEntitlements(ctx, projectId, { customer, product: c.req.query('product') });
    if (snapshot.customer) touchCustomer(ctx, snapshot.customer);
    bump(ctx, projectId, 'entitlement_checks');
    return c.json(serializeEntitlements(snapshot, customer));
  });

  api.get('/entitlements/check', secret, (c) => {
    const projectId = c.get('project').id;
    const customer = str(c.req.query('customer'), 'customer', { required: true, max: 200 });
    const feature = str(c.req.query('feature'), 'feature', { required: true, max: 63 });
    const quantity = int(c.req.query('quantity'), 'quantity', { min: 1, max: 1_000_000 }) ?? 1;
    const snapshot = resolveCustomerEntitlements(ctx, projectId, { customer, product: c.req.query('product') });
    const result = checkFeature(ctx, snapshot, feature, quantity);
    if (snapshot.customer) touchCustomer(ctx, snapshot.customer);
    bump(ctx, projectId, 'entitlement_checks');
    return c.json(serializeCheck(result, snapshot, customer));
  });

  // --- Usage ------------------------------------------------------------------
  api.post('/usage', secret, async (c) => {
    const body = await readBody(c);
    const result = recordUsage(
      ctx,
      c.get('project').id,
      {
        customer: body.customer,
        licenseKey: body.license_key,
        product: body.product,
        feature: body.feature,
        quantity: body.quantity,
        idempotencyKey: body.idempotency_key ?? c.req.header('idempotency-key'),
      },
      actorFor(c),
    );
    if (result.snapshot.customer) touchCustomer(ctx, result.snapshot.customer);
    const check = serializeCheck({ allowed: result.allowed, code: result.code === 'ok' ? 'ok' : 'limit_exceeded', message: result.message, feature: result.feature }, result.snapshot);
    return c.json({
      object: 'usage',
      allowed: result.allowed,
      code: result.code,
      message: result.message,
      replayed: result.replayed,
      feature: check.feature,
      plan: check.plan,
      customer: check.customer,
    });
  });

  // --- License keys: public operations (publishable or secret key) -----------
  const licenseCors = cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Authorization', 'Content-Type'], maxAge: 86400 });
  for (const path of ['/licenses/validate', '/licenses/activate', '/licenses/deactivate']) api.use(path, licenseCors);

  const validationResponse = (c: ApiContext, result: ReturnType<typeof validateLicense>) => {
    const includeNote = c.get('apiKey').type === 'secret';
    return c.json({
      object: 'license_validation',
      valid: result.valid,
      code: result.code,
      message: result.message,
      license: result.context ? serializeLicense(result.context, { includeNote }) : null,
      activation: serializeActivation(result.activation),
      entitlements: result.valid && result.context ? serializeEntitlements(snapshotForLicense(ctx, result.context)) : null,
    });
  };

  api.post('/licenses/validate', anyKey, async (c) => {
    const body = await readBody(c);
    const result = validateLicense(ctx, c.get('project').id, { key: body.key, fingerprint: body.fingerprint, product: body.product });
    bump(ctx, c.get('project').id, 'license_validations');
    return validationResponse(c, result);
  });

  api.post('/licenses/activate', anyKey, async (c) => {
    const body = await readBody(c);
    const result = activateLicense(
      ctx,
      c.get('project').id,
      { key: body.key, fingerprint: body.fingerprint, name: body.name, product: body.product },
      { ip: clientIp(c, ctx.config) },
      actorFor(c),
    );
    bump(ctx, c.get('project').id, 'license_validations');
    return validationResponse(c, result);
  });

  api.post('/licenses/deactivate', anyKey, async (c) => {
    const body = await readBody(c);
    const result = deactivateLicense(ctx, c.get('project').id, { key: body.key, fingerprint: body.fingerprint }, actorFor(c));
    return c.json({ object: 'license_deactivation', deactivated: result.deactivated });
  });

  // --- Licenses: management (secret key) ---------------------------------------
  api.get('/licenses', secret, (c) => {
    const projectId = c.get('project').id;
    const customerRef = c.req.query('customer');
    const productRef = c.req.query('product');
    const customer = customerRef ? getCustomer(ctx, projectId, customerRef) : null;
    if (customerRef && !customer) return c.json(list([], false));
    const product = productRef ? resolveProduct(ctx, projectId, productRef) : null;
    const result = listLicenses(ctx, projectId, {
      customerId: customer?.id,
      productId: product?.id,
      status: c.req.query('status'),
      limit: int(c.req.query('limit'), 'limit', { min: 1, max: 100 }) ?? 20,
      startingAfter: c.req.query('starting_after'),
    });
    return c.json(list(result.data.map((l) => serializeLicense(loadLicenseContext(ctx, l), { includeNote: true })), result.hasMore));
  });

  api.post('/licenses', secret, async (c) => {
    const body = await readBody(c);
    const owner = ownerOf(ctx, c.get('project').id);
    if (owner) assertWithinPlan(ctx, owner, 'active_licenses');
    const license = createLicense(
      ctx,
      c.get('project').id,
      {
        product: body.product,
        plan: body.plan,
        customer: body.customer,
        expiresAt: body.expires_at,
        durationDays: body.duration_days,
        maxActivations: body.max_activations,
        metadata: body.metadata,
        note: body.note,
      },
      'api',
      actorFor(c),
    );
    return c.json(serializeLicense(loadLicenseContext(ctx, license), { includeNote: true }), 201);
  });

  api.get('/licenses/:id', secret, (c) => {
    const license = requireLicense(ctx, c.get('project').id, c.req.param('id'));
    return c.json(serializeLicense(loadLicenseContext(ctx, license), { includeNote: true }));
  });

  api.patch('/licenses/:id', secret, async (c) => {
    const body = await readBody(c);
    const license = updateLicense(
      ctx,
      c.get('project').id,
      c.req.param('id'),
      { plan: body.plan, expiresAt: body.expires_at, maxActivations: body.max_activations, metadata: body.metadata, note: body.note },
      actorFor(c),
    );
    return c.json(serializeLicense(loadLicenseContext(ctx, license), { includeNote: true }));
  });

  for (const action of ['suspend', 'reinstate', 'revoke'] as LicenseAction[]) {
    api.post(`/licenses/:id/${action}`, secret, async (c) => {
      const body = await readBody(c);
      const reason = str(body.reason, 'reason', { max: 300 }) ?? null;
      const license = setLicenseStatus(ctx, c.get('project').id, c.req.param('id'), action, reason, actorFor(c));
      return c.json(serializeLicense(loadLicenseContext(ctx, license), { includeNote: true }));
    });
  }

  return api;
}
