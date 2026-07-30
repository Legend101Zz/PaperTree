// db/ownership.spec — EPIC-00 acceptance test.
//
//   "Every query helper requires an owner argument. A query built without one fails to
//    compile (TS) / raises (Python)."
//
// The COMPILE half lives in ./ownership-types.spec.ts, which is a real compile-time
// assertion rather than a comment claiming one. This file covers the runtime half:
//   · the forged-owner escape,
//   · cross-owner READ of papers / blocks / highlights / anchors / derivations,
//   · cross-owner WRITE (findings.md §F1),
//   · a multi-table join keeping the owner filter on EVERY joined table (§F3),
//   · and a schema-level audit that every owned table's foreign keys carry owner_id, so a
//     future migration cannot quietly remove the property the design rests on.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  asBlockId,
  asPaperId,
  generation,
  openDatabase,
  OwnershipError,
  type BlockId,
  type DerivationId,
  type HighlightId,
  type OwnerId,
  type PaperId,
  type PaperTreeDb,
} from '../src/index.js';
import { blockIdFor, makePaper } from './fixtures.js';

const GEN = generation(1);

interface Tenant {
  readonly owner: OwnerId;
  /** The `users.user_id`. NOT the same value as `owner` — see the forgery tests below. */
  readonly userId: string;
  readonly paperId: PaperId;
  readonly blockId: BlockId;
  readonly highlightId: HighlightId;
  readonly derivationId: DerivationId;
}

let dir: string;
let file: string;
let db: PaperTreeDb;
let alice: Tenant;
let bob: Tenant;

function seed(handle: PaperTreeDb, email: string, paperId: string, hashChar: string): Tenant {
  const { owner, userId } = handle.createUser(email);
  handle.putPaper(
    owner,
    makePaper({
      paperId,
      sourceHash: `sha256:${hashChar.repeat(64)}`,
      generation: 1,
      blockCount: 8,
    }),
  );
  const blockId = asBlockId(blockIdFor(3));
  const highlightId = handle.createHighlight(owner, {
    paperId: asPaperId(paperId),
    generation: GEN,
    color: 'yellow',
    note: `${email} private note`,
  });
  handle.createAnchor(owner, {
    highlightId,
    paperId: asPaperId(paperId),
    generation: GEN,
    blockId,
    tier: 1,
    polygon: [
      [72, 100],
      [540, 100],
      [540, 110],
      [72, 110],
    ],
    bbox: [72, 100, 540, 110],
    textQuote: `${email} selected text`,
    contentHash: `sha256:${(3).toString(16).padStart(64, '0')}`,
  });
  const derivationId = handle.createDerivation(owner, {
    paperId: asPaperId(paperId),
    generation: GEN,
    kind: 'explanation',
    modelId: 'anthropic/claude-haiku-4.5',
    promptHash: 'sha256:deadbeefdeadbeef',
    content: { text: `${email} explanation root` },
    derivedFrom: [blockId],
  });
  handle.createDerivation(owner, {
    paperId: asPaperId(paperId),
    generation: GEN,
    kind: 'explanation',
    modelId: 'anthropic/claude-haiku-4.5',
    promptHash: 'sha256:deadbeefdeadbeef',
    content: { text: `${email} explanation child` },
    derivedFrom: [blockId],
    parentDerivationId: derivationId,
  });
  return { owner, userId, paperId: asPaperId(paperId), blockId, highlightId, derivationId };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'papertree-own-'));
  file = join(dir, 'papertree.sqlite');
  db = openDatabase({ filename: file });
  db.migrate();
  alice = seed(db, 'alice@papertree.test', 'ppr_0000000000000000000000ALIC', 'a');
  bob = seed(db, 'bob@papertree.test', 'ppr_00000000000000000000000BOB', 'b');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the owner cannot be forged', () => {
  it('rejects a string cast to OwnerId', () => {
    const forged = 'usr_not_a_real_owner' as unknown as OwnerId;
    expect(() => db.listPapers(forged)).toThrow(OwnershipError);
  });

  it('rejects an owner handle minted by a DIFFERENT connection', () => {
    const fresh = openDatabase({ filename: file });
    try {
      fresh.migrate();
      // `alice.owner` is a genuine handle, but THIS connection has not minted it.
      expect(() => fresh.listPapers(alice.owner)).toThrow(OwnershipError);
      // Minting on THIS connection is the supported path, and it works.
      const reminted = fresh.ownerFor(alice.userId);
      expect(fresh.listPapers(reminted)).toHaveLength(1);
    } finally {
      fresh.close();
    }
  });

  it("rejects a CURRENTLY-AUTHENTICATED tenant's user id cast to OwnerId", () => {
    // THE REGRESSION THIS TEST EXISTS FOR. The first design of gate 3 kept a set of minted
    // USER IDS, so `bobUserId as OwnerId` was rejected only until Bob logged in — and in a
    // one-process, one-connection deployment every real tenant is minted forever. An
    // adversarial review reproduced findings.md §F1 through it exactly: cross-tenant read
    // AND write of another user's highlight, using nothing but a cast and a user id.
    //
    // Bob is authenticated on THIS connection right now (beforeEach seeded him), and his
    // user id is not a secret: it appears in URLs, logs and emails.
    expect(db.getHighlight(bob.owner, bob.highlightId)?.note).toBe(
      'bob@papertree.test private note',
    );

    const forged = bob.userId as unknown as OwnerId;
    expect(() => db.getHighlight(forged, bob.highlightId)).toThrow(OwnershipError);
    expect(() => db.updateHighlightNote(forged, bob.highlightId, 'pwned')).toThrow(OwnershipError);
    expect(() => db.listPapers(forged)).toThrow(OwnershipError);

    // …and Bob's row is untouched, so the rejection happened before any statement ran.
    expect(db.getHighlight(bob.owner, bob.highlightId)?.note).toBe(
      'bob@papertree.test private note',
    );
  });

  it('an OwnerId is not the user id, so knowing the user id buys nothing', () => {
    expect(String(alice.owner)).not.toBe(alice.userId);
    expect(String(alice.owner).includes(alice.userId)).toBe(false);
    // The handle is not stored anywhere a tenant could read it back out.
    const raw = new Database(file, { readonly: true });
    try {
      const hit = raw
        .prepare<[string], { n: number }>('SELECT count(*) AS n FROM users WHERE user_id = ?')
        .get(String(alice.owner));
      expect(hit?.n).toBe(0);
    } finally {
      raw.close();
    }
  });

  it('refuses to mint an owner for a user that does not exist', () => {
    expect(() => db.ownerFor('usr_nobody')).toThrow(OwnershipError);
  });

  it('ownerFor is a SEAM, it is meant to be, and it is written down here', () => {
    // The gate-3 argument above says a user id buys you nothing. That is true of code holding
    // only an owner handle — a request handler — and it is the property the handle design
    // exists for. It is NOT true of code that can reach `ownerFor`: one legal, type-clean,
    // cast-free call turns Bob's public user id into a working owner for Bob.
    //
    // "No auth beyond a `users` table" is a stated non-goal of Epic 0, so the seam is
    // INTENDED. But the method was called `authenticate` until an acceptance review pointed
    // out that the name asserted the opposite, and an intended seam nobody wrote down is
    // indistinguishable from an oversight. So: THE MINT BELONGS OUTSIDE THE REQUEST HANDLER.
    const seam = db.ownerFor(bob.userId);
    expect(db.getHighlight(seam, bob.highlightId)?.note).toBe('bob@papertree.test private note');
  });

  it('the connection is unreachable by any LANGUAGE operation, and that is the whole claim', () => {
    // Gate 1, asserted rather than asserted-about. What this does NOT cover is in-process
    // arbitrary code: `node:inspector` reads ES private fields and monkeypatching
    // `Map.prototype.get` subverts `#resolve`. Code that can do either could equally require
    // better-sqlite3 and open the file itself — the boundary is the process, not the class.
    // See the "WHAT GATE 1 IS NOT" paragraph in database.ts.
    expect(Object.getOwnPropertyNames(db)).toEqual([]);
    expect(Object.getOwnPropertySymbols(db)).toEqual([]);
    expect(JSON.stringify(db)).toBe('{}');
    for (const key of ['db', 'connection', 'conn', 'statements', 'minted']) {
      expect((db as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});

describe('an owner cannot READ another owner', () => {
  it('papers', () => {
    expect(db.getPaper(alice.owner, alice.paperId, GEN)).toBeDefined();
    expect(db.getPaper(alice.owner, bob.paperId, GEN)).toBeUndefined();
    expect(db.listPapers(alice.owner).map((p) => p.paper_id)).toEqual([alice.paperId]);
    expect(db.listGenerations(alice.owner, bob.paperId)).toEqual([]);
  });

  it('blocks and pages', () => {
    expect(db.getBlock(alice.owner, alice.paperId, GEN, alice.blockId)).toBeDefined();
    // Same block_id string — content-derived ids are not secret — but Bob's paper.
    expect(db.getBlock(alice.owner, bob.paperId, GEN, bob.blockId)).toBeUndefined();
    expect(db.listBlocksInDocOrder(alice.owner, bob.paperId, GEN)).toEqual([]);
    expect(db.listBlocksOnPage(alice.owner, bob.paperId, GEN, 0)).toEqual([]);
    expect(db.listPages(alice.owner, bob.paperId, GEN)).toEqual([]);
    expect(db.countBlocks(alice.owner, bob.paperId, GEN)).toBe(0);
    expect(db.listRelations(alice.owner, bob.paperId, GEN)).toEqual([]);
  });

  it("highlights — findings.md §F1's read vector", () => {
    expect(db.getHighlight(alice.owner, alice.highlightId)).toBeDefined();
    expect(db.getHighlight(alice.owner, bob.highlightId)).toBeUndefined();
    expect(db.listHighlights(alice.owner, bob.paperId, GEN)).toEqual([]);
  });

  it('anchors', () => {
    expect(db.listAnchors(alice.owner, alice.highlightId)).toHaveLength(1);
    expect(db.listAnchors(alice.owner, bob.highlightId)).toEqual([]);
  });

  it('derivations', () => {
    expect(db.getDerivation(alice.owner, alice.derivationId)).toBeDefined();
    expect(db.getDerivation(alice.owner, bob.derivationId)).toBeUndefined();
  });
});

describe('an owner cannot WRITE another owner — findings.md §F1', () => {
  it('an update scoped to Alice does not touch Bob’s highlight', () => {
    const before = db.getHighlight(bob.owner, bob.highlightId);
    expect(before?.note).toBe('bob@papertree.test private note');

    const changed = db.updateHighlightNote(alice.owner, bob.highlightId, 'pwned');
    expect(changed).toBe(0);

    expect(db.getHighlight(bob.owner, bob.highlightId)?.note).toBe(before?.note);
  });

  it('a delete scoped to Alice does not remove Bob’s highlight', () => {
    expect(db.deleteHighlight(alice.owner, bob.highlightId)).toBe(0);
    expect(db.getHighlight(bob.owner, bob.highlightId)).toBeDefined();
    // …and the owner's own delete does work, so the test is not passing vacuously.
    expect(db.deleteHighlight(bob.owner, bob.highlightId)).toBe(1);
  });

  it('a delete scoped to Alice does not remove Bob’s paper', () => {
    expect(db.deletePaper(alice.owner, bob.paperId)).toBe(0);
    expect(db.getPaper(bob.owner, bob.paperId, GEN)).toBeDefined();
  });

  it('Alice cannot attach a highlight to Bob’s paper', () => {
    expect(() =>
      db.createHighlight(alice.owner, { paperId: bob.paperId, generation: GEN, color: 'red' }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('Alice cannot anchor onto Bob’s block', () => {
    expect(() =>
      db.createAnchor(alice.owner, {
        highlightId: alice.highlightId,
        paperId: bob.paperId,
        generation: GEN,
        blockId: bob.blockId,
        tier: 1,
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        bbox: [0, 0, 1, 1],
      }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('Alice cannot claim a paper_id already bound to Bob', () => {
    expect(() =>
      db.putPaper(
        alice.owner,
        makePaper({
          paperId: bob.paperId,
          sourceHash: `sha256:${'f'.repeat(64)}`,
          generation: 2,
          blockCount: 2,
        }),
      ),
    ).toThrow(OwnershipError);
  });

  it('Alice cannot parent a derivation onto Bob’s derivation tree', () => {
    expect(() =>
      db.createDerivation(alice.owner, {
        paperId: alice.paperId,
        generation: GEN,
        kind: 'explanation',
        modelId: 'm',
        promptHash: 'sha256:abcdabcd',
        content: {},
        derivedFrom: [alice.blockId],
        parentDerivationId: bob.derivationId,
      }),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('joins keep the owner filter on EVERY joined table — findings.md §F3', () => {
  it('highlights ⋈ anchors ⋈ blocks returns only the caller’s rows', () => {
    const mine = db.resolveHighlights(alice.owner, alice.paperId, GEN);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.text_quote).toBe('alice@papertree.test selected text');
    expect(mine[0]?.block_text).toContain('Paragraph 3');
    // The join also surfaces the tier-1 confirmation ADR-001 §E.2 makes mandatory.
    expect(mine[0]?.anchor_content_hash).toBe(mine[0]?.block_content_hash);

    expect(db.resolveHighlights(alice.owner, bob.paperId, GEN)).toEqual([]);
    expect(db.resolveHighlights(bob.owner, alice.paperId, GEN)).toEqual([]);
  });

  it('a derivation tree walk is owner-filtered at EVERY level, not just the root', () => {
    const tree = db.derivationTree(alice.owner, alice.derivationId);
    expect(tree).toHaveLength(2);
    expect(tree.map((d) => d.depth)).toEqual([0, 1]);
    for (const node of tree) expect(node.owner_id).toBe(alice.userId);

    expect(db.derivationTree(alice.owner, bob.derivationId)).toEqual([]);
  });

  it('the tree walk is depth-bounded', () => {
    // findings.md §F3: "There is also no depth or cycle guard."
    let parent = alice.derivationId;
    for (let i = 0; i < 6; i += 1) {
      parent = db.createDerivation(alice.owner, {
        paperId: alice.paperId,
        generation: GEN,
        kind: 'explanation',
        modelId: 'm',
        promptHash: 'sha256:abcdabcd',
        content: { i },
        derivedFrom: [alice.blockId],
        parentDerivationId: parent,
      });
    }
    expect(db.derivationTree(alice.owner, alice.derivationId).length).toBe(8);
    expect(db.derivationTree(alice.owner, alice.derivationId, 2).length).toBe(4);
  });
});

describe('vectors are partitioned by owner', () => {
  it('a KNN search never visits another owner’s partition', () => {
    const embedding = new Float32Array(768);
    embedding[0] = 1;
    db.putBlockVector(alice.owner, alice.paperId, GEN, alice.blockId, 'test-model', embedding);

    const other = new Float32Array(768);
    other[1] = 1;
    db.putBlockVector(bob.owner, bob.paperId, GEN, bob.blockId, 'test-model', other);

    expect(db.countBlockVectors(alice.owner, alice.paperId, GEN)).toBe(1);
    // Alice naming Bob's paper_id addresses the partition "alice/<bob's paper>@1", which
    // does not exist — the partition name is owner-first, so it cannot be aimed elsewhere.
    expect(db.countBlockVectors(alice.owner, bob.paperId, GEN)).toBe(0);

    const hits = db.searchBlockVectors(alice.owner, alice.paperId, GEN, embedding, 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.block_id).toBe(alice.blockId);
    expect(db.searchBlockVectors(alice.owner, bob.paperId, GEN, embedding, 5)).toEqual([]);
  });
});

describe('the schema itself carries the owner (gate 4)', () => {
  // Read from the live database rather than from the .sql text, so this holds against
  // whatever the migrations actually produced — including future ones.
  const OWNED_TABLES = [
    'papers',
    'paper_owners',
    'paper_promotions',
    'pages',
    'blocks',
    'relations',
    'highlights',
    'anchors',
    'derivations',
  ] as const;

  it('every owned table has a NOT NULL owner_id', () => {
    const raw = new Database(file, { readonly: true });
    try {
      for (const table of OWNED_TABLES) {
        const columns = raw
          .prepare<[], { name: string; notnull: number }>(`PRAGMA table_info(${table})`)
          .all();
        const ownerColumn = columns.find((c) => c.name === 'owner_id');
        expect(ownerColumn, `${table} has no owner_id column`).toBeDefined();
        expect(ownerColumn?.notnull, `${table}.owner_id is nullable`).toBe(1);
      }
    } finally {
      raw.close();
    }
  });

  it('every foreign key between owned tables includes owner_id on BOTH sides', () => {
    const raw = new Database(file, { readonly: true });
    try {
      const owned = new Set<string>(OWNED_TABLES);
      let checked = 0;
      for (const table of OWNED_TABLES) {
        const fks = raw
          .prepare<[], { id: number; table: string; from: string; to: string | null }>(
            `PRAGMA foreign_key_list(${table})`,
          )
          .all();
        const byId = new Map<number, { table: string; from: string[]; to: string[] }>();
        for (const fk of fks) {
          const entry = byId.get(fk.id) ?? { table: fk.table, from: [], to: [] };
          entry.from.push(fk.from);
          entry.to.push(fk.to ?? fk.from);
          byId.set(fk.id, entry);
        }
        for (const [, fk] of byId) {
          if (!owned.has(fk.table)) continue; // FKs onto `users` are the owner definition.
          checked += 1;
          expect(fk.from, `${table} -> ${fk.table} omits owner_id on the child side`).toContain(
            'owner_id',
          );
          expect(fk.to, `${table} -> ${fk.table} omits owner_id on the parent side`).toContain(
            'owner_id',
          );
        }
      }
      // Guard against the audit passing because it found nothing to audit.
      expect(checked).toBeGreaterThanOrEqual(8);
    } finally {
      raw.close();
    }
  });

  it('foreign key enforcement is ON — gate 4 is inert without it', () => {
    // The pragma is per-connection and is NEVER stored in the file, so nothing about the
    // schema guarantees it. PaperTreeDb.open sets it explicitly; this is that assertion.
    const raw = new Database(file, { readonly: true });
    try {
      raw.pragma('foreign_keys = OFF');
      expect(raw.pragma('foreign_keys', { simple: true })).toBe(0);
    } finally {
      raw.close();
    }
    expect(() =>
      db.createHighlight(alice.owner, { paperId: bob.paperId, generation: GEN, color: 'red' }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('deleting a user removes their papers, blocks, highlights and vectors', () => {
    const embedding = new Float32Array(768);
    embedding[0] = 1;
    db.putBlockVector(bob.owner, bob.paperId, GEN, bob.blockId, 'test-model', embedding);
    expect(db.countBlockVectors(bob.owner, bob.paperId, GEN)).toBe(1);

    const raw = new Database(file);
    sqliteVec.load(raw); // the papers AFTER DELETE trigger touches the vec0 table
    raw.pragma('foreign_keys = ON');
    raw.prepare('DELETE FROM users WHERE user_id = ?').run(bob.userId);
    raw.close();

    expect(db.getPaper(bob.owner, bob.paperId, GEN)).toBeUndefined();
    expect(db.countBlocks(bob.owner, bob.paperId, GEN)).toBe(0);
    expect(db.getHighlight(bob.owner, bob.highlightId)).toBeUndefined();
    // vec0 cannot cascade; the trigger does it, and it fires under a cascade too.
    expect(db.countBlockVectors(bob.owner, bob.paperId, GEN)).toBe(0);
    // Alice is untouched.
    expect(db.getPaper(alice.owner, alice.paperId, GEN)).toBeDefined();
  });
});
