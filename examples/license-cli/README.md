# Example: license-key CLI

A command-line "desktop app" licensed with Keyvane license keys:

- validates and activates keys with a **publishable key** (safe to ship in the binary),
- binds the license to this machine with a privacy-friendly fingerprint and respects the plan's device limit,
- gates a Pro-only command on the license's entitlements,
- keeps working **offline** for up to 7 days using the last successful check.

## Run it

```bash
npm install
npm run seed:demo -- --sample-data   # prints a sample license key and writes examples/license-cli/.env
npm run dev                          # Keyvane on http://localhost:8787

cd examples/license-cli
npm run cli -- activate KV-XXXXX-XXXXX-XXXXX-XXXXX
npm run cli -- status
npm run cli -- export report.pdf     # Pro feature
npm run cli -- deactivate
```

Revoke or suspend the key in the dashboard and run `status` again to see access change.

The license state is stored in `~/.config/keyvane-example-cli/license.json` (override with `LICENSE_FILE`).
