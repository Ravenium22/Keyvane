# Security & reliability

Keyvane decides whether paying customers get access, so a bug can cost your customers money or lock them out. These are the safeguards built into the platform.

## Credentials

| Secret | How it is stored |
|---|---|
| Account passwords | scrypt (N=16384, r=8, p=1) with a per-password salt. Login timing does not reveal whether an email exists. |
| Dashboard sessions | Random 256-bit tokens in `HttpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS). Only a SHA-256 hash is stored. Sessions expire after 30 days. |
| Secret API keys | Shown once and stored as SHA-256 hashes. Revocation is immediate. |
| Publishable API keys | Stored in plain text by design. They can only validate and activate license keys. |
| Stripe webhook secrets | Encrypted at rest with AES-256-GCM using a key derived from `KEYVANE_SECRET` (HKDF-SHA256). |
| Password-reset tokens | Single-use, valid for one hour, stored as SHA-256 hashes. |
| License keys | 100 bits of entropy, stored in plain text so you and your customers can retrieve them. Treat them as bearer credentials. |

## Web application

- **CSRF:** every form post must come from Keyvane's own origin (checked with `Origin` / `Sec-Fetch-Site`), and session cookies are `SameSite=Lax`.
- **XSS:** all HTML is rendered through an escaping template helper; a strict Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`) is sent with every page.
- **Access control:** every dashboard route checks project membership; IDs from other projects return `404`.
- **Open redirects:** post-login redirects only accept same-site relative paths.
- **Rate limits:** login and sign-up attempts per IP, publishable-key license checks per key and IP, and secret-key traffic per key.

## Stripe event handling

- HMAC-SHA256 signature verification with a 5-minute replay window before anything is stored.
- Every event is recorded; duplicates are acknowledged without being re-applied.
- Each event is applied in a single database transaction.
- Older snapshots never overwrite newer ones; ended subscriptions are never revived.
- Processing failures return `500` so Stripe retries, and can be reprocessed from the dashboard.
- Keyvane never asks for Stripe API keys, so a Keyvane breach cannot move money.

## Correctness of access decisions

- Access is computed at request time from stored facts and the current time, so expirations and grace periods cannot be missed by a stalled job.
- Usage limits are enforced with a check-and-increment inside one transaction, so concurrent requests cannot exceed a limit.
- Idempotency keys prevent double counting on retries.
- Admin actions (suspend, revoke) always override subscription state.
- Every change is written to the audit log with its actor.

## Your responsibilities when self-hosting

Use HTTPS, keep `KEYVANE_SECRET` private and backed up, back up the database, keep Node.js updated, and restrict who can reach the server's shell.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](../SECURITY.md). Do not open a public issue.
