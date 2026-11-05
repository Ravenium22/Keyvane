import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * Thin wrapper around Node's built-in SQLite driver (`node:sqlite`).
 *
 * - Statements are cached per SQL string.
 * - Parameters are normalized (booleans -> 0/1, undefined -> NULL, Date -> ISO string).
 * - `transaction()` runs a *synchronous* function atomically. Because the driver is
 *   synchronous and Node is single-threaded, no other request can interleave with it.
 */

export type SqlParam = string | number | bigint | boolean | null | undefined | Date | Uint8Array;
type Bindable = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

function normalize(param: SqlParam): Bindable {
  if (param === undefined || param === null) return null;
  if (typeof param === 'boolean') return param ? 1 : 0;
  if (param instanceof Date) return param.toISOString();
  return param;
}

type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

export class Db {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    if (path !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL');
      this.raw.exec('PRAGMA synchronous = NORMAL');
    }
  }

  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.statement(sql).get(...params.map(normalize)) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlParam[]): T[] {
    return this.statement(sql).all(...params.map(normalize)) as T[];
  }

  run(sql: string, ...params: SqlParam[]): RunResult {
    const result = this.statement(sql).run(...params.map(normalize));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** INSERT a row from an object. Column names come from code, never from user input. */
  insert(table: string, row: Record<string, SqlParam>): void {
    const columns = Object.keys(row);
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    this.run(sql, ...columns.map((c) => row[c]));
  }

  /** UPDATE columns of the row matching `where` (all keys ANDed). Skips undefined values. */
  update(table: string, where: Record<string, SqlParam>, patch: Record<string, SqlParam>): number {
    const sets = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (sets.length === 0) return 0;
    const conds = Object.keys(where);
    const sql = `UPDATE ${table} SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE ${conds
      .map((k) => `${k} = ?`)
      .join(' AND ')}`;
    return this.run(sql, ...sets.map(([, v]) => v), ...conds.map((k) => where[k])).changes;
  }

  transaction<T>(fn: () => NotPromise<T>): T {
    const savepoint = `sp_${this.depth}`;
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE');
    else this.raw.exec(`SAVEPOINT ${savepoint}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      if (this.depth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      this.depth--;
      if (this.depth === 0) this.raw.exec('ROLLBACK');
      else {
        this.raw.exec(`ROLLBACK TO ${savepoint}`);
        this.raw.exec(`RELEASE ${savepoint}`);
      }
      throw err;
    }
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
