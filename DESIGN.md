# Keyvane design system

The visual system for the marketing site, docs and dashboard. Tokens live in `apps/server/src/public/app.css`; this file is the source of truth for why they are what they are. Product context is in [PRODUCT.md](PRODUCT.md).

## Direction

**Precise, warm, workmanlike.** Keyvane decides who gets access to paid software, so the interface should feel exact and trustworthy, like a well-made tool. It also serves independent builders, so it has some warmth and character. Ink-blue neutrals carry the precision, a burnt-orange accent marks direction and action (the vane), and a characterful grotesque sets the headlines.

Per surface:

| Surface | Mode | What matters |
|---|---|---|
| Landing page | Persuade | One clear offer, real product evidence (actual UI and API responses), an obvious next step |
| Dashboard | Operate | Frequent actions easy to find, dense but calm tables, states you can tell apart |
| Docs | Read | Comfortable measure, clear structure, copyable code |

## Typography

| Role | Family | Use |
|---|---|---|
| Display | **Bricolage Grotesque** (variable, optical sizes) | Headings, wordmark, big numbers |
| Text / UI | **IBM Plex Sans** (variable) | Body copy, UI, tables, forms |
| Code | **IBM Plex Mono** 400/500 | Code, license keys, IDs, API paths |

All fonts are self-hosted WOFF2 (OFL, see `public/fonts/OFL.txt`), with latin and latin-ext subsets (Turkish and European names render correctly).

Type scale (1.25 ratio, 16px base): 13 · 14 · 16 · 18 · 20 · 25 · 31 · 39 · 49 · 61 px.

- Body 16px / 1.6. Dashboard tables 15px. Smallest text 13px (captions, table headers).
- Headings: 1.05 to 1.2 line height, -0.01 to -0.025em tracking (never tighter), `text-wrap: balance`.
- Paragraphs: `text-wrap: pretty`; measure 60 to 70 characters (`max-width: 68ch` in docs).
- Numbers in tables and stats use tabular figures.
- Sentence case everywhere, uppercase only for very short labels.

## Color

OKLCH, with neutrals tinted toward the ink hue (265). No pure black, no pure white, no gradients on text, no purple.

| Token | Light | Role |
|---|---|---|
| `--ink` | `oklch(0.22 0.03 265)` | Text, dark surfaces, the brand's "precision" |
| `--accent` | `oklch(0.553 0.195 38.4)` | Primary actions, links, focus (burnt orange). White text on it is 5.2:1 |
| `--accent-strong` | `oklch(0.47 0.157 37.3)` | Hover/pressed |
| `--accent-bright` | `oklch(0.705 0.19 47)` | Decorative marks only, never small text |
| `--bg` | `oklch(0.985 0.004 265)` | Page |
| `--surface` | `oklch(0.997 0.002 265)` | Panels, inputs |
| `--muted-bg` | `oklch(0.95 0.007 265)` | Table headers, code inline, hovers |
| `--border` | `oklch(0.905 0.01 265)` | Dividers |
| `--text-muted` | `oklch(0.44 0.025 265)` | Secondary text (≥ 7:1) |
| `--text-subtle` | `oklch(0.52 0.02 265)` | Tertiary text (≥ 4.6:1, AA) |

Semantic colors (success green 155, warning amber 75, danger red 27, info blue 250) are used only for states and always come with a word or icon. Danger actions are outlined, so they never compete with the orange primary.

Dark mode mirrors the roles: ink background `oklch(0.18 0.02 265)`, orange primary `oklch(0.72 0.17 50)` with ink text.

## Space, shape, depth

- Spacing steps (px): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128. Related items sit close; groups are separated by at least two steps more.
- Radius: 6 (controls), 10 (panels, tables, code), 999 (pills). Nothing larger.
- Depth: a border defines a panel; shadows are reserved for things that float (menus). Never a hairline border plus a wide shadow on the same element.
- One level of containment: no cards inside cards. Tables sit in a single bordered frame.

## Motion

150 to 200ms, `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart) for hovers, focus and disclosure. No bounce, no elastic, no animated decoration. Everything respects `prefers-reduced-motion`.

## Components

- **Buttons:** primary (orange fill), secondary (surface + border), ghost, danger (outline). 40px tall, 44px on touch screens.
- **Inputs:** 16px text (no iOS zoom), 40px tall, 3px orange focus ring.
- **Badges:** pill with a status dot and a word ("active", "past due (grace)"). Color is never the only signal.
- **Tables:** sentence-case 13px headers on a muted band, 15px cells, row dividers, tabular numbers.
- **Empty states:** a heading that says what is missing, one sentence on what fills it, one action. No icon tiles.
- **Code:** dark ink panel, Plex Mono 14px, language-tagged.

## Brand marks

- **Mark:** a key whose shaft ends in an arrow, like a weathervane (key + vane), white on a burnt-orange rounded square. Files: `public/logo.svg`, `public/favicon.svg`, PNG icons in `public/brand/`.
- **Wordmark:** "Keyvane" in Bricolage Grotesque Bold, -0.02em tracking, ink on light and near-white on dark.
- Clear space around the mark: at least half its width. Minimum size 16px.

## Anti-patterns we avoid

Gradient text, purple/violet palettes, glowing dark accents, badge pills above headlines, icon tiles above headings, identical icon-card grids, nested cards, radial halos behind the hero, gray text on colored backgrounds, uppercase body text, bounce easing, tiny interface text and lines longer than about 75 characters.
