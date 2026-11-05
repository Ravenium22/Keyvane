/**
 * Tiny, dependency-free HTML templating with escaping by default.
 *
 *   html`<p>${userInput}</p>`   -> userInput is escaped
 *   html`<div>${html`<b>ok</b>`}</div>` -> nested templates are not double-escaped
 *   raw(trustedString)        -> opt out of escaping (only for trusted content)
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export type HtmlChild =
  | SafeHtml
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly HtmlChild[];

function renderChild(child: HtmlChild): string {
  if (child === null || child === undefined || typeof child === 'boolean') return '';
  if (child instanceof SafeHtml) return child.value;
  if (Array.isArray(child)) return child.map((c: HtmlChild) => renderChild(c)).join('');
  if (typeof child === 'number' || typeof child === 'bigint') return String(child);
  return escapeHtml(String(child));
}

export function html(strings: TemplateStringsArray, ...values: HtmlChild[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += renderChild(values[i]) + (strings[i + 1] ?? '');
  }
  return new SafeHtml(out);
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

/** Serialize a value as JSON that is safe to embed inside a <script type="application/json"> tag. */
export function jsonForScript(value: unknown): SafeHtml {
  return new SafeHtml(
    JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026'),
  );
}
