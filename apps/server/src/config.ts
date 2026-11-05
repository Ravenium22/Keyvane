import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBase62 } from './lib/crypto.ts';

export type Environment = 'development' | 'production' | 'test';

export interface Config {
  env: Environment;
  host: string;
  port: number;
  /** Public base URL of this deployment, used for webhook URLs, docs snippets and cookies. */
  publicUrl: string;
  databasePath: string;
  /** Master secret used to derive encryption and cookie-signing keys. */
  secret: string;
  trustProxy: boolean;
  signupsEnabled: boolean;
  githubUrl: string;
  contactEmail: string | null;
  /** Legal entity name. When set, /legal/privacy and /legal/terms are published. */
  legalEntity: string | null;
  legalJurisdiction: string;
  legalUpdated: string;
  analytics: {
    /** Cookieless Plausible analytics on public pages (never in the dashboard). */
    plausibleDomain: string | null;
  };
  mail: {
    /** Resend API key. Without it, emails are written to the server log. */
    resendApiKey: string | null;
    from: string;
  };
  retention: {
    /** Days to keep raw payloads of successfully processed Stripe events. */
    webhookPayloadDays: number;
    /** Days to keep individual usage events (counters are kept). */
    usageEventDays: number;
  };
  /** Optional: this instance bills its own users (Keyvane Cloud) with one of its projects. */
  billing: {
    projectId: string | null;
    productKey: string;
    /** Plan key -> Stripe Payment Link URL. */
    upgradeLinks: Record<string, string>;
    portalUrl: string | null;
    enforceLimits: boolean;
  };
  /** Emails that can open /admin. */
  adminEmails: string[];
  /** Log one line per request (JSON in production). */
  requestLogging: boolean;
  rateLimits: {
    /** Requests per minute per secret API key. */
    secretKey: number;
    /** Requests per minute per IP for publishable-key license endpoints. */
    publicLicense: number;
    /** Login / signup attempts per 15 minutes per IP. */
    auth: number;
  };
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : fallback;
}

/** "indie=https://buy.stripe.com/a,startup=https://buy.stripe.com/b" -> { indie: …, startup: … } */
function parseLinks(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (value ?? '').split(',')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const url = pair.slice(index + 1).trim();
    if (key && /^https:\/\//.test(url)) out[key] = url;
  }
  return out;
}

/** In development we generate and persist a secret so restarts keep sessions and encrypted data valid. */
function developmentSecret(databasePath: string): string {
  const file = resolve(dirname(databasePath), 'secret.key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBase62(48);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret + '\n', { mode: 0o600 });
  return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv: Environment =
    env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const port = envInt(env.PORT, 8787);
  const databasePath =
    env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(env.DATABASE_PATH || '.data/keyvane.db');

  let secret = env.KEYVANE_SECRET ?? '';
  if (!secret) {
    if (nodeEnv === 'production') {
      throw new Error('KEYVANE_SECRET must be set in production (use at least 32 random characters).');
    }
    secret = databasePath === ':memory:' ? randomBase62(48) : developmentSecret(databasePath);
  }
  if (nodeEnv === 'production' && secret.length < 32) {
    throw new Error('KEYVANE_SECRET must be at least 32 characters long.');
  }

  return {
    env: nodeEnv,
    host: env.HOST || '0.0.0.0',
    port,
    publicUrl: (env.KEYVANE_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    databasePath,
    secret,
    trustProxy: envBool(env.TRUST_PROXY, false),
    signupsEnabled: envBool(env.SIGNUPS_ENABLED, true),
    githubUrl: env.KEYVANE_GITHUB_URL || 'https://github.com/Ravenium22/keyvane',
    contactEmail: env.KEYVANE_CONTACT_EMAIL || null,
    legalEntity: env.KEYVANE_LEGAL_ENTITY || null,
    legalJurisdiction: env.KEYVANE_LEGAL_JURISDICTION || 'the State of Delaware, United States',
    legalUpdated: env.KEYVANE_LEGAL_UPDATED || '2026-11-05',
    analytics: { plausibleDomain: env.KEYVANE_PLAUSIBLE_DOMAIN || null },
    mail: {
      resendApiKey: env.RESEND_API_KEY || null,
      from: env.MAIL_FROM || 'Keyvane <no-reply@keyvane.local>',
    },
    retention: {
      webhookPayloadDays: envInt(env.RETENTION_WEBHOOK_PAYLOAD_DAYS, 90),
      usageEventDays: envInt(env.RETENTION_USAGE_EVENT_DAYS, 400),
    },
    requestLogging: envBool(env.REQUEST_LOGGING, nodeEnv !== 'test'),
    billing: {
      projectId: env.KEYVANE_BILLING_PROJECT || null,
      productKey: env.KEYVANE_BILLING_PRODUCT || 'keyvane-cloud',
      upgradeLinks: parseLinks(env.KEYVANE_UPGRADE_LINKS),
      portalUrl: env.KEYVANE_BILLING_PORTAL_URL || null,
      enforceLimits: envBool(env.KEYVANE_ENFORCE_PLAN_LIMITS, false),
    },
    adminEmails: (env.KEYVANE_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    rateLimits: {
      secretKey: envInt(env.RATE_LIMIT_SECRET_KEY, 1200),
      publicLicense: envInt(env.RATE_LIMIT_PUBLIC_LICENSE, 120),
      auth: envInt(env.RATE_LIMIT_AUTH, 20),
    },
  };
}
