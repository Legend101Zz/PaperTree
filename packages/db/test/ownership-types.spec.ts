// db/ownership.spec, compile-time half — "a query built without an owner FAILS TO COMPILE".
//
// HOW THIS IS A REAL ASSERTION AND NOT A COMMENT:
//
// `@ts-expect-error` inverts the compiler. The line below it MUST fail to typecheck; if it
// ever starts compiling, TypeScript emits TS2578 "Unused '@ts-expect-error' directive" and
// `tsc --noEmit` exits non-zero. tsconfig.json includes `test/**/*.ts`, so the package's
// typecheck script covers this file. The failure mode is therefore the right way round:
// weakening the API turns the build red rather than turning this file into a stale claim.
//
// The illegal calls sit inside a function that is never invoked. The runtime half of
// ownership is in ./ownership.spec.ts; nothing here executes.

import { describe, expect, it } from 'vitest';
import {
  asBlockId,
  asPaperId,
  generation,
  openDatabase,
  PaperTreeDb,
  type Generation,
  type HighlightId,
  type OwnerId,
  type PaperId,
} from '../src/index.js';

function illegalCalls(): void {
  const db = openDatabase();
  const owner: OwnerId = db.createUser('compile@papertree.test').owner;
  const paperId: PaperId = asPaperId('ppr_x');
  const gen: Generation = generation(1);

  // ── 1. Omitting the owner is an arity error, not a lint warning ───────────────────
  // @ts-expect-error owner is required: TS2554 Expected 3 arguments, but got 2.
  db.getPaper(paperId, gen);
  // @ts-expect-error owner is required.
  db.listPapers();
  // @ts-expect-error owner is required.
  db.listBlocksInDocOrder(paperId, gen);
  // @ts-expect-error owner is required.
  db.resolveHighlights(paperId, gen);
  // @ts-expect-error owner is required.
  db.searchBlockVectors(paperId, gen, new Float32Array(768), 5);

  // ── 2. A bare string is not an OwnerId ────────────────────────────────────────────
  // @ts-expect-error TS2345: 'string' is not assignable to 'OwnerId'.
  db.listPapers('usr_01JABCDEF');
  // @ts-expect-error a user id read out of a request body is still just a string.
  db.getPaper('usr_01JABCDEF', paperId, gen);

  // ── 3. Ids are not interchangeable, so the arguments cannot be transposed ─────────
  // @ts-expect-error TS2345: 'PaperId' is not assignable to 'OwnerId'.
  db.listPapers(paperId);
  // @ts-expect-error transposing owner and paper is TS2345 on the first argument.
  db.getPaper(paperId, owner, gen);
  // @ts-expect-error a BlockId is not a PaperId.
  db.getPaper(owner, asBlockId('blk_x'), gen);
  // @ts-expect-error a raw number is not a validated Generation.
  db.getPaper(owner, paperId, 1);

  // ── 4. The connection is unreachable, so no unscoped SQL can be written ───────────
  // @ts-expect-error there is no `db` property, no prepare(), no exec(), by design.
  db.prepare('SELECT * FROM highlights WHERE highlight_id = ?');
  // @ts-expect-error PaperTreeDb has no connection accessor.
  const noConnection: unknown = db.connection;
  // @ts-expect-error the constructor is private: PaperTreeDb.open() is the only door.
  const noConstructor: unknown = new PaperTreeDb();
  void noConnection;
  void noConstructor;

  // ── 5. Owner-scoped writes cannot be called unscoped either ───────────────────────
  const highlightId = db.createHighlight(owner, { paperId, generation: gen, color: 'yellow' });
  // @ts-expect-error the §F1 write vector — update by id alone — does not typecheck.
  db.updateHighlightNote(highlightId, 'pwned');
  // @ts-expect-error nor does the delete.
  db.deleteHighlight(highlightId);
  // @ts-expect-error nor the derivation-tree walk that §F3 got wrong.
  db.derivationTree(highlightId as unknown as HighlightId);

  db.close();
}

describe('db/ownership.spec — compile-time', () => {
  it('asserts at compile time; this case only proves the file is reachable', () => {
    expect(typeof illegalCalls).toBe('function');
  });
});
