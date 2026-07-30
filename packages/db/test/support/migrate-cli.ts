// Applies the migrations to a database file using the TYPESCRIPT runner, and prints the
// MigrationResult as JSON. Exists so the Python test suite can prove that a database
// migrated by one language is a no-op for the other — the drift check that makes
// "infrastructure/migrations is one source of truth" a fact rather than an intention.
//
//   node --import tsx test/support/migrate-cli.ts <path-to-sqlite-file>

import { openDatabase } from '../../src/index.js';

const filename = process.argv[2];
if (filename === undefined) {
  process.stderr.write('usage: migrate-cli.ts <sqlite-file>\n');
  process.exit(2);
}

const db = openDatabase({ filename });
try {
  process.stdout.write(`${JSON.stringify(db.migrate())}\n`);
} finally {
  db.close();
}
