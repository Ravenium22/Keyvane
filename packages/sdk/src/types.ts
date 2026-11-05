/** Response objects mirror the REST API (snake_case). See docs/api-reference.md. */

export type Metadata = Record<string, string | number | boolean | null>;

export interface List<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
}

export interface Ref {
  id: string;
  key: string;
  name: string;
}

export interface CustomerRef {
  id: string | null;
  external_id: string | null;
  email: string | null;
}

export interface Customer {
  object: 'customer';
  id: string;
  external_id: string | null;
  email: string | null;
  name: string | null;
  stripe_customer_id: string | null;
  metadata: Metadata;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ResetPeriod = 'day' | 'month' | 'year' | 'never';

export interface BooleanFeatureEntitlement {
  name: string;
  type: 'boolean';
  enabled: boolean;
}

export interface MeteredFeatureEntitlement {
  name: string;
  type: 'metered';
  enabled: boolean;
  /** `null` means unlimited. */
  limit: number | null;
  used: number;
  /** `null` means unlimited. */
  remaining: number | null;
  reset_period: ResetPeriod;
  resets_at: string | null;
  unit: string | null;
}

export type FeatureEntitlement = BooleanFeatureEntitlement | MeteredFeatureEntitlement;

export interface SubscriptionSummary {
  provider: string;
  id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  price_ids: string[];
}

export type LicenseStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'inactive'
  | 'suspended'
  | 'revoked';

export interface EntitlementsData {
  object: 'entitlements';
  customer: CustomerRef | null;
  product: Ref;
  plan: Ref | null;
  /** Where the plan comes from: a license, the product's default plan, or nothing. */
  source: 'license' | 'default_plan' | 'none';
  license: { id: string; status: LicenseStatus; access_until: string | null } | null;
  subscription: SubscriptionSummary | null;
  features: Record<string, FeatureEntitlement>;
  checked_at: string;
}

export interface EntitlementCheck {
  object: 'entitlement_check';
  allowed: boolean;
  code: 'ok' | 'not_included' | 'limit_exceeded';
  message: string;
  feature: FeatureEntitlement & { key: string };
  plan: Ref | null;
  customer: CustomerRef | null;
}

export interface UsageResult {
  object: 'usage';
  allowed: boolean;
  code: 'ok' | 'limit_exceeded' | 'not_included' | 'license_invalid';
  message: string;
  /** True when the idempotency key was already used and nothing new was recorded. */
  replayed: boolean;
  feature: FeatureEntitlement & { key: string };
  plan: Ref | null;
  customer: CustomerRef | null;
}

export interface License {
  object: 'license';
  id: string;
  key: string;
  valid: boolean;
  status: LicenseStatus;
  status_message: string;
  access_until: string | null;
  product: Ref;
  plan: Ref | null;
  customer: CustomerRef | null;
  source: 'dashboard' | 'api' | 'stripe';
  expires_at: string | null;
  max_activations: number | null;
  activations: number;
  subscription: SubscriptionSummary | null;
  metadata: Metadata;
  /** Only returned to secret keys. */
  note?: string | null;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ValidationCode =
  | 'valid'
  | 'not_found'
  | 'revoked'
  | 'suspended'
  | 'expired'
  | 'subscription_canceled'
  | 'payment_overdue'
  | 'subscription_inactive'
  | 'product_mismatch'
  | 'not_activated'
  | 'activation_limit_reached';

export interface Activation {
  object: 'activation';
  id: string;
  fingerprint: string;
  name: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface LicenseValidationData {
  object: 'license_validation';
  valid: boolean;
  code: ValidationCode;
  message: string;
  license: License | null;
  activation: Activation | null;
  entitlements: EntitlementsData | null;
}

export interface Feature {
  object: 'feature';
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: 'boolean' | 'metered';
  reset_period?: ResetPeriod;
  unit?: string | null;
}

export interface Plan {
  object: 'plan';
  id: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  price: { amount: number; currency: string; interval: 'month' | 'year' | 'one_time' | null } | null;
  max_activations: number | null;
  stripe_price_ids: string[];
  is_default: boolean;
  entitlements: Record<string, { enabled: boolean; limit?: number | null }>;
}

export interface Product {
  object: 'product';
  id: string;
  key: string;
  name: string;
  description: string | null;
  default_plan: string | null;
  cancellation_policy: 'immediate' | 'period_end';
  grace_period_days: number;
  plans: Plan[];
  features: Feature[];
  created_at: string;
  updated_at: string;
}
