import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate } from './db/migrations.ts';
import { Db } from './db/sqlite.ts';
import { optimizeDatabase, runMaintenance } from './services/maintenance.ts';
import type { Ctx } from './types.ts';

const config = loadConfig();
const db = new Db(config.databasePath);
const applied = migrate(db);
if (applied.length > 0) console.log(`[keyvane] applied migrations: ${applied.join(', ')}`);

const ctx: Ctx = { db, config, now: () => new Date() };
const app = createApp(ctx);

function maintenance() {
  try {
    const report = runMaintenance(ctx);
    optimizeDatabase(ctx);
    const total = Object.values(report).reduce((a, b) => a + b, 0);
    if (total > 0) console.log(`[keyvane] maintenance: ${JSON.stringify(report)}`);
  } catch (err) {
    console.error('[keyvane] maintenance failed:', err);
  }
}
maintenance();
setInterval(maintenance, 6 * 60 * 60_000).unref();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[keyvane] ${config.env} server listening on http://${info.address === '0.0.0.0' ? 'localhost' : info.address}:${info.port}`);
  console.log(`[keyvane] public URL: ${config.publicUrl} · database: ${config.databasePath}`);
});

function shutdown(signal: string) {
  console.log(`[keyvane] ${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
