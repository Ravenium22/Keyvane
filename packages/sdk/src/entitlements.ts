import type { CustomerRef, EntitlementsData, FeatureEntitlement, Ref, SubscriptionSummary } from './types.ts';

/**
 * A customer's access at a point in time, with helpers so your code reads naturally:
 *
 *   if (access.can('export')) …
 *   access.remaining('pdf_analysis')   // 488, or null for unlimited
 *   access.isOnPlan('pro', 'business')
 */
export class Entitlements {
  readonly data: EntitlementsData;

  constructor(data: EntitlementsData) {
    this.data = data;
  }

  get plan(): Ref | null {
    return this.data.plan;
  }
  get product(): Ref {
    return this.data.product;
  }
  get customer(): CustomerRef | null {
    return this.data.customer;
  }
  get source(): EntitlementsData['source'] {
    return this.data.source;
  }
  get license(): EntitlementsData['license'] {
    return this.data.license;
  }
  get subscription(): SubscriptionSummary | null {
    return this.data.subscription;
  }
  get features(): Record<string, FeatureEntitlement> {
    return this.data.features;
  }

  feature(key: string): FeatureEntitlement | undefined {
    return this.data.features[key];
  }

  /**
   * True if the feature is included in the customer's plan and, for metered features,
   * at least `quantity` units remain. Unknown feature keys return false.
   */
  can(key: string, quantity = 1): boolean {
    const f = this.data.features[key];
    if (!f || !f.enabled) return false;
    if (f.type === 'boolean') return true;
    return f.remaining === null || f.remaining >= quantity;
  }

  /** Units left in the current period: `null` = unlimited, 0 when not included. */
  remaining(key: string): number | null {
    const f = this.data.features[key];
    if (!f || !f.enabled) return 0;
    if (f.type === 'boolean') return null;
    return f.remaining;
  }

  /** The metered limit: `null` = unlimited, 0 when not included. */
  limit(key: string): number | null {
    const f = this.data.features[key];
    if (!f || !f.enabled) return 0;
    return f.type === 'metered' ? f.limit : null;
  }

  /** Units used in the current period (0 for on/off features). */
  used(key: string): number {
    const f = this.data.features[key];
    return f?.type === 'metered' ? f.used : 0;
  }

  /** True if the customer's current plan key is one of `planKeys`. */
  isOnPlan(...planKeys: string[]): boolean {
    return !!this.data.plan && planKeys.includes(this.data.plan.key);
  }

  toJSON(): EntitlementsData {
    return this.data;
  }
}
