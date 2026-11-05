# Next.js

Add plans, feature gates and usage limits to a Next.js App Router app. Keyvane is called from the server only: server components, route handlers and server actions. The secret key never reaches the browser.

**You need:** Next.js 14 or newer, Node.js 18+, a Keyvane project with a product, and a secret key.

## 1. Install and configure

```bash
npm install @keyvane/sdk
```

```bash
# .env.local
KEYVANE_URL=https://keyvane.example.com
KEYVANE_SECRET_KEY=kv_sk_...
```

```ts
// lib/keyvane.ts
import 'server-only';
import { Keyvane } from '@keyvane/sdk';

export const keyvane = new Keyvane({ cacheTtlMs: 5_000 });
```

## 2. Register customers at sign-up

Use your own user ID. Keyvane never needs to be stored in your database.

```ts
await keyvane.customers.upsert({ externalId: user.id, email: user.email, name: user.name });
```

## 3. Show the plan and lock features in a server component

```tsx
// app/dashboard/page.tsx
import { keyvane } from '@/lib/keyvane';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic'; // entitlements must never come from a build-time cache

export default async function Dashboard() {
  const { user } = await getSession();
  const access = await keyvane.entitlements.get({ customer: user.id });

  return (
    <main>
      <p>Plan: {access.plan?.name ?? 'Free'}</p>
      <p>{access.remaining('pdf_analysis') ?? 'Unlimited'} analyses left this month</p>
      {access.can('export') ? <ExportButton /> : <UpgradeLink feature="Export" />}
    </main>
  );
}
```

## 4. Consume usage in a route handler

```ts
// app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import { keyvane } from '@/lib/keyvane';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
  const { user } = await getSession();
  const jobId = request.headers.get('x-job-id') ?? crypto.randomUUID();

  const usage = await keyvane.usage.record({
    customer: user.id,
    feature: 'pdf_analysis',
    idempotencyKey: jobId, // retries never count twice
  });
  if (!usage.allowed) {
    return NextResponse.json({ error: usage.message, code: usage.code }, { status: 402 });
  }

  const result = await analyze(await request.formData());
  return NextResponse.json(result);
}
```

The limit check and the increment happen in one atomic step, so two concurrent requests can never both take the last analysis.

## 5. Upgrades through Stripe

Link a signed-in user to a Stripe Payment Link with their ID, so Keyvane knows who paid:

```tsx
<a href={`https://buy.stripe.com/test_abc123?client_reference_id=${user.id}`}>Upgrade to Pro</a>
```

Then follow the [Stripe integration guide](stripe.md) to connect the webhook and map the price to your Pro plan. Access updates within seconds of the purchase.

## Handling outages

```ts
import { KeyvaneConnectionError } from '@keyvane/sdk';

try {
  access = await keyvane.entitlements.get({ customer: user.id });
} catch (err) {
  if (err instanceof KeyvaneConnectionError) return <FreeTier />; // keep free features working
  throw err;
}
```

Next: [Core concepts](concepts.md) · [SDK reference](sdk.md)
