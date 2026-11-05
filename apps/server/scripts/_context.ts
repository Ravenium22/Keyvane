import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/db/migrations.ts';
import { Db } from '../src/db/sqlite.ts';
import type { Ctx } from '../src/types.ts';

/** Open the same database and secret the server uses (respects DATABASE_PATH / KEYVANE_SECRET). */
export function openContext(): Ctx {
  const config = loadConfig();
  const db = new Db(config.databasePath);
  migrate(db);
  return { db, config, now: () => new Date() };
}

export function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
      if (inline !== undefined) flags[name] = inline;
      else if (argv[i + 1] && !argv[i + 1]?.startsWith('--')) flags[name] = argv[++i] as string;
      else flags[name] = true;
    } else positional.push(arg);
  }
  return { positional, flags };
}
