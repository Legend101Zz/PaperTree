// Forward-only migration runner.
//
// The migrations are plain .sql files in infrastructure/migrations/, read by BOTH this
// runner and papertree_db/migrate.py. Neither language holds a copy of the DDL, so the
// two schemas cannot drift; the only thing duplicated is this ~90 lines of bookkeeping,
// and the checksum test proves the duplication agrees.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { MigrationError } from './errors.js';

/** `NNNN_name.sql` — the number is the version and orders application. */
const MIGRATION_FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/**
 * Statement separator. A bare ';' split cuts `CREATE TRIGGER … BEGIN … END;` in half, and
 * better-sqlite3's `exec()` cannot report which statement of a batch failed, so the runner
 * executes statements one at a time against an explicit delimiter.
 */
const STATEMENT_SEPARATOR = /^\s*--;;\s*$/m;

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly statements: readonly string[];
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  /** Versions applied by THIS call. Empty on a re-run — that is the no-op assertion. */
  readonly applied: readonly number[];
  /** Every version now recorded in the database, ascending. */
  readonly head: readonly number[];
}

/**
 * Walks up from this file looking for `infrastructure/migrations`. Resolving by walking
 * rather than by a fixed `../../..` keeps the TS and Python runners agreeing on one
 * directory even though their source files sit at different depths.
 */
export function findMigrationsDir(
  startFrom: string = dirname(fileURLToPath(import.meta.url)),
): string {
  let dir = resolve(startFrom);
  for (;;) {
    const candidate = join(dir, 'infrastructure', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new MigrationError(`no infrastructure/migrations directory above ${startFrom}`);
    }
    dir = parent;
  }
}

export function loadMigrations(dir: string = findMigrationsDir()): readonly Migration[] {
  const migrations: Migration[] = [];
  const seen = new Set<number>();
  for (const filename of readdirSync(dir).toSorted()) {
    const match = MIGRATION_FILENAME.exec(filename);
    if (match === null) {
      if (filename.endsWith('.sql')) {
        throw new MigrationError(`migration filename must be NNNN_name.sql, got ${filename}`);
      }
      continue;
    }
    const version = Number.parseInt(match[1] as string, 10);
    if (seen.has(version)) throw new MigrationError(`duplicate migration version ${version}`);
    seen.add(version);
    const sql = readFileSync(join(dir, filename), 'utf8');
    migrations.push({
      version,
      name: match[2] as string,
      checksum: `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`,
      statements: splitStatements(sql),
    });
  }
  if (migrations.length === 0) throw new MigrationError(`no migrations found in ${dir}`);
  return migrations.toSorted((a, b) => a.version - b.version);
}

export function splitStatements(sql: string): readonly string[] {
  return sql
    .split(STATEMENT_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isCommentOnly(s));
}

function isCommentOnly(statement: string): boolean {
  return statement
    .split('\n')
    .every((line) => line.trim().length === 0 || line.trim().startsWith('--'));
}

const RECORD_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

export function appliedMigrations(db: Database): readonly AppliedMigration[] {
  db.exec(RECORD_TABLE);
  return db
    .prepare<[], { version: number; name: string; checksum: string; applied_at: string }>(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    )
    .all()
    .map((r) => ({
      version: r.version,
      name: r.name,
      checksum: r.checksum,
      appliedAt: r.applied_at,
    }));
}

/**
 * Applies every unapplied migration in version order, each inside its own transaction, and
 * records it. Re-running is a no-op: `result.applied` comes back empty.
 *
 * An already-applied migration whose file has since changed is an ERROR, not a silent
 * skip. Forward-only means the file is immutable once shipped; editing it would leave two
 * databases claiming the same version with different schemas.
 */
export function migrate(db: Database, dir?: string): MigrationResult {
  const migrations = loadMigrations(dir);
  const already = new Map(appliedMigrations(db).map((m) => [m.version, m]));

  for (const m of migrations) {
    const prior = already.get(m.version);
    if (prior !== undefined && prior.checksum !== m.checksum) {
      throw new MigrationError(
        `migration ${m.version} (${m.name}) has changed since it was applied: ` +
          `recorded ${prior.checksum}, on disk ${m.checksum}. Migrations are forward-only; ` +
          `add a new numbered file instead of editing this one.`,
      );
    }
  }

  const record = db.prepare<[number, string, string, string]>(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const applied: number[] = [];

  for (const m of migrations) {
    if (already.has(m.version)) continue;
    const run = db.transaction(() => {
      for (const statement of m.statements) db.exec(statement);
      record.run(m.version, m.name, m.checksum, new Date().toISOString());
    });
    run();
    applied.push(m.version);
  }

  return { applied, head: migrations.map((m) => m.version) };
}
