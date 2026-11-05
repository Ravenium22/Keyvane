import type { Config } from './config.ts';
import type { Db } from './db/sqlite.ts';
import type { ResetPeriod } from './lib/time.ts';

/** Everything a service needs. `now` is injectable so tests can travel in time. */
export interface Ctx {
  db: Db;
  config: Config;
  now: () => Date;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  owner_id: string;
  stripe_webhook_secret: string | null;
  stripe_connected_at: string | null;
  stripe_last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ApiKeyType = 'secret' | 'publishable';

export interface ApiKeyRow {
  id: string;
  project_id: string;
  type: ApiKeyType;
  name: string;
  token_hash: string;
  token_prefix: string;
  token_plain: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type CancellationPolicy = 'immediate' | 'period_end';

export interface ProductRow {
  id: string;
  project_id: string;
  key: string;
  name: string;
  description: string | null;
  default_plan_id: string | null;
  cancellation_policy: CancellationPolicy;
  grace_period_days: number;
  created_at: string;
  updated_at: string;
}

export type BillingInterval = 'month' | 'year' | 'one_time';

export interface PlanRow {
  id: string;
  project_id: string;
  product_id: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  price_amount: number | null;
  currency: string;
  billing_interval: BillingInterval | null;
  max_activations: number | null;
  stripe_price_ids: string;
  created_at: string;
  updated_at: string;
}

export type FeatureType = 'boolean' | 'metered';

export interface FeatureRow {
  id: string;
  project_id: string;
  product_id: string;
  key: string;
  name: string;
  description: string | null;
  type: FeatureType;
  reset_period: ResetPeriod;
  unit: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanFeatureRow {
  plan_id: string;
  feature_id: string;
  enabled: number;
  limit_value: number | null;
}

export interface CustomerRow {
  id: string;
  project_id: string;
  external_id: string | null;
  email: string | null;
  name: string | null;
  stripe_customer_id: string | null;
  metadata: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  project_id: string;
  customer_id: string | null;
  provider: string;
  provider_subscription_id: string;
  provider_customer_id: string | null;
  status: string;
  price_ids: string;
  amount: number | null;
  currency: string | null;
  billing_interval: string | null;
  interval_count: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  trial_end: string | null;
  past_due_since: string | null;
  livemode: number;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export type LicenseStatus = 'active' | 'suspended' | 'revoked';
export type LicenseSource = 'dashboard' | 'api' | 'stripe';

export interface LicenseRow {
  id: string;
  project_id: string;
  product_id: string;
  plan_id: string;
  customer_id: string | null;
  subscription_id: string | null;
  key: string;
  status: LicenseStatus;
  source: LicenseSource;
  expires_at: string | null;
  max_activations: number | null;
  metadata: string;
  note: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivationRow {
  id: string;
  project_id: string;
  license_id: string;
  fingerprint: string;
  name: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
}

export type WebhookStatus = 'pending' | 'processed' | 'ignored' | 'failed';

export interface WebhookEventRow {
  id: string;
  project_id: string;
  provider: string;
  provider_event_id: string;
  type: string;
  livemode: number;
  status: WebhookStatus;
  message: string | null;
  attempts: number;
  payload: string;
  event_created_at: string | null;
  received_at: string;
  processed_at: string | null;
}

export interface AuditLogRow {
  id: string;
  project_id: string;
  actor_type: string;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  data: string;
  created_at: string;
}

/** Who performed an action, for the audit log. */
export type Actor =
  | { type: 'user'; id: string; label: string }
  | { type: 'api_key'; id: string; label: string }
  | { type: 'stripe'; id?: string; label?: string }
  | { type: 'system'; label?: string };
