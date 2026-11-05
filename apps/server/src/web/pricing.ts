/**
 * Keyvane's own pricing (from the business plan, section 9). This is a pre-market-test
 * hypothesis — edit it here and the landing page updates. Limits are documented, not yet
 * enforced, while Keyvane is in public beta (see docs/pricing-and-licensing.md).
 */
export interface PricingTier {
  key: 'developer' | 'indie' | 'startup' | 'business';
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  cta: 'signup' | 'contact';
  featured?: boolean;
}

export const PRICING: PricingTier[] = [
  {
    key: 'developer',
    name: 'Developer',
    price: '$0',
    description: 'For trying Keyvane and for open-source projects.',
    features: ['1 product', 'Basic license management', 'Limited active licenses', 'Core SDK & API integration', 'Community support'],
    cta: 'signup',
  },
  {
    key: 'indie',
    name: 'Indie',
    price: '$19',
    period: '/month',
    description: 'For independent developers earning their first revenue.',
    features: ['Multiple products', 'Higher license limits', 'Stripe subscription sync', 'Feature access control & usage limits', 'Basic analytics'],
    cta: 'signup',
    featured: true,
  },
  {
    key: 'startup',
    name: 'Startup',
    price: '$59',
    period: '/month',
    description: 'For growing products with more customers and a team.',
    features: ['High license volume', 'Team members', 'Advanced usage tracking', 'Audit log', 'Priority support'],
    cta: 'signup',
  },
  {
    key: 'business',
    name: 'Business',
    price: 'Custom',
    description: 'For advanced security and contractual needs.',
    features: ['Custom limits', 'Contract-based support', 'Security & access options', 'Custom integrations'],
    cta: 'contact',
  },
];
