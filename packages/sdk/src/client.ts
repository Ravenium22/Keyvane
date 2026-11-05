import { Entitlements } from './entitlements.ts';
import { errorFromResponse, KeyvaneConnectionError, KeyvaneError } from './errors.ts';
import type {
  Customer,
  EntitlementCheck,
  EntitlementsData,
  License,
  LicenseValidationData,
  List,
  Metadata,
  Product,
  UsageResult,
} from './types.ts';

export const VERSION = '0.1.0';

export interface KeyvaneOptions {
  /**
   * A secret key (`kv_sk_…`) on your server, or a publishable key (`kv_pk_…`) in desktop
   * apps, CLIs and browsers. Defaults to the `KEYVANE_SECRET_KEY` or
   * `KEYVANE_PUBLISHABLE_KEY` environment variable.
   */
  apiKey?: string;
  /** Base URL of your Keyvane deployment. Defaults to the `KEYVANE_URL` environment variable. */
  baseUrl?: string;
  /** Per-request timeout. Default: 10 seconds. */
  timeoutMs?: number;
  /** How often to retry network errors, 429s and 5xx responses on safe requests. Default: 2. */
  maxRetries?: number;
  /** Cache `entitlements.get()` results for this long. Default: 0 (always ask the API). */
  cacheTtlMs?: number;
  /** Custom `fetch` (for tests, proxies or unusual runtimes). Defaults to the global `fetch`. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response> | Response;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: Record<string, unknown>;
  /** Retry on failure. True for GETs and for writes that carry an idempotency key. */
  retry?: boolean;
  idempotencyKey?: string;
}

function env(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name] || undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Remove undefined values and convert camelCase keys to the API's snake_case. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

export class Keyvane {
  readonly customers: Customers;
  readonly entitlements: EntitlementsResource;
  readonly usage: UsageResource;
  readonly licenses: Licenses;
  readonly products: Products;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: NonNullable<KeyvaneOptions['fetch']>;
  /** @internal */
  readonly cache: EntitlementCache;

  constructor(options: KeyvaneOptions = {}) {
    const apiKey = options.apiKey ?? env('KEYVANE_SECRET_KEY') ?? env('KEYVANE_PUBLISHABLE_KEY') ?? env('KEYVANE_API_KEY');
    const baseUrl = options.baseUrl ?? env('KEYVANE_URL');
    if (!apiKey) {
      throw new KeyvaneError('Missing API key. Pass `apiKey` or set KEYVANE_SECRET_KEY (server) / KEYVANE_PUBLISHABLE_KEY (apps).');
    }
    if (!baseUrl) {
      throw new KeyvaneError('Missing base URL. Pass `baseUrl` (e.g. https://keyvane.example.com) or set KEYVANE_URL.');
    }
    const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!fetchImpl) throw new KeyvaneError('No fetch implementation found. Use Node.js 18+ or pass `fetch`.');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.fetchImpl = fetchImpl;
    this.cache = new EntitlementCache(options.cacheTtlMs ?? 0);
    this.customers = new Customers(this);
    this.entitlements = new EntitlementsResource(this);
    this.usage = new UsageResource(this);
    this.licenses = new Licenses(this);
    this.products = new Products(this);
  }

  /** @internal Low-level request helper used by every resource. */
  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/v1${path}`);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    let body: string | undefined;
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    const canRetry = opts.retry ?? method === 'GET';

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), { method, headers, body, signal: controller.signal });
      } catch (cause) {
        clearTimeout(timer);
        const timedOut = controller.signal.aborted;
        if (canRetry && attempt < this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw new KeyvaneConnectionError(
          timedOut ? `Keyvane did not respond within ${this.timeoutMs} ms.` : `Could not reach Keyvane at ${this.baseUrl}.`,
          { cause },
        );
      }
      clearTimeout(timer);
      const requestId = response.headers.get('x-request-id') ?? undefined;
      const text = await response.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }
      if (response.ok) {
        if (parsed === undefined) throw new KeyvaneError('Keyvane returned an invalid response.', { status: response.status, requestId });
        return parsed as T;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (canRetry && retryable && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : this.backoff(attempt));
        continue;
      }
      throw errorFromResponse(response.status, parsed, requestId);
    }
  }

  private backoff(attempt: number): number {
    return Math.min(250 * 2 ** attempt, 4000) + Math.floor(Math.random() * 100);
  }
}

class EntitlementCache {
  private readonly ttl: number;
  private readonly entries = new Map<string, { expires: number; value: EntitlementsData }>();
  constructor(ttl: number) {
    this.ttl = ttl;
  }
  key(customer: string, product?: string) {
    return `${customer}\u0000${product ?? ''}`;
  }
  get(key: string): EntitlementsData | undefined {
    if (this.ttl <= 0) return undefined;
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: EntitlementsData) {
    if (this.ttl > 0) this.entries.set(key, { expires: Date.now() + this.ttl, value });
  }
  invalidate(customer: string) {
    for (const key of this.entries.keys()) if (key.startsWith(`${customer}\u0000`)) this.entries.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface CustomerParams {
  /** Your own user ID. */
  externalId?: string;
  email?: string | null;
  name?: string | null;
  metadata?: Metadata;
}

class Customers {
  private readonly client: Keyvane;
  constructor(client: Keyvane) {
    this.client = client;
  }

  /** Create a customer, or update the one with the same `externalId`. Call it when users sign up. */
  upsert(params: CustomerParams & { externalId: string }): Promise<Customer> {
    return this.client.request('POST', '/customers', { body: compact({ ...params }), retry: true });
  }

  /** Retrieve by Keyvane ID (`cust_…`) or by your own user ID. */
  retrieve(idOrExternalId: string): Promise<Customer> {
    return this.client.request('GET', `/customers/${encodeURIComponent(idOrExternalId)}`);
  }

  update(idOrExternalId: string, params: CustomerParams): Promise<Customer> {
    return this.client.request('PATCH', `/customers/${encodeURIComponent(idOrExternalId)}`, { body: compact({ ...params }) });
  }

  list(params: { limit?: number; startingAfter?: string; email?: string; query?: string } = {}): Promise<List<Customer>> {
    return this.client.request('GET', '/customers', { query: compact({ ...params }) as Query });
  }

  /**
   * Permanently delete a customer with their licenses, devices, usage and history
   * (for GDPR/KVKK erasure requests). Stripe subscriptions are not touched.
   */
  async delete(idOrExternalId: string): Promise<{ object: 'customer'; id: string; external_id: string | null; deleted: true }> {
    const result = await this.client.request<{ object: 'customer'; id: string; external_id: string | null; deleted: true }>(
      'DELETE',
      `/customers/${encodeURIComponent(idOrExternalId)}`,
    );
    this.client.cache.invalidate(idOrExternalId);
    return result;
  }
}

class EntitlementsResource {
  private readonly client: Keyvane;
  constructor(client: Keyvane) {
    this.client = client;
  }

  /**
   * What may this customer do right now? `customer` is your own user ID.
   * `product` (id or key) is only needed when your project has several products.
   */
  async get(params: { customer: string; product?: string }): Promise<Entitlements> {
    const cacheKey = this.client.cache.key(params.customer, params.product);
    const cached = this.client.cache.get(cacheKey);
    if (cached) return new Entitlements(cached);
    const data = await this.client.request<EntitlementsData>('GET', '/entitlements', { query: { ...params } });
    this.client.cache.set(cacheKey, data);
    return new Entitlements(data);
  }

  /** Server-side check of a single feature (optionally for `quantity` metered units). */
  check(params: { customer: string; feature: string; product?: string; quantity?: number }): Promise<EntitlementCheck> {
    return this.client.request('GET', '/entitlements/check', { query: { ...params } });
  }
}

export interface RecordUsageParams {
  /** Your own user ID. Either `customer` or `licenseKey` is required. */
  customer?: string;
  /** Meter usage against a license key instead of a customer. */
  licenseKey?: string;
  feature: string;
  product?: string;
  /** Units to consume. Default 1. */
  quantity?: number;
  /** Makes retries safe: the same key is never counted twice. */
  idempotencyKey?: string;
}

class UsageResource {
  private readonly client: Keyvane;
  constructor(client: Keyvane) {
    this.client = client;
  }

  /**
   * Check the limit and consume units in one atomic step. Resolves with `allowed: false`
   * (it does not throw) when the limit is reached or the plan does not include the feature.
   */
  async record(params: RecordUsageParams): Promise<UsageResult> {
    const { idempotencyKey, ...rest } = params;
    const result = await this.client.request<UsageResult>('POST', '/usage', {
      body: compact({ ...rest, idempotencyKey }),
      idempotencyKey,
      retry: !!idempotencyKey,
    });
    if (params.customer) this.client.cache.invalidate(params.customer);
    return result;
  }
}

export interface CreateLicenseParams {
  /** Plan key or ID, e.g. 'pro'. */
  plan: string;
  /** Product key or ID (optional when the project has one product). */
  product?: string;
  /** Your user ID; the customer is created if needed. Omit for a standalone key. */
  customer?: string;
  expiresAt?: string | Date;
  durationDays?: number;
  maxActivations?: number;
  metadata?: Metadata;
  /** Internal note, never shown to publishable keys. */
  note?: string;
}

export class LicenseValidation {
  readonly data: LicenseValidationData;
  /** Entitlements granted by the license, when it is valid. */
  readonly entitlements: Entitlements | null;
  constructor(data: LicenseValidationData) {
    this.data = data;
    this.entitlements = data.entitlements ? new Entitlements(data.entitlements) : null;
  }
  get valid(): boolean {
    return this.data.valid;
  }
  get code(): LicenseValidationData['code'] {
    return this.data.code;
  }
  get message(): string {
    return this.data.message;
  }
  get license(): License | null {
    return this.data.license;
  }
  get activation(): LicenseValidationData['activation'] {
    return this.data.activation;
  }
  toJSON(): LicenseValidationData {
    return this.data;
  }
}

class Licenses {
  private readonly client: Keyvane;
  constructor(client: Keyvane) {
    this.client = client;
  }

  create(params: CreateLicenseParams): Promise<License> {
    return this.client.request('POST', '/licenses', { body: compact({ ...params }) });
  }

  retrieve(id: string): Promise<License> {
    return this.client.request('GET', `/licenses/${encodeURIComponent(id)}`);
  }

  list(params: { customer?: string; product?: string; status?: 'active' | 'suspended' | 'revoked'; limit?: number; startingAfter?: string } = {}): Promise<List<License>> {
    return this.client.request('GET', '/licenses', { query: compact({ ...params }) as Query });
  }

  update(id: string, params: { plan?: string; expiresAt?: string | Date | null; maxActivations?: number | null; metadata?: Metadata; note?: string | null }): Promise<License> {
    return this.client.request('PATCH', `/licenses/${encodeURIComponent(id)}`, { body: compact({ ...params }) });
  }

  /** Temporarily disable a license (reversible with `reinstate`). */
  suspend(id: string, params: { reason?: string } = {}): Promise<License> {
    return this.client.request('POST', `/licenses/${encodeURIComponent(id)}/suspend`, { body: compact({ ...params }) });
  }

  reinstate(id: string): Promise<License> {
    return this.client.request('POST', `/licenses/${encodeURIComponent(id)}/reinstate`, { body: {} });
  }

  /** Permanently revoke a license. */
  revoke(id: string, params: { reason?: string } = {}): Promise<License> {
    return this.client.request('POST', `/licenses/${encodeURIComponent(id)}/revoke`, { body: compact({ ...params }) });
  }

  /**
   * Validate a license key (works with a publishable key). Pass `fingerprint` to also
   * require that this device is activated.
   */
  async validate(params: { key: string; fingerprint?: string; product?: string }): Promise<LicenseValidation> {
    return new LicenseValidation(await this.client.request('POST', '/licenses/validate', { body: compact({ ...params }), retry: true }));
  }

  /** Register this device for the license (idempotent). Fails with `activation_limit_reached` when full. */
  async activate(params: { key: string; fingerprint: string; name?: string; product?: string }): Promise<LicenseValidation> {
    return new LicenseValidation(await this.client.request('POST', '/licenses/activate', { body: compact({ ...params }), retry: true }));
  }

  /** Free up this device's activation slot. */
  deactivate(params: { key: string; fingerprint: string }): Promise<{ object: 'license_deactivation'; deactivated: boolean }> {
    return this.client.request('POST', '/licenses/deactivate', { body: compact({ ...params }), retry: true });
  }
}

class Products {
  private readonly client: Keyvane;
  constructor(client: Keyvane) {
    this.client = client;
  }

  list(): Promise<List<Product>> {
    return this.client.request('GET', '/products');
  }

  /** Retrieve a product by ID or key, including its plans, features and entitlement matrix. */
  retrieve(idOrKey: string): Promise<Product> {
    return this.client.request('GET', `/products/${encodeURIComponent(idOrKey)}`);
  }
}
