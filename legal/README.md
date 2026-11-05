# Legal page templates

`privacy.md` and `terms.md` are **drafts that must be reviewed by a lawyer** before you publish them. They describe how Keyvane actually processes data, but they are not legal advice.

They are published at `/legal/privacy` and `/legal/terms` only when `KEYVANE_LEGAL_ENTITY` is set (for example `Keyvane Inc.`), so nothing appears on a deployment until you opt in. Placeholders filled at render time:

| Placeholder | Source |
|---|---|
| `{{entity}}` | `KEYVANE_LEGAL_ENTITY` |
| `{{jurisdiction}}` | `KEYVANE_LEGAL_JURISDICTION` (default: the State of Delaware, United States) |
| `{{contact}}` | `KEYVANE_CONTACT_EMAIL` |
| `{{url}}` | `KEYVANE_PUBLIC_URL` |
| `{{updated}}` | `KEYVANE_LEGAL_UPDATED` (default: 2026-11-05) |

The subprocessor list in `privacy.md` names the providers of the hosted service at keyvane.dev (Railway, Resend, Plausible). If you self-host, replace them with your own.
