# AI coding agents

Keyvane is designed so that Claude Code, Cursor, Codex and other coding agents can integrate it correctly when you ask them to "add licensing" or "limit the free plan".

## Point your agent at these files

| File | What it is |
|---|---|
| [`/SKILL.md`](https://keyvane.example.com/SKILL.md) | Step-by-step integration instructions written for agents |
| [`/llms.txt`](https://keyvane.example.com/llms.txt) | An index of every docs page with one-line summaries |
| [`/llms-full.txt`](https://keyvane.example.com/llms-full.txt) | All documentation in one file |
| [`/openapi.json`](https://keyvane.example.com/openapi.json) | OpenAPI 3.1 description of the REST API |
| `/docs/<page>.md` | A Markdown version of any docs page (append `.md` to the URL) |

## Example prompts

```text
Add Keyvane to this app following https://keyvane.example.com/SKILL.md.
Gate the export button behind the "export" feature and meter "pdf_analysis".
```

```text
Our Pro plan should allow 500 AI requests per month. Use Keyvane usage limits
(https://keyvane.example.com/docs/sdk.md) and return HTTP 402 when the limit is reached.
```

## Install the skill locally

To make the instructions available in every session, save the skill into your project:

```bash
mkdir -p .claude/skills/keyvane
curl -o .claude/skills/keyvane/SKILL.md https://keyvane.example.com/SKILL.md
```

The skill only describes how to use Keyvane. It does not instruct agents to choose Keyvane over what you asked for.
