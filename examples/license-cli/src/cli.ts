#!/usr/bin/env node
/**
 * A tiny "desktop app" licensed with Keyvane license keys.
 *
 *   npm run cli -- activate KV-XXXXX-XXXXX-XXXXX-XXXXX   register this machine
 *   npm run cli -- status                               show the license and what it unlocks
 *   npm run cli -- export report.pdf                    a Pro-only feature
 *   npm run cli -- deactivate                           free this machine's seat
 *
 * It uses a publishable key (safe to embed) and tolerates short outages with an offline
 * grace period: the last successful validation keeps working for a few days.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, homedir, hostname, platform, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { Keyvane, KeyvaneConnectionError, type LicenseValidation } from '@keyvane/sdk';

const PRODUCT = process.env.KEYVANE_PRODUCT ?? 'pdf-analyzer';
const STATE_FILE = process.env.LICENSE_FILE ?? join(homedir(), '.config', 'keyvane-example-cli', 'license.json');
const OFFLINE_GRACE_DAYS = 7;

interface State {
  key: string;
  lastValidatedAt?: string;
  plan?: string;
  features?: Record<string, boolean>;
}

// Keyvane: a publishable key (kv_pk_…) from KEYVANE_PUBLISHABLE_KEY.
const keyvane = new Keyvane({ timeoutMs: 5_000 });

/** A stable, privacy-friendly identifier for this machine (never sent in clear text). */
function fingerprint(): string {
  const parts = [hostname(), platform(), arch(), cpus()[0]?.model ?? '', userInfo().username];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

const load = (): State | null => (existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State) : null);
const save = (state: State) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
};

function remember(state: State, result: LicenseValidation): void {
  const features: Record<string, boolean> = {};
  for (const key of Object.keys(result.entitlements?.features ?? {})) features[key] = result.entitlements?.can(key) ?? false;
  save({ ...state, lastValidatedAt: new Date().toISOString(), plan: result.license?.plan?.key, features });
}

/** Validate online; fall back to the cached result for a few days if Keyvane is unreachable. */
async function check(): Promise<{ ok: boolean; plan?: string; can: (feature: string) => boolean; note?: string }> {
  const state = load();
  if (!state) return { ok: false, can: () => false, note: 'No license on this machine. Run: activate <key>' };
  try {
    const result = await keyvane.licenses.validate({ key: state.key, fingerprint: fingerprint(), product: PRODUCT });
    if (!result.valid) return { ok: false, can: () => false, note: `${result.message} (${result.code})` };
    remember(state, result);
    return { ok: true, plan: result.license?.plan?.key, can: (f) => result.entitlements?.can(f) ?? false };
  } catch (err) {
    if (err instanceof KeyvaneConnectionError && state.lastValidatedAt) {
      const ageDays = (Date.now() - Date.parse(state.lastValidatedAt)) / 86_400_000;
      if (ageDays < OFFLINE_GRACE_DAYS) {
        return { ok: true, plan: state.plan, can: (f) => state.features?.[f] ?? false, note: `Offline. Using the license check from ${Math.floor(ageDays)} day(s) ago.` };
      }
    }
    throw err;
  }
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case 'activate': {
      if (!arg) throw new Error('Usage: activate <license key>');
      const result = await keyvane.licenses.activate({ key: arg, fingerprint: fingerprint(), name: `${hostname()} (${platform()})`, product: PRODUCT });
      if (!result.valid) throw new Error(`${result.message} (${result.code})`);
      remember({ key: result.license?.key ?? arg }, result);
      console.log(`✔ Activated ${result.license?.product.name}, ${result.license?.plan?.name} plan`);
      console.log(`  Devices in use: ${result.license?.activations}${result.license?.max_activations ? ` of ${result.license.max_activations}` : ''}`);
      break;
    }
    case 'status': {
      const status = await check();
      if (!status.ok) {
        console.log(`✘ Not licensed. ${status.note ?? ''}`);
        process.exitCode = 1;
        break;
      }
      console.log(`✔ Licensed: ${status.plan} plan${status.note ? ` (${status.note})` : ''}`);
      for (const feature of ['pdf_analysis', 'export', 'priority_processing']) console.log(`  ${status.can(feature) ? '✔' : '·'} ${feature}`);
      break;
    }
    case 'export': {
      const status = await check();
      // Keyvane: gate a paid feature on the license's entitlements.
      if (!status.can('export')) {
        console.log('Export is a Pro feature. Upgrade your license to use it.');
        process.exitCode = 2;
        break;
      }
      console.log(`Exporting ${arg ?? 'document.pdf'} to Markdown… done.`);
      break;
    }
    case 'deactivate': {
      const state = load();
      if (!state) return console.log('Nothing to deactivate.');
      const result = await keyvane.licenses.deactivate({ key: state.key, fingerprint: fingerprint() });
      rmSync(STATE_FILE, { force: true });
      console.log(result.deactivated ? '✔ This machine was deactivated; its seat is free again.' : 'This machine was not activated.');
      break;
    }
    default:
      console.log('Commands: activate <key> | status | export [file] | deactivate');
  }
}

main().catch((err: unknown) => {
  console.error(`✘ ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
