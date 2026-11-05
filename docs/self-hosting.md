# Self-hosting

Keyvane runs as **one Node.js process with an embedded SQLite database**. There are no queues, workers or cron jobs: time-based rules (expirations, grace periods, scheduled cancellations) are evaluated on each request. A small VM handles thousands of entitlement checks per second.

You may self-host Keyvane for your own products under the [Functional Source License](pricing-and-licensing.md). Offering it to others as a competing hosted service is not permitted until each release converts to MIT two years after it is published.

## Requirements

- Node.js **22.18+** (uses the built-in `node:sqlite` driver and TypeScript type stripping, so there is no build step)
- A persistent disk for the database file
- HTTPS in front of it (a reverse proxy or your platform's load balancer)

## Configuration

| Variable | Default | Description |
|---|---|---|
| `KEYVANE_PUBLIC_URL` | `http://localhost:8787` | Public base URL. Used for webhook URLs, links in emails and secure cookies (`https://` turns on `Secure` cookies). |
| `KEYVANE_SECRET` | generated in development | **Required in production.** At least 32 random characters. Encrypts stored Stripe secrets and signs cookies. Keep it stable and back it up. |
| `DATABASE_PATH` | `.data/keyvane.db` | SQLite file. Put it on a persistent volume. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Where the server listens |
| `NODE_ENV` | `development` | Set to `production` in production |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so client IPs come from `X-Forwarded-For` (used for rate limits) |
| `SIGNUPS_ENABLED` | `true` | Set to `false` after creating your account to close registration |
| `KEYVANE_CONTACT_EMAIL` | none | Shown on the landing page and in emails |
| `KEYVANE_GITHUB_URL` | this repository | Link used on the landing page and docs |
| `RESEND_API_KEY` / `MAIL_FROM` | none | Send password-reset emails through [Resend](https://resend.com). Without it, reset links are written to the server log. |
| `KEYVANE_LEGAL_ENTITY` | none | Your company name. When set, the privacy policy and terms in `legal/` are published at `/legal/privacy` and `/legal/terms` (have them reviewed first). |
| `KEYVANE_LEGAL_JURISDICTION` | the State of Delaware, United States | Governing law named in the terms |
| `KEYVANE_PLAUSIBLE_DOMAIN` | none | Enables cookieless [Plausible](https://plausible.io) analytics on public pages (never in the dashboard) |
| `KEYVANE_ADMIN_EMAILS` | none | Comma-separated emails that can open the operator dashboard at `/app/admin` |
| `REQUEST_LOGGING` | `true` | One log line per request (JSON when `NODE_ENV=production`); query strings are never logged |
| `RETENTION_WEBHOOK_PAYLOAD_DAYS` | `90` | Raw payloads of successfully processed Stripe events are trimmed after this many days |
| `RETENTION_USAGE_EVENT_DAYS` | `400` | Individual usage events are deleted after this many days (counters are kept) |
| `RATE_LIMIT_SECRET_KEY` | `1200` | Requests per minute per secret key |
| `RATE_LIMIT_PUBLIC_LICENSE` | `120` | License checks per minute per publishable key and IP |
| `RATE_LIMIT_AUTH` | `20` | Login/sign-up attempts per 15 minutes per IP |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

## Docker

```bash
docker build -t keyvane .
docker run -d --name keyvane -p 8787:8787 \
  -e NODE_ENV=production \
  -e KEYVANE_PUBLIC_URL=https://keyvane.example.com \
  -e KEYVANE_SECRET=change-me-to-a-long-random-string \
  -e TRUST_PROXY=true \
  -v keyvane-data:/data \
  keyvane
```

Or with Compose:

```bash
cp .env.example .env   # fill in KEYVANE_PUBLIC_URL and KEYVANE_SECRET
docker compose up -d
```

The image stores the database at `/data/keyvane.db` and exposes a health check at `GET /healthz`.

## Fly.io

```bash
cp deploy/fly.toml fly.toml      # then set your app name and KEYVANE_PUBLIC_URL
fly launch --no-deploy --copy-config
fly volumes create keyvane_data --size 1
fly secrets set KEYVANE_SECRET=$(node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))")
fly deploy
```

Run a **single machine**: SQLite lives on one volume.

## Railway

1. **New Project → Deploy from GitHub repo** and pick this repository. Railway builds the root `Dockerfile`.
2. On the service, **Attach volume** with mount path `/data`.
3. Under **Variables**, set:

```bash
NODE_ENV=production
PORT=8787
KEYVANE_SECRET=<at least 32 random characters>
KEYVANE_PUBLIC_URL=https://<your-service>.up.railway.app
TRUST_PROXY=true
DATABASE_PATH=/data/keyvane.db
RAILWAY_RUN_UID=0
```

`RAILWAY_RUN_UID=0` lets the container write to the volume (the image runs as a non-root user and Railway volumes are owned by root).

4. **Settings → Networking → Generate Domain** with target port `8787`, then put that domain in `KEYVANE_PUBLIC_URL`. Set **Settings → Deploy → Healthcheck Path** to `/healthz`.

Keep one replica: services with a volume cannot be replicated, and a redeploy causes a few seconds of downtime while the volume moves to the new container.

Any other platform with persistent disks works the same way (Render, a VPS with systemd).

## Without Docker

```bash
npm ci --omit=dev
NODE_ENV=production KEYVANE_SECRET=... KEYVANE_PUBLIC_URL=https://... npm start
```

## Backups

SQLite runs in WAL mode. The simplest reliable option is continuous replication with [Litestream](https://litestream.io) to S3-compatible storage; a ready-to-edit configuration is in [`deploy/litestream.yml`](../deploy/litestream.yml). For periodic snapshots, the SQLite backup API is safe while Keyvane runs:

```bash
sqlite3 /data/keyvane.db ".backup '/backups/keyvane-$(date +%F).db'"
```

Back up `KEYVANE_SECRET` too. Without it, stored Stripe webhook secrets cannot be decrypted (you can re-enter them).

## Upgrades

Schema migrations run automatically at startup and are append-only. Take a backup, deploy the new version and restart.

## Administration

```bash
npm run admin -- list-users
npm run admin -- create-user you@example.com 'a long password'
npm run admin -- reset-password you@example.com 'a new password'
npm run admin -- stats            # registered developers, active projects, API traffic
npm run admin -- maintenance      # clean up expired sessions and old data now
```

## Billing your own users (operators of a hosted instance)

A hosted Keyvane instance can charge its own developers with Keyvane itself:

1. `npm run admin -- setup-billing you@example.com` creates a "Keyvane Cloud billing" project with Developer, Indie, Startup and Business plans and two quota features, `products` and `active_licenses`.
2. Adjust the quotas in that project's matrix, add your Stripe price IDs to the paid plans and connect its Stripe webhook.
3. Create a Stripe Payment Link per paid plan and set:

```bash
KEYVANE_BILLING_PROJECT=proj_...
KEYVANE_UPGRADE_LINKS=indie=https://buy.stripe.com/...,startup=https://buy.stripe.com/...
KEYVANE_BILLING_PORTAL_URL=https://billing.stripe.com/p/login/...   # optional
KEYVANE_ENFORCE_PLAN_LIMITS=true                                    # when you start enforcing quotas
```

Developers then see their plan, usage and upgrade buttons under **Account**. The buttons pass their user ID as `client_reference_id`, so purchases are linked automatically. Quotas only block new products and manually issued licenses; licenses created by your customers' Stripe purchases are never blocked.

## Housekeeping

The server cleans up expired sessions and reset tokens, trims old webhook payloads and deletes old usage events at startup and every six hours. Run it on demand with `npm run admin -- maintenance`.

## Production checklist

- [ ] `NODE_ENV=production`, a strong `KEYVANE_SECRET`, an `https://` `KEYVANE_PUBLIC_URL`
- [ ] Database on a persistent volume, with backups
- [ ] `TRUST_PROXY=true` if a proxy terminates TLS
- [ ] `SIGNUPS_ENABLED=false` if only you should have an account
- [ ] Email configured (`RESEND_API_KEY`, `MAIL_FROM`) so users can reset passwords
- [ ] Stripe webhook endpoint in **live** mode pointing at the production URL
