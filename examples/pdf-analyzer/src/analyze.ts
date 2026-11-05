import { inflateSync } from 'node:zlib';

/**
 * A deliberately tiny "AI" PDF analysis so the example has no external dependencies.
 * Swap `analyzePdf` for a call to your favourite model — the Keyvane parts stay the same.
 */
export interface Analysis {
  pages: number;
  words: number;
  title: string | null;
  summary: string;
  keywords: string[];
}

const STOP = new Set('the a an and or of to in on for with is are was were be by as at it this that from which not but have has had they their its into can will would also than more such these other'.split(' '));

function extractText(buffer: Buffer): string {
  const source = buffer.toString('latin1');
  const chunks: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(source))) {
    const raw = Buffer.from(match[1] ?? '', 'latin1');
    let content: string;
    try {
      content = inflateSync(raw).toString('latin1');
    } catch {
      content = raw.toString('latin1');
    }
    for (const t of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      const text = t[1] ?? (t[2] ?? '').replace(/\(((?:\\.|[^\\)])*)\)|-?\d+(\.\d+)?/g, (_m, s: string | undefined) => s ?? '');
      chunks.push(text.replace(/\\([()\\])/g, '$1').replace(/\\n/g, ' '));
    }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

export function analyzePdf(buffer: Buffer): Analysis {
  const source = buffer.toString('latin1');
  const pages = (source.match(/\/Type\s*\/Page(?!s)/g) ?? []).length || 1;
  const title = /\/Title\s*\(([^)]{1,200})\)/.exec(source)?.[1] ?? null;
  const text = extractText(buffer);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const counts = new Map<string, number>();
  for (const w of words) {
    const word = w.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (word.length < 4 || STOP.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const keywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
  const summary = words.length
    ? `${words.slice(0, 45).join(' ')}${words.length > 45 ? '…' : ''}`
    : 'This PDF has no extractable text (it may be scanned). A real AI model would run OCR here.';
  return { pages, words: words.length, title, summary, keywords };
}

/** Builds a one-page PDF so you can try the app without hunting for a file. */
export function samplePdf(): Buffer {
  const text = 'Keyvane sample invoice. Customer Alex purchased the Pro plan. Usage limits and feature access are synced from Stripe subscriptions.';
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (Sample invoice) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
