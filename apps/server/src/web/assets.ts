import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static assets (CSS, JS, fonts, brand images) are read once at startup and served from
 * /assets/<path>. CSS/JS/SVG get content-hashed URLs so they can be cached forever.
 */

interface Asset {
  body: Buffer;
  type: string;
  hash: string;
}

const TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json',
};

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const assets = new Map<string, Asset>();

function walk(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    const ext = name.split('.').pop() ?? '';
    if (!TYPES[ext]) continue;
    const body = readFileSync(full);
    const key = relative(ROOT, full).split('\\').join('/');
    assets.set(key, { body, type: TYPES[ext] as string, hash: createHash('sha256').update(body).digest('hex').slice(0, 10) });
  }
}
walk(ROOT);

export function assetUrl(path: string): string {
  return `/assets/${path}?v=${assets.get(path)?.hash ?? '0'}`;
}

export function getAsset(path: string): Asset | undefined {
  return assets.get(path);
}
