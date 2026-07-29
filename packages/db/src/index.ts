/**
 * @papertree/db — the SQLite data layer for PaperTree v2 (EPIC-00 F0.5).
 *
 * Two things this package guarantees, and nothing else:
 *
 *   1. The schema lives in `infrastructure/migrations/*.sql` and is applied forward-only by
 *      a runner in each language reading that one directory, so TypeScript and Python
 *      cannot drift onto different schemas.
 *
 *   2. Every query helper structurally requires an owner. Omitting it does not compile,
 *      and forging one does not run. See the header of database.ts for the four gates and
 *      for what findings.md §F says happened without them.
 *
 * NOTE WHAT IS NOT EXPORTED: there is no `Database`, no `prepare`, no `exec` and no
 * connection accessor anywhere in this surface. That is deliberate and it is gate 1.
 */

export { MigrationError, OwnershipError } from './errors.js';

export {
  asBlockId,
  asPageId,
  asPaperId,
  generation,
  newId,
  type AnchorId,
  type BlockId,
  type Branded,
  type DerivationId,
  type Generation,
  type HighlightId,
  type OwnerId,
  type PageId,
  type PaperId,
} from './ids.js';

export {
  appliedMigrations,
  findMigrationsDir,
  loadMigrations,
  migrate,
  splitStatements,
  type AppliedMigration,
  type Migration,
  type MigrationResult,
} from './migrate.js';

export type {
  AnchorRow,
  BlockRow,
  DerivationRow,
  DerivationTreeRow,
  HighlightRow,
  PageRow,
  PaperRow,
  RelationRow,
  ResolvedHighlightRow,
  UserRow,
} from './rows.js';

export {
  MAX_DERIVATION_DEPTH,
  PaperTreeDb,
  VECTOR_DIMENSIONS,
  openDatabase,
  toVectorBlob,
  type AnchorInput,
  type DerivationInput,
  type HighlightInput,
  type OpenOptions,
  type VectorHit,
} from './database.js';
