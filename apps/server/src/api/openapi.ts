/**
 * OpenAPI 3.1 description of the public REST API (v1), served at /openapi.json.
 * Kept next to the routes so changes to one are easy to mirror in the other.
 */

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str = (description?: string, extra: Schema = {}): Schema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const json = (schema: Schema) => ({ 'application/json': { schema } });

function op(opts: {
  id: string;
  summary: string;
  tag: string;
  description?: string;
  auth?: 'secret' | 'any' | 'none';
  params?: Schema[];
  body?: Schema;
  response: Schema;
  status?: string;
}) {
  const security = opts.auth === 'none' ? [] : opts.auth === 'any' ? [{ secretKey: [] }, { publishableKey: [] }] : [{ secretKey: [] }];
  return {
    operationId: opts.id,
    summary: opts.summary,
    tags: [opts.tag],
    ...(opts.description ? { description: opts.description } : {}),
    security,
    ...(opts.params ? { parameters: opts.params } : {}),
    ...(opts.body
      ? {
          requestBody: {
            required: true,
            content: { ...json(opts.body), 'application/x-www-form-urlencoded': { schema: opts.body } },
          },
        }
      : {}),
    responses: {
      [opts.status ?? '200']: { description: 'Success', content: json(opts.response) },
      '400': { $ref: '#/components/responses/Error' },
      '401': { $ref: '#/components/responses/Error' },
      '404': { $ref: '#/components/responses/Error' },
      '429': { $ref: '#/components/responses/Error' },
    },
  };
}

const q = (name: string, description: string, required = false, schema: Schema = { type: 'string' }): Schema => ({
  name,
  in: 'query',
  required,
  description,
  schema,
});
const p = (name: string, description: string): Schema => ({ name, in: 'path', required: true, description, schema: { type: 'string' } });
const listOf = (item: string): Schema => ({
  type: 'object',
  required: ['object', 'data', 'has_more'],
  properties: { object: { const: 'list' }, data: { type: 'array', items: ref(item) }, has_more: { type: 'boolean' } },
});
const pagination = [q('limit', 'Page size, 1 to 100 (default 20).', false, { type: 'integer', minimum: 1, maximum: 100 }), q('starting_after', 'Return objects after this ID.')];

export function openApiSpec(publicUrl: string): Schema {
  const ref_ = { type: 'object', properties: { id: str(), key: str(), name: str() } };
  const customerRef = nullable({ type: 'object', properties: { id: nullable(str()), external_id: nullable(str()), email: nullable(str()) } });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Keyvane API',
      version: '1.0.0',
      description:
        'Licenses, plans, feature access and usage limits for software you sell, kept in sync with Stripe. Business outcomes (limit reached, invalid key) return 200 with `allowed`/`valid` false and a `code`.',
      license: { name: 'MIT (SDK and docs)', url: 'https://opensource.org/license/mit' },
    },
    servers: [{ url: `${publicUrl}/v1` }],
    externalDocs: { description: 'API reference', url: `${publicUrl}/docs/api-reference` },
    tags: [
      { name: 'Entitlements' },
      { name: 'Usage' },
      { name: 'Customers' },
      { name: 'Licenses' },
      { name: 'Products' },
    ],
    paths: {
      '/entitlements': {
        get: op({
          id: 'getEntitlements',
          summary: "Get a customer's entitlements",
          tag: 'Entitlements',
          params: [q('customer', 'Your user ID or a Keyvane customer ID.', true), q('product', 'Product key or ID (optional with one product).')],
          response: ref('Entitlements'),
        }),
      },
      '/entitlements/check': {
        get: op({
          id: 'checkEntitlement',
          summary: 'Check a single feature',
          tag: 'Entitlements',
          params: [
            q('customer', 'Your user ID or a Keyvane customer ID.', true),
            q('feature', 'Feature key.', true),
            q('product', 'Product key or ID.'),
            q('quantity', 'Units needed for metered features (default 1).', false, { type: 'integer', minimum: 1 }),
          ],
          response: ref('EntitlementCheck'),
        }),
      },
      '/usage': {
        post: op({
          id: 'recordUsage',
          summary: 'Check the limit and consume usage atomically',
          tag: 'Usage',
          description: 'Also accepts an `Idempotency-Key` header.',
          body: {
            type: 'object',
            required: ['feature'],
            properties: {
              customer: str('Your user ID. Either customer or license_key is required.'),
              license_key: str('Meter against a license key instead.'),
              feature: str('Metered feature key.'),
              product: str('Product key or ID.'),
              quantity: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
              idempotency_key: str('Makes retries safe.'),
            },
          },
          response: ref('UsageResult'),
        }),
      },
      '/customers': {
        get: op({
          id: 'listCustomers',
          summary: 'List customers',
          tag: 'Customers',
          params: [q('external_id', 'Exact match on your user ID.'), q('email', 'Exact match on email.'), q('query', 'Search ID, email or name.'), ...pagination],
          response: listOf('Customer'),
        }),
        post: op({
          id: 'upsertCustomer',
          summary: 'Create or update a customer by external_id',
          tag: 'Customers',
          body: {
            type: 'object',
            properties: {
              external_id: str('Your user ID.'),
              email: str(),
              name: str(),
              metadata: { type: 'object', additionalProperties: true, description: 'Merged; set a key to null to remove it.' },
            },
          },
          response: ref('Customer'),
        }),
      },
      '/customers/{id}': {
        get: op({ id: 'getCustomer', summary: 'Retrieve a customer', tag: 'Customers', params: [p('id', 'Keyvane ID or your user ID.')], response: ref('Customer') }),
        patch: op({
          id: 'updateCustomer',
          summary: 'Update a customer',
          tag: 'Customers',
          params: [p('id', 'Keyvane ID or your user ID.')],
          body: { type: 'object', properties: { external_id: str(), email: nullable(str()), name: nullable(str()), metadata: { type: 'object', additionalProperties: true } } },
          response: ref('Customer'),
        }),
        delete: op({
          id: 'deleteCustomer',
          summary: 'Delete a customer and their licenses, usage and history',
          tag: 'Customers',
          params: [p('id', 'Keyvane ID or your user ID.')],
          response: { type: 'object', properties: { object: { const: 'customer' }, id: str(), external_id: nullable(str()), deleted: { const: true } } },
        }),
      },
      '/licenses': {
        get: op({
          id: 'listLicenses',
          summary: 'List licenses',
          tag: 'Licenses',
          params: [q('customer', 'Your user ID or customer ID.'), q('product', 'Product key or ID.'), q('status', 'active, suspended or revoked.'), ...pagination],
          response: listOf('License'),
        }),
        post: op({
          id: 'createLicense',
          summary: 'Create a license key',
          tag: 'Licenses',
          status: '201',
          body: {
            type: 'object',
            required: ['plan'],
            properties: {
              plan: str('Plan key or ID.'),
              product: str('Product key or ID.'),
              customer: str('Your user ID; created if new.'),
              expires_at: str('ISO date-time or YYYY-MM-DD.'),
              duration_days: { type: 'integer', minimum: 1 },
              max_activations: { type: 'integer', minimum: 1 },
              metadata: { type: 'object', additionalProperties: true },
              note: str('Internal note.'),
            },
          },
          response: ref('License'),
        }),
      },
      '/licenses/{id}': {
        get: op({ id: 'getLicense', summary: 'Retrieve a license', tag: 'Licenses', params: [p('id', 'License ID.')], response: ref('License') }),
        patch: op({
          id: 'updateLicense',
          summary: 'Update a license',
          tag: 'Licenses',
          params: [p('id', 'License ID.')],
          body: {
            type: 'object',
            properties: {
              plan: str(),
              expires_at: nullable(str()),
              max_activations: nullable({ type: 'integer', minimum: 1 }),
              metadata: { type: 'object', additionalProperties: true },
              note: nullable(str()),
            },
          },
          response: ref('License'),
        }),
      },
      '/licenses/{id}/suspend': {
        post: op({ id: 'suspendLicense', summary: 'Suspend a license (reversible)', tag: 'Licenses', params: [p('id', 'License ID.')], response: ref('License') }),
      },
      '/licenses/{id}/reinstate': {
        post: op({ id: 'reinstateLicense', summary: 'Reinstate a suspended license', tag: 'Licenses', params: [p('id', 'License ID.')], response: ref('License') }),
      },
      '/licenses/{id}/revoke': {
        post: op({ id: 'revokeLicense', summary: 'Revoke a license (permanent)', tag: 'Licenses', params: [p('id', 'License ID.')], response: ref('License') }),
      },
      '/licenses/validate': {
        post: op({
          id: 'validateLicense',
          summary: 'Validate a license key',
          tag: 'Licenses',
          auth: 'any',
          body: { type: 'object', required: ['key'], properties: { key: str(), fingerprint: str('Require this device to be activated.'), product: str() } },
          response: ref('LicenseValidation'),
        }),
      },
      '/licenses/activate': {
        post: op({
          id: 'activateLicense',
          summary: 'Activate a device for a license key',
          tag: 'Licenses',
          auth: 'any',
          body: { type: 'object', required: ['key', 'fingerprint'], properties: { key: str(), fingerprint: str(), name: str(), product: str() } },
          response: ref('LicenseValidation'),
        }),
      },
      '/licenses/deactivate': {
        post: op({
          id: 'deactivateLicense',
          summary: 'Free a device activation',
          tag: 'Licenses',
          auth: 'any',
          body: { type: 'object', required: ['key', 'fingerprint'], properties: { key: str(), fingerprint: str() } },
          response: { type: 'object', properties: { object: { const: 'license_deactivation' }, deactivated: { type: 'boolean' } } },
        }),
      },
      '/products': {
        get: op({ id: 'listProducts', summary: 'List products with plans and features', tag: 'Products', response: listOf('Product') }),
      },
      '/products/{id}': {
        get: op({ id: 'getProduct', summary: 'Retrieve a product', tag: 'Products', params: [p('id', 'Product ID or key.')], response: ref('Product') }),
      },
    },
    components: {
      securitySchemes: {
        secretKey: { type: 'http', scheme: 'bearer', description: 'Secret key (kv_sk_…). Server-side only.' },
        publishableKey: { type: 'http', scheme: 'bearer', description: 'Publishable key (kv_pk_…). License validate/activate/deactivate only.' },
      },
      responses: {
        Error: {
          description: 'Error',
          content: json({
            type: 'object',
            properties: { error: { type: 'object', properties: { type: str(), code: str(), message: str(), param: str() } } },
          }),
        },
      },
      schemas: {
        Ref: ref_,
        Feature: {
          type: 'object',
          properties: {
            name: str(),
            type: { enum: ['boolean', 'metered'] },
            enabled: { type: 'boolean' },
            limit: nullable({ type: 'integer' }),
            used: { type: 'integer' },
            remaining: nullable({ type: 'integer' }),
            reset_period: { enum: ['day', 'month', 'year', 'never'] },
            resets_at: nullable(str()),
            unit: nullable(str()),
          },
        },
        Entitlements: {
          type: 'object',
          properties: {
            object: { const: 'entitlements' },
            customer: customerRef,
            product: ref('Ref'),
            plan: nullable(ref('Ref')),
            source: { enum: ['license', 'default_plan', 'none'] },
            license: nullable({ type: 'object', properties: { id: str(), status: str(), access_until: nullable(str()) } }),
            subscription: nullable({ type: 'object', additionalProperties: true }),
            features: { type: 'object', additionalProperties: ref('Feature') },
            checked_at: str(),
          },
        },
        EntitlementCheck: {
          type: 'object',
          properties: {
            object: { const: 'entitlement_check' },
            allowed: { type: 'boolean' },
            code: { enum: ['ok', 'not_included', 'limit_exceeded'] },
            message: str(),
            feature: ref('Feature'),
            plan: nullable(ref('Ref')),
            customer: customerRef,
          },
        },
        UsageResult: {
          type: 'object',
          properties: {
            object: { const: 'usage' },
            allowed: { type: 'boolean' },
            code: { enum: ['ok', 'limit_exceeded', 'not_included', 'license_invalid'] },
            message: str(),
            replayed: { type: 'boolean' },
            feature: ref('Feature'),
            plan: nullable(ref('Ref')),
            customer: customerRef,
          },
        },
        Customer: {
          type: 'object',
          properties: {
            object: { const: 'customer' },
            id: str(),
            external_id: nullable(str()),
            email: nullable(str()),
            name: nullable(str()),
            stripe_customer_id: nullable(str()),
            metadata: { type: 'object', additionalProperties: true },
            last_seen_at: nullable(str()),
            created_at: str(),
            updated_at: str(),
          },
        },
        License: {
          type: 'object',
          properties: {
            object: { const: 'license' },
            id: str(),
            key: str('KV-XXXXX-XXXXX-XXXXX-XXXXX'),
            valid: { type: 'boolean' },
            status: { enum: ['active', 'trialing', 'past_due', 'canceled', 'expired', 'inactive', 'suspended', 'revoked'] },
            status_message: str(),
            access_until: nullable(str()),
            product: ref('Ref'),
            plan: nullable(ref('Ref')),
            customer: customerRef,
            source: { enum: ['dashboard', 'api', 'stripe'] },
            expires_at: nullable(str()),
            max_activations: nullable({ type: 'integer' }),
            activations: { type: 'integer' },
            subscription: nullable({ type: 'object', additionalProperties: true }),
            metadata: { type: 'object', additionalProperties: true },
            note: nullable(str('Secret keys only.')),
            last_validated_at: nullable(str()),
            created_at: str(),
            updated_at: str(),
          },
        },
        LicenseValidation: {
          type: 'object',
          properties: {
            object: { const: 'license_validation' },
            valid: { type: 'boolean' },
            code: {
              enum: ['valid', 'not_found', 'revoked', 'suspended', 'expired', 'subscription_canceled', 'payment_overdue', 'subscription_inactive', 'product_mismatch', 'not_activated', 'activation_limit_reached'],
            },
            message: str(),
            license: nullable(ref('License')),
            activation: nullable({ type: 'object', properties: { id: str(), fingerprint: str(), name: nullable(str()) } }),
            entitlements: nullable(ref('Entitlements')),
          },
        },
        Product: {
          type: 'object',
          properties: {
            object: { const: 'product' },
            id: str(),
            key: str(),
            name: str(),
            description: nullable(str()),
            default_plan: nullable(str()),
            cancellation_policy: { enum: ['immediate', 'period_end'] },
            grace_period_days: { type: 'integer' },
            plans: { type: 'array', items: { type: 'object', additionalProperties: true } },
            features: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
      },
    },
  };
}
