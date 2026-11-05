import { html, raw, type HtmlChild, type SafeHtml } from '../lib/html.ts';
import type { LicenseState } from '../services/licenses.ts';
import type { PlanRow } from '../types.ts';

// ---------------------------------------------------------------------------
// Icons (simple 24×24 stroke icons)
// ---------------------------------------------------------------------------

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-6 7-6s7 2.1 7 6"/><path d="M16 4.2a4 4 0 0 1 0 7.6M22 21c0-2.9-1.7-4.8-4.5-5.6"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M14.5 8.5l2 2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11a2 2 0 0 1 2 2v15a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 1 4 17z"/><path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H13v17a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 0 20 17z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/><circle cx="12" cy="14" r="1.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  device: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, className = 'icon'): SafeHtml {
  return raw(
    `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`,
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatMoney(amount: number, currency: string): string {
  const cur = currency.toLowerCase();
  const value = ZERO_DECIMAL.has(cur) ? amount : amount / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur.toUpperCase(),
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${cur.toUpperCase()}`;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(iso)}, ${hh}:${mm} UTC`;
}

export function relativeTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return 'never';
  const diff = now.getTime() - Date.parse(iso);
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const fmt = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  if (s < 45) return future ? 'in a moment' : 'just now';
  if (s < 3600) return fmt(Math.round(s / 60), 'min');
  if (s < 86400) return fmt(Math.round(s / 3600), 'h');
  if (s < 86400 * 14) return fmt(Math.round(s / 86400), Math.round(s / 86400) === 1 ? 'day' : 'days');
  return formatDate(iso);
}

export function timeTag(iso: string | null | undefined, now: Date, mode: 'relative' | 'date' | 'datetime' = 'relative'): SafeHtml {
  if (!iso) return html`<span class="subtle">—</span>`;
  const text = mode === 'relative' ? relativeTime(iso, now) : mode === 'date' ? formatDate(iso) : formatDateTime(iso);
  return html`<time datetime="${iso}" title="${formatDateTime(iso)}" data-local>${text}</time>`;
}

export function planPrice(plan: Pick<PlanRow, 'price_amount' | 'currency' | 'billing_interval'>): string {
  if (plan.price_amount === null) return '—';
  if (plan.price_amount === 0) return 'Free';
  const amount = formatMoney(plan.price_amount, plan.currency);
  if (plan.billing_interval === 'month') return `${amount} / month`;
  if (plan.billing_interval === 'year') return `${amount} / year`;
  if (plan.billing_interval === 'one_time') return `${amount} one-time`;
  return amount;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export type Tone = 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'accent';

export function badge(text: string, tone: Tone = 'gray', opts: { dot?: boolean; title?: string } = {}): SafeHtml {
  const cls = `badge${tone === 'gray' ? '' : ` badge-${tone}`}${opts.dot === false ? ' no-dot' : ''}`;
  return html`<span class="${cls}" ${opts.title ? html`title="${opts.title}"` : ''}>${text}</span>`;
}

export function licenseBadge(state: Pick<LicenseState, 'status' | 'valid' | 'message'>): SafeHtml {
  const tones: Record<string, Tone> = {
    active: 'green',
    trialing: 'blue',
    past_due: state.valid ? 'yellow' : 'red',
    canceled: state.valid ? 'yellow' : 'gray',
    expired: 'gray',
    inactive: 'gray',
    suspended: 'yellow',
    revoked: 'red',
  };
  const label = state.status === 'past_due' ? (state.valid ? 'past due (grace)' : 'past due') : state.status === 'canceled' && state.valid ? 'canceling' : state.status;
  return badge(label, tones[state.status] ?? 'gray', { title: state.message });
}

export function subscriptionBadge(status: string): SafeHtml {
  const tones: Record<string, Tone> = {
    active: 'green',
    trialing: 'blue',
    past_due: 'yellow',
    unpaid: 'red',
    canceled: 'gray',
    incomplete: 'yellow',
    incomplete_expired: 'gray',
    paused: 'gray',
  };
  return badge(status.replace(/_/g, ' '), tones[status] ?? 'gray');
}

export function webhookBadge(status: string): SafeHtml {
  const tones: Record<string, Tone> = { processed: 'green', ignored: 'gray', failed: 'red', pending: 'yellow' };
  return badge(status, tones[status] ?? 'gray');
}

export function copyButton(text: string, label = 'Copy', className = 'btn btn-secondary btn-sm'): SafeHtml {
  return html`<button type="button" class="${className}" data-copy="${text}">${icon('copy', 'icon icon-sm')}<span class="when-idle">${label}</span><span class="when-copied">Copied</span></button>`;
}

export function copyField(value: string, opts: { display?: string; id?: string } = {}): SafeHtml {
  return html`<div class="copy-field"><code tabindex="0" ${opts.id ? html`id="${opts.id}"` : ''}>${opts.display ?? value}</code>${copyButton(value)}</div>`;
}

export function emptyState(opts: { icon?: IconName; title: string; text: HtmlChild; action?: HtmlChild }): SafeHtml {
  return html`<div class="empty">
    <h3>${opts.title}</h3>
    <p>${opts.text}</p>
    ${opts.action ?? ''}
  </div>`;
}

export function meter(used: number, limit: number | null | undefined): SafeHtml {
  if (limit === null || limit === undefined) return html`<span class="subtle small">Unlimited</span>`;
  const pct = limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const cls = pct >= 100 ? 'meter full' : pct >= 80 ? 'meter warn' : 'meter';
  return html`<div class="${cls}" role="progressbar" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="${limit}"><span style="width:${pct}%"></span></div>`;
}

export function pagination(hasMore: boolean, nextUrl: string | null): SafeHtml {
  if (!hasMore || !nextUrl) return html``;
  return html`<div class="row" style="justify-content:flex-end;margin-top:1rem"><a class="btn btn-secondary btn-sm" href="${nextUrl}">Next page ${icon('arrow', 'icon icon-sm')}</a></div>`;
}

/** Tiny SVG bar chart for daily series, with HTML axis labels so text never scales. */
export function barChart(series: { day: string; value: number }[], alt?: { day: string; value: number }[]): SafeHtml {
  const width = 640;
  const height = 150;
  const pad = { top: 8, bottom: 2, left: 2, right: 2 };
  const max = Math.max(1, ...series.map((s) => s.value), ...(alt ?? []).map((s) => s.value));
  const slot = (width - pad.left - pad.right) / Math.max(1, series.length);
  const barW = alt ? Math.max(2, slot * 0.34) : Math.max(3, slot * 0.6);
  const h = (v: number) => ((height - pad.top - pad.bottom) * v) / max;
  const bars = series.map((s, i) => {
    const x = pad.left + i * slot + (alt ? slot * 0.14 : slot * 0.2);
    const y = height - pad.bottom - h(s.value);
    const other = alt?.[i];
    const altBar = other
      ? raw(`<rect class="bar-alt" x="${(x + barW + 2).toFixed(1)}" y="${(height - pad.bottom - h(other.value)).toFixed(1)}" width="${barW.toFixed(1)}" height="${h(other.value).toFixed(1)}" rx="2"><title>${other.day}: ${other.value}</title></rect>`)
      : '';
    return html`${raw(`<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h(s.value).toFixed(1)}" rx="2"><title>${s.day}: ${s.value}</title></rect>`)}${altBar}`;
  });
  const label = (day: string | undefined) => (day ? formatDate(`${day}T00:00:00Z`).replace(/, \d{4}$/, '') : '');
  return html`<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Daily API activity">
    <line class="axis" x1="0" x2="${width}" y1="${height - pad.bottom + 0.5}" y2="${height - pad.bottom + 0.5}" />
    ${bars}
  </svg>
  <div class="chart-axis"><span>${label(series[0]?.day)}</span><span>${label(series.at(-1)?.day)}</span></div>`;
}

export function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Very small syntax highlighter for the marketing code samples (trusted, static input). */
export function highlight(code: string): SafeHtml {
  const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tokens = /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|const|await|if|return|new|async|function|export|else|throw)\b|\b(\d[\d_]*)\b|(\.[a-zA-Z_]\w*)(?=\()|\b([a-zA-Z_]\w*)(?=\s*:)/g;
  const out = escaped.replace(tokens, (match, comment, str, kw, num, fn, prop) => {
    if (comment) return `<span class="tok-c">${comment}</span>`;
    if (str) return `<span class="tok-s">${str}</span>`;
    if (kw) return `<span class="tok-k">${kw}</span>`;
    if (num) return `<span class="tok-n">${num}</span>`;
    if (fn) return `.<span class="tok-f">${fn.slice(1)}</span>`;
    if (prop) return `<span class="tok-p">${prop}</span>`;
    return match;
  });
  return raw(out);
}
