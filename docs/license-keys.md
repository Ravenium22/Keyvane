# License keys & devices

Use license keys when your software runs somewhere you do not control: desktop apps, CLIs, plugins, self-hosted software or APIs where customers authenticate with a key. For web apps where users sign in, checking [entitlements by user ID](concepts.md#how-access-is-decided) is usually simpler.

## Key format

```text
KV-7K2QD-9XWMN-4RT8H-PZ3VB
```

That is 20 random characters, or 100 bits of entropy, from an alphabet without `I`, `L`, `O` and `U`. Input is normalized: lowercase, extra spaces and the look-alikes `O`→`0`, `I`/`L`→`1` are accepted.

## Issuing keys

- **Automatically from Stripe:** every subscription creates a license (see [Stripe integration](stripe.md)).
- **In the dashboard:** **Licenses → New license**, or **Grant a license** on a customer page. Typical uses are beta testers, lifetime deals, partners and support credits.
- **From your server:**

```ts
const license = await keyvane.licenses.create({
  plan: 'pro',
  customer: user.id,      // optional; omit for a standalone key
  durationDays: 365,      // or expiresAt: '2027-12-31'
  maxActivations: 3,      // devices; defaults to the plan's device limit
  note: 'AppSumo #1234',  // internal, never shown to publishable keys
});
console.log(license.key);
```

## Validating in your app

Ship a **publishable key** (`kv_pk_…`) inside the app. It can only validate, activate and deactivate keys, so extracting it from your binary does not help anyone.

```ts
import { Keyvane } from '@keyvane/sdk';

const keyvane = new Keyvane({
  apiKey: 'kv_pk_…',
  baseUrl: 'https://keyvane.example.com',
});

const result = await keyvane.licenses.validate({ key: licenseKey, fingerprint: machineId });

if (result.valid) {
  result.entitlements?.can('export'); // what the license unlocks
} else {
  console.log(result.code, result.message); // e.g. 'expired', 'This license expired on 2026-12-01.'
}
```

| Code | Meaning |
|---|---|
| `valid` | Good to go |
| `not_found` | No such key in this project |
| `expired` | Past `expires_at` |
| `suspended` / `revoked` | Disabled by you |
| `subscription_canceled` / `payment_overdue` / `subscription_inactive` | The Stripe subscription behind the license no longer grants access |
| `product_mismatch` | The key belongs to another product (pass `product` to enforce this) |
| `not_activated` | You passed a `fingerprint` that is not activated for this key |
| `activation_limit_reached` | `activate` was called on a full license |

## Device activations

Set a **device limit** on the plan (default for new licenses) or per license. Then, on first launch:

```ts
const activation = await keyvane.licenses.activate({
  key: licenseKey,
  fingerprint: machineId,           // stable per device, see below
  name: `${os.hostname()} (macOS)`, // shown in your dashboard
});
if (activation.code === 'activation_limit_reached') {
  // ask the user to deactivate another device
}
```

- `activate` is idempotent: activating the same fingerprint again just updates *last seen*.
- `validate` with a `fingerprint` also checks that this device is activated.
- `deactivate` frees a seat, e.g. when the user signs out or moves to a new machine. You can also remove devices on the license page in the dashboard.

**Fingerprints.** Use something stable and privacy-friendly: hash the hostname, platform, architecture and CPU model rather than sending raw hardware IDs. The [license CLI example](../examples/license-cli/src/cli.ts) shows one approach.

## Working offline

Validation is an online check. For desktop apps, cache the last successful result and allow a grace period when Keyvane is unreachable:

```ts
try {
  const result = await keyvane.licenses.validate({ key, fingerprint });
  saveCache({ validatedAt: Date.now(), valid: result.valid });
} catch (err) {
  if (err instanceof KeyvaneConnectionError && cache && Date.now() - cache.validatedAt < 7 * DAY) {
    // keep working offline for up to a week
  } else throw err;
}
```

Signed, fully offline license files are on the [roadmap](roadmap.md).

## Revoking, suspending, extending

| Action | Effect | Reversible |
|---|---|---|
| Suspend | Access stops immediately | Yes, with **Reinstate** |
| Revoke | Access stops permanently | No. Issue a new key instead. |
| Change expiry | Extend or shorten access | Yes |
| Change plan | Upgrade or downgrade a manual license | Yes (Stripe licenses follow the subscription) |

All of these are available in the dashboard and through the API (`/v1/licenses/{id}/suspend`, `/reinstate`, `/revoke` and `PATCH /v1/licenses/{id}`), and every change is recorded in the audit log.
