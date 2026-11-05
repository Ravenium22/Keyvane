# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub: **Security → Report a vulnerability** on this repository ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Include the affected version or commit, steps to reproduce and the impact you observed. You will get an acknowledgement within 3 business days and a fix or mitigation plan within 14 days for confirmed issues. We are happy to credit you.

## Scope

In scope: the Keyvane server (`apps/server`), the SDK (`packages/sdk`) and Keyvane Cloud. Especially anything that lets someone gain access they did not pay for, read another project's data, forge Stripe events or bypass rate limits.

Out of scope: denial of service through volume, reports from automated scanners without a demonstrated impact, and issues in self-hosted deployments caused by misconfiguration.

## Supported versions

Security fixes are released for the latest version on the `main` branch.

See [docs/security.md](docs/security.md) for how Keyvane protects credentials and access decisions.
