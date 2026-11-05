# Example: AI PDF Analyzer

A small web app monetized with Keyvane. It is the example product from the Keyvane plan:

| Plan | PDF analyses / month | Export to Markdown | Priority processing |
|---|---:|:---:|:---:|
| Free | 10 | | |
| Pro ($12) | 500 | ✓ | |
| Business ($39) | 3,000 | ✓ | ✓ |

It shows the four integration points every product needs. Search the code for `Keyvane:`.

1. **Register customers** at sign-in with your own user ID (`customers.upsert`).
2. **Read entitlements** to show the plan, the usage meter and locked features (`entitlements.get`).
3. **Consume usage atomically** with an idempotency key (`usage.record`). Re-analyzing the same file in the same month is free.
4. **Upgrade through Stripe** with a Payment Link that carries `client_reference_id`.

## Run it

From the repository root:

```bash
npm install
npm run seed:demo                              # writes examples/pdf-analyzer/.env
npm run dev                                    # Keyvane on http://localhost:8787
npm run dev --workspace pdf-analyzer-example   # this app on http://localhost:3000
```

Sign in with any username, analyze the sample PDF a few times, then upgrade:

```bash
npm run stripe:simulate -- subscribe --customer user_<username> --plan pro
```

Reload the page: the limit is now 500 and export is unlocked. Try `past-due`, `recover` and `cancel` too.

To use real Stripe test payments, create a Payment Link for the Pro price in Stripe test mode, map the price to the Pro plan in Keyvane, and set `STRIPE_PAYMENT_LINK_PRO` in `.env`.

## If Keyvane is unreachable

`loadAccess()` catches connection errors and keeps the app on its free tier ("fail closed" for paid features). Choose the behavior that suits your product; see the [SDK docs](../../docs/sdk.md#when-keyvane-is-unreachable-fail-open-or-closed).
