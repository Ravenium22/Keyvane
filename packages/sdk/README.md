# @keyvane/sdk

The official JavaScript/TypeScript SDK for [Keyvane](https://github.com/Ravenium22/Keyvane), the monetization access layer for independent software: licenses, plans, feature access and usage limits, kept in sync with Stripe.

- Zero dependencies, ESM, TypeScript types included
- Node.js 18+, Bun, Deno, edge runtimes and browsers (with a publishable key)
- Typed errors, timeouts and safe automatic retries

```bash
npm install @keyvane/sdk
```

## Server: plans, features and usage limits

```ts
import { Keyvane } from '@keyvane/sdk';

const keyvane = new Keyvane({
  apiKey: process.env.KEYVANE_SECRET_KEY, // kv_sk_…
  baseUrl: process.env.KEYVANE_URL,       // your Keyvane deployment
});

await keyvane.customers.upsert({ externalId: user.id, email: user.email });

const access = await keyvane.entitlements.get({ customer: user.id });
access.plan?.key;                 // 'free' | 'pro' | …
access.can('export');             // boolean
access.remaining('pdf_analysis'); // number, or null for unlimited

const usage = await keyvane.usage.record({
  customer: user.id,
  feature: 'pdf_analysis',
  idempotencyKey: job.id,
});
if (!usage.allowed) console.log(usage.code, usage.message); // 'limit_exceeded', …
```

## Desktop apps and CLIs: license keys

```ts
const keyvane = new Keyvane({ apiKey: 'kv_pk_…', baseUrl: 'https://keyvane.example.com' }); // publishable key

const result = await keyvane.licenses.activate({ key, fingerprint: machineId, name: 'Studio Mac' });
if (result.valid && result.entitlements?.can('export')) {
  // unlock the feature
}
```

## Documentation

- [SDK reference](https://github.com/Ravenium22/Keyvane/blob/main/docs/sdk.md)
- [Quickstart](https://github.com/Ravenium22/Keyvane/blob/main/docs/getting-started.md)
- [REST API](https://github.com/Ravenium22/Keyvane/blob/main/docs/api-reference.md)

## License

MIT
