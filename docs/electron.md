# Electron & desktop apps

Sell a desktop app with license keys: activate the key on first launch, limit how many devices can use it, check it on startup, and keep working offline for a few days.

**You need:** Electron 28+, a Keyvane project with a product, and the project's **publishable key** (`kv_pk_…`). Never ship a secret key in an app.

## Where the code runs

Call Keyvane from the **main process** only and expose a narrow API to the renderer over IPC. Store the key encrypted with Electron's `safeStorage`.

```bash
npm install @keyvane/sdk
```

```ts
// main/license.ts
import { app, ipcMain, safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, hostname, platform } from 'node:os';
import { join } from 'node:path';
import { Keyvane, KeyvaneConnectionError } from '@keyvane/sdk';

const keyvane = new Keyvane({ apiKey: 'kv_pk_...', baseUrl: 'https://keyvane.example.com', timeoutMs: 5_000 });
const file = join(app.getPath('userData'), 'license.bin');
const OFFLINE_DAYS = 7;

const fingerprint = () => createHash('sha256').update([hostname(), platform(), arch(), cpus()[0]?.model].join('|')).digest('hex').slice(0, 32);

type Saved = { key: string; validatedAt?: number; features?: Record<string, boolean> };
const load = (): Saved | null => (existsSync(file) ? JSON.parse(safeStorage.decryptString(readFileSync(file))) : null);
const save = (s: Saved) => writeFileSync(file, safeStorage.encryptString(JSON.stringify(s)));

ipcMain.handle('license:activate', async (_e, key: string) => {
  const result = await keyvane.licenses.activate({ key, fingerprint: fingerprint(), name: `${hostname()} (${platform()})` });
  if (!result.valid) return { ok: false, code: result.code, message: result.message };
  save({ key: result.license!.key, validatedAt: Date.now(), features: { export: result.entitlements?.can('export') ?? false } });
  return { ok: true, plan: result.license?.plan?.name };
});

ipcMain.handle('license:status', async () => {
  const saved = load();
  if (!saved) return { ok: false, code: 'no_license' };
  try {
    const result = await keyvane.licenses.validate({ key: saved.key, fingerprint: fingerprint() });
    if (result.valid) save({ ...saved, validatedAt: Date.now(), features: { export: result.entitlements?.can('export') ?? false } });
    return { ok: result.valid, code: result.code, message: result.message, features: result.valid ? load()?.features : {} };
  } catch (err) {
    const fresh = saved.validatedAt && Date.now() - saved.validatedAt < OFFLINE_DAYS * 86_400_000;
    if (err instanceof KeyvaneConnectionError && fresh) return { ok: true, offline: true, features: saved.features };
    throw err;
  }
});

ipcMain.handle('license:deactivate', async () => {
  const saved = load();
  if (saved) await keyvane.licenses.deactivate({ key: saved.key, fingerprint: fingerprint() });
});
```

## What your customers experience

| Situation | Result |
|---|---|
| First launch | Enter the key once; the device is activated |
| Key used on too many devices | `activation_limit_reached`: offer to deactivate another device |
| Subscription canceled or key revoked | `valid: false` on the next check, with a reason you can show |
| Offline | Works for up to 7 days after the last successful check |

You can see and remove each device on the license page of the Keyvane dashboard. The [license CLI example](../examples/license-cli) implements the same flow without Electron.

Next: [License keys & devices](license-keys.md)
