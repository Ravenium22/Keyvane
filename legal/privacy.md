# Privacy Policy

Last updated: {{updated}}

This policy explains how {{entity}} ("we", "us") handles personal data in Keyvane, available at {{url}}. Questions: {{contact}}.

## Two roles

- **For your account** (the developer who signs up), we decide why and how data is processed. We are the **controller**.
- **For your customers' data** that you or your payment provider send to Keyvane (customer IDs, emails, usage, devices), we process it on your behalf and on your instructions. We are your **processor**, and you are the controller.

## What we process

| Data | Examples | Why |
|---|---|---|
| Account data | Email, name, password (stored only as a salted scrypt hash) | Provide and secure your account |
| Project data | Products, plans, features, API key metadata (secret keys are stored only as hashes) | Provide the service |
| Your customers' data | Your user IDs, emails and names you send, Stripe customer and subscription IDs and statuses, license keys, usage counts, device fingerprints and the IP address used to activate a device | Decide and record access on your behalf |
| Stripe events | Webhook payloads Stripe sends to your endpoint, which can include customer emails and names | Keep access in sync and let you replay events |
| Technical data | IP address and browser user agent of dashboard sessions, request logs | Security, abuse prevention and debugging |
| Cookies | A session cookie, a short-lived message cookie and your last-opened project | Strictly necessary to run the dashboard. No advertising or tracking cookies. |

We never receive card numbers or bank details. Payments are handled by your payment provider.

If the operator has enabled privacy-friendly analytics (Plausible), public pages send anonymous, cookieless page-view statistics. The dashboard is never tracked.

## Legal bases

Performance of our contract with you (providing Keyvane), our legitimate interests in keeping the service secure and improving it, and compliance with legal obligations. For your customers' data, the legal basis is yours as the controller.

## Sharing and subprocessors

We do not sell personal data. We share it only with providers that help us run Keyvane, under contracts that protect it:

- Hosting provider: TODO (name and region)
- Email delivery: Resend, Inc. (password-reset and alert emails), when enabled
- Analytics: Plausible Insights OÜ (cookieless, public pages only), when enabled

We may disclose data when required by law.

## International transfers

Keyvane is operated from the United States. Where data from the EU, UK or Türkiye is transferred, we rely on appropriate safeguards such as Standard Contractual Clauses.

## Retention

Account and project data are kept while your account exists. When you delete a customer, their licenses, devices, usage and history are deleted. When you delete a project or your account, all of its data is deleted. Backups are overwritten within 30 days.

## Your rights

Depending on where you live (for example under the GDPR, UK GDPR or KVKK), you can access, correct, export or delete your data, object to or restrict processing, and complain to a supervisory authority. You can export customers and licenses as CSV and delete customers or your whole account in the dashboard. For anything else, contact {{contact}}.

If you are one of our customers' end users, please contact the developer of the product you use; we will help them respond.

## Security

Passwords and secret keys are hashed, provider secrets are encrypted at rest, all traffic uses HTTPS, and every change to access is recorded in an audit log. See the security overview at {{url}}/docs/security.

## Children

Keyvane is a developer tool and is not directed to children under 16.

## Changes

We will post changes here and update the date above. Material changes will be announced by email to account holders.
