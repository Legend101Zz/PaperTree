// PaperTreeDb — the ONLY way to reach the SQLite connection, and therefore the only place
// SQL exists in this system.
//
// ───────────────────────────────────────────────────────────────────────────────────────
// THE OWNERSHIP MECHANISM, AND WHY IT IS STRUCTURAL
//
// findings.md §F: the v1 app enforced ownership "ad hoc at the call site rather than
// structurally", and grep found 33 query sites with no user_id filter — including a
// cross-tenant WRITE of another user's highlight. The convention was "helpers should take
// a user_id". That convention is what failed. So this package does not have one.
//
// Four independent gates, each of which alone would be a convention and all of which
// together make the unsafe query UNWRITEABLE rather than merely discouraged:
//
//   1. THE CONNECTION IS NOT REACHABLE. `#db` is a JavaScript private field, and
//      package.json's `exports` map publishes only `./src/index.ts`. There is no export,
//      accessor or escape hatch that yields a `Database`. A caller cannot write SQL at
//      all, so they cannot write SQL that forgets a WHERE clause. Every statement in the
//      process is one of the statements below.
//
//   2. EVERY DATA METHOD TAKES `owner: OwnerId` AS ITS FIRST PARAMETER. Omitting it is
//      not a lint warning, it is `TS2554: Expected 3 arguments, but got 2`. There is no
//      overload, no optional owner, and no unscoped sibling method — so the safe call is
//      the only call that exists, and the unsafe one is not a plausible-looking mistake.
//
//   3. `OwnerId` CANNOT BE CONJURED FROM A STRING. It is a branded type (ids.ts) minted in
//      exactly one place, `authenticate()`, which requires a real `users` row. Passing a
//      user id string is `TS2345: Argument of type 'string' is not assignable to
//      parameter of type 'OwnerId'`. The one remaining escape is the cast `x as OwnerId`,
//      and it is closed at runtime because AN OwnerId IS NOT A USER ID — it is an opaque
//      per-connection handle backed by 32 bytes of CSPRNG output that appears nowhere in
//      the database, a URL, a log or an email (see `#resolve`). Casting a value you can
//      name gets you nothing WITHIN a request handler that was given one owner handle and no
//      mint access, because the value the check wants is one you cannot name. It is not a
//      claim about the process as a whole: a caller that can reach `ownerFor` is inside the
//      trust boundary by construction and can mint an owner for any user id it can name —
//      see `ownerFor`, which says so, and `ownership.spec`'s "ownerFor is a seam".
//
//      This is the second design of gate 3 and the first one was WRONG, which is worth
//      recording. It kept a set of minted USER IDS, so `bobUserId as OwnerId` was rejected
//      only until Bob logged in — and in the deployment this package targets (one process,
//      one long-lived SQLite connection, many tenants) every real user is minted forever.
//      An adversarial review reproduced findings.md §F1 verbatim through it: cross-tenant
//      read AND write of another user's highlight, using nothing but a cast and a user id.
//      A secret that every tenant already knows is not a secret.
//
//   4. THE SCHEMA CARRIES THE OWNER IN EVERY FOREIGN KEY. Even if all of the above were
//      bypassed, `anchors` references `blocks (owner_id, paper_id, generation, block_id)`
//      and `derivations.parent_derivation_id` references `derivations (owner_id,
//      derivation_id)`. A cross-tenant row cannot be INSERTed, and — the point for the
//      §F3 join bug — every join key is owner-qualified, so a join that omitted the owner
//      predicate on a joined table still cannot cross tenants.
//
// Gates 1–3 are compile-time and are asserted by test/ownership-types.spec.ts with
// `@ts-expect-error`. Gate 4 is asserted by test/ownership.spec.ts, which reads
// PRAGMA foreign_key_list and fails if any owned table gains an FK that drops owner_id.
//
// WHAT GATE 1 IS NOT. `#db` is unreachable by any LANGUAGE-LEVEL operation — no export,
// accessor, cast, subclass, Proxy or property enumeration yields it, and that is asserted
// by reflection in ownership.spec.ts. It is NOT proof against in-process arbitrary code:
// `node:inspector` is stdlib and needs no flags, and `Runtime.getProperties` enumerates ES
// private fields and hands back live references to `#db`, `#statements` and `#minted`;
// monkeypatching `Map.prototype.get` subverts `#resolve` without the inspector at all. Code
// that can do either has already beaten every same-process guard — it could equally
// `require("better-sqlite3")` and open the file directly. THE BOUNDARY IS THE PROCESS, not
// the class, and no arrangement of private fields moves it.
//
// The alternative designs considered and rejected: (a) a query builder that refuses to
// emit SQL without an owner clause — it can only pattern-match its own output, and cannot
// see whether the clause reached every JOINed table, which is exactly the bug in §F3;
// (b) an `assertOwns(user, resource)` helper — that is a convention, and §F5 records what
// happened to the last one.
// ───────────────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import type { Paper } from '@papertree/document-ir';
import SqliteDatabase from 'better-sqlite3';
import type { Database, Statement } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { OwnershipError } from './errors.js';
import type {
  AnchorId,
  BlockId,
  DerivationId,
  Generation,
  HighlightId,
  OwnerId,
  PageId,
  PaperId,
} from './ids.js';
import { generation as brandGeneration, newId } from './ids.js';
import { migrate, type MigrationResult } from './migrate.js';
import type {
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

/** Embedding width declared by `block_vectors` in 0001_core.sql. */
export const VECTOR_DIMENSIONS = 768;

/** Hard cap on derivation-tree traversal. findings.md §F3: "no depth or cycle guard". */
export const MAX_DERIVATION_DEPTH = 64;

export interface OpenOptions {
  /** SQLite file. Defaults to `:memory:`, which is what the tests use. */
  readonly filename?: string;
  /** Override the migrations directory. Defaults to the one found by walking up. */
  readonly migrationsDir?: string;
}

export interface HighlightInput {
  readonly paperId: PaperId;
  readonly generation: Generation;
  readonly color: string;
  readonly note?: string | undefined;
}

export interface AnchorInput {
  readonly highlightId: HighlightId;
  readonly paperId: PaperId;
  readonly generation: Generation;
  readonly blockId: BlockId;
  /** 1 = block id, 2 = content hash, 3 = geometric fallback (ADR-001 §E.2). */
  readonly tier: 1 | 2 | 3;
  readonly polygon: readonly (readonly [number, number])[];
  readonly bbox: readonly [number, number, number, number];
  readonly charStart?: number | undefined;
  readonly charEnd?: number | undefined;
  readonly textQuote?: string | undefined;
  readonly quotePrefix?: string | undefined;
  readonly quoteSuffix?: string | undefined;
  readonly contentHash?: string | undefined;
}

export interface DerivationInput {
  readonly paperId: PaperId;
  readonly generation: Generation;
  readonly kind: string;
  readonly modelId: string;
  readonly promptHash: string;
  readonly content: unknown;
  readonly derivedFrom: readonly [BlockId, ...BlockId[]];
  readonly parentDerivationId?: DerivationId | undefined;
}

export interface VectorHit {
  readonly block_id: string;
  readonly distance: number;
}

export class PaperTreeDb {
  readonly #db: Database;
  readonly #statements = new Map<string, Statement<never, unknown>>();
  /**
   * handle -> user_id, for the handles THIS connection minted. See `#resolve`: the handle is
   * unguessable, which is what closes the `'usr_bob' as OwnerId` cast escape for real rather
   * than only for users nobody has logged in as. Bounded by the number of authentications.
   */
  readonly #minted = new Map<string, string>();
  readonly #migrationsDir: string | undefined;

  private constructor(db: Database, migrationsDir: string | undefined) {
    this.#db = db;
    this.#migrationsDir = migrationsDir;
  }

  /**
   * Opens a connection, loads sqlite-vec, and applies the connection pragmas. Does NOT
   * migrate — call `migrate()`, so that "which schema am I on" is never implicit.
   */
  static open(options: OpenOptions = {}): PaperTreeDb {
    const db = new SqliteDatabase(options.filename ?? ':memory:');
    sqliteVec.load(db);
    // foreign_keys is PER-CONNECTION and is never persisted in the file. better-sqlite3
    // happens to default it ON and Python's sqlite3 defaults it OFF — so it is set
    // explicitly here and in migrate.py rather than inherited from either driver's taste.
    // Gate 4 of the ownership mechanism is inert without it.
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    return new PaperTreeDb(db, options.migrationsDir);
  }

  migrate(): MigrationResult {
    return migrate(this.#db, this.#migrationsDir);
  }

  close(): void {
    this.#db.close();
  }

  // ── owner minting ─────────────────────────────────────────────────────────────────

  /** Creates a user and returns their `OwnerId` handle. The only other way to obtain one. */
  createUser(email: string): { readonly userId: string; readonly owner: OwnerId } {
    const userId = newId('usr');
    this.#stmt('INSERT INTO users (user_id, email, created_at) VALUES (?, ?, ?)').run(
      userId,
      email,
      new Date().toISOString(),
    );
    return { userId, owner: this.#mint(userId) };
  }

  /**
   * Turns an ALREADY-VERIFIED user id into an owner handle.
   *
   * THIS PERFORMS NO AUTHENTICATION, and it was called `authenticate` until an adversarial
   * review pointed out that the name asserted the opposite of what the body does. All it checks
   * is that a `users` row exists; "no auth beyond a `users` table" is a stated non-goal of Epic
   * 0, so that is the intended contract — but it must be stated rather than implied by a name.
   *
   * THE CALLER IS THE TRUST BOUNDARY. Passing a user id taken from a request — a path
   * parameter, a header, an unverified cookie — is findings.md §F1, and no gate in this package
   * can stop it: gate 3 makes a user id worthless to code that holds only an owner handle,
   * which is precisely the code inside a request handler. Code that can reach `ownerFor` is
   * inside the trust boundary by construction, so keep the mint out of the handler and hand the
   * handler its one handle.
   */
  ownerFor(userId: string): OwnerId {
    const row = this.#stmt<[string], UserRow>('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (row === undefined) throw new OwnershipError(`no such user: ${userId}`);
    return this.#mint(userId);
  }

  /** Issues an unguessable handle for a user id that has just been proven to exist. */
  #mint(userId: string): OwnerId {
    const handle = `own_${randomBytes(32).toString('base64url')}`;
    this.#minted.set(handle, userId);
    return handle as OwnerId;
  }

  // ── papers ────────────────────────────────────────────────────────────────────────

  /**
   * Writes one PaperIR generation — the paper row, its pages, blocks and relations — in a
   * single transaction with prepared statements. This is the 30k-block path measured by
   * db/migrations.spec.
   *
   * `paper_owners` is INSERT OR IGNOREd first, so a re-parse reuses the existing paper_id
   * ↔ owner binding and a second owner claiming the same paper_id is rejected explicitly
   * rather than surfacing as a bare FOREIGN KEY error.
   */
  putPaper(ownerHandle: OwnerId, paper: Paper): void {
    const owner = this.#resolve(ownerHandle);
    const now = new Date().toISOString();
    const gen = brandGeneration(paper.generation);

    const write = this.#db.transaction(() => {
      this.#stmt(
        'INSERT OR IGNORE INTO paper_owners (paper_id, owner_id, source_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(paper.paper_id, owner, paper.source_hash, now);
      const bound = this.#stmt<[string], { owner_id: string }>(
        'SELECT owner_id FROM paper_owners WHERE paper_id = ?',
      ).get(paper.paper_id);
      if (bound !== undefined && bound.owner_id !== owner) {
        throw new OwnershipError(`paper ${paper.paper_id} belongs to another owner`);
      }

      this.#stmt(
        `INSERT INTO papers (owner_id, paper_id, generation, source_hash, ir_version, coordinate_space,
           parser_name, parser_version, parser_config_hash, parser_profile, parsed_at, status,
           partial_reason, metadata, sections, references_json, confidence, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        owner,
        paper.paper_id,
        gen,
        paper.source_hash,
        paper.ir_version,
        paper.coordinate_space,
        paper.parser.name,
        paper.parser.version,
        paper.parser.config_hash,
        paper.parser.profile ?? null,
        paper.parser.parsed_at,
        paper.status,
        paper.partial_reason,
        JSON.stringify(paper.metadata),
        JSON.stringify(paper.sections),
        JSON.stringify(paper.references),
        JSON.stringify(paper.confidence),
        now,
      );

      const insertPage = this.#stmt(
        `INSERT INTO pages (owner_id, paper_id, generation, page_id, page_index, width, height,
           rotation, user_unit, crop_box, media_box, image, has_text_layer, is_scanned, confidence)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const page of paper.pages) {
        insertPage.run(
          owner,
          paper.paper_id,
          gen,
          page.page_id,
          page.index,
          page.width,
          page.height,
          page.rotation,
          page.user_unit,
          JSON.stringify(page.crop_box),
          JSON.stringify(page.media_box),
          page.image === null ? null : JSON.stringify(page.image),
          page.has_text_layer ? 1 : 0,
          page.is_scanned ? 1 : 0,
          page.confidence,
        );
      }

      const insertBlock = this.#stmt(
        `INSERT INTO blocks (owner_id, paper_id, generation, block_id, page_index, type, flow, "order",
           doc_order, parent_id, prev_id, next_id, child_ids, polygon, bbox_x0, bbox_y0, bbox_x1, bbox_y1,
           text, text_normalised, content_hash, spans, payload, source, confidence, provenance, repairs,
           alternatives)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const block of paper.blocks) {
        insertBlock.run(
          owner,
          paper.paper_id,
          gen,
          block.block_id,
          block.page_index,
          block.type,
          block.flow,
          block.order,
          block.doc_order ?? null,
          block.parent_id ?? null,
          block.prev_id ?? null,
          block.next_id ?? null,
          block.child_ids === undefined ? null : JSON.stringify(block.child_ids),
          JSON.stringify(block.polygon),
          block.bbox[0],
          block.bbox[1],
          block.bbox[2],
          block.bbox[3],
          block.text ?? null,
          block.text_normalised ?? null,
          block.content_hash ?? null,
          block.spans === undefined ? null : JSON.stringify(block.spans),
          block.payload === undefined ? null : JSON.stringify(block.payload),
          block.source,
          block.confidence,
          JSON.stringify(block.provenance),
          block.repairs === undefined ? null : JSON.stringify(block.repairs),
          block.alternatives === undefined ? null : JSON.stringify(block.alternatives),
        );
      }

      const insertRelation = this.#stmt(
        `INSERT INTO relations (owner_id, paper_id, generation, type, from_block, to_block, confidence, provenance)
         VALUES (?,?,?,?,?,?,?,?)`,
      );
      for (const relation of paper.relations) {
        insertRelation.run(
          owner,
          paper.paper_id,
          gen,
          relation.type,
          relation.from,
          relation.to,
          relation.confidence,
          relation.provenance,
        );
      }
    });
    write();
  }

  getPaper(ownerHandle: OwnerId, paperId: PaperId, generation: Generation): PaperRow | undefined {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, number], PaperRow>(
      'SELECT * FROM papers WHERE owner_id = ? AND paper_id = ? AND generation = ?',
    ).get(owner, paperId, generation);
  }

  listPapers(ownerHandle: OwnerId): readonly PaperRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string], PaperRow>(
      'SELECT * FROM papers WHERE owner_id = ? ORDER BY created_at DESC, generation DESC',
    ).all(owner);
  }

  listGenerations(ownerHandle: OwnerId, paperId: PaperId): readonly number[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string], { generation: number }>(
      'SELECT generation FROM papers WHERE owner_id = ? AND paper_id = ? ORDER BY generation',
    )
      .all(owner, paperId)
      .map((r) => r.generation);
  }

  /** D13/R13: promotion is mutable state, so it lives here and not in the PaperIR document. */
  promoteGeneration(ownerHandle: OwnerId, paperId: PaperId, generation: Generation): void {
    const owner = this.#resolve(ownerHandle);
    this.#stmt(
      `INSERT INTO paper_promotions (owner_id, paper_id, generation, promoted_at) VALUES (?,?,?,?)
       ON CONFLICT (owner_id, paper_id) DO UPDATE SET generation = excluded.generation,
                                                      promoted_at = excluded.promoted_at`,
    ).run(owner, paperId, generation, new Date().toISOString());
  }

  promotedGeneration(ownerHandle: OwnerId, paperId: PaperId): number | undefined {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string], { generation: number }>(
      'SELECT generation FROM paper_promotions WHERE owner_id = ? AND paper_id = ?',
    ).get(owner, paperId)?.generation;
  }

  deletePaper(ownerHandle: OwnerId, paperId: PaperId): number {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt('DELETE FROM paper_owners WHERE owner_id = ? AND paper_id = ?').run(
      owner,
      paperId,
    ).changes;
  }

  // ── pages / blocks / relations ────────────────────────────────────────────────────

  listPages(ownerHandle: OwnerId, paperId: PaperId, generation: Generation): readonly PageRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, number], PageRow>(
      'SELECT * FROM pages WHERE owner_id = ? AND paper_id = ? AND generation = ? ORDER BY page_index',
    ).all(owner, paperId, generation);
  }

  getBlock(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
    blockId: BlockId,
  ): BlockRow | undefined {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, number, string], BlockRow>(
      'SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? AND block_id = ?',
    ).get(owner, paperId, generation, blockId);
  }

  /** Body reading order across pages — the sequence a reader or an audiobook follows. */
  listBlocksInDocOrder(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
  ): readonly BlockRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, number], BlockRow>(
      `SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? AND doc_order IS NOT NULL
       ORDER BY doc_order`,
    ).all(owner, paperId, generation);
  }

  listBlocksOnPage(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
    pageIndex: number,
  ): readonly BlockRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, number, number], BlockRow>(
      `SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? AND page_index = ?
       ORDER BY flow, "order"`,
    ).all(owner, paperId, generation, pageIndex);
  }

  countBlocks(ownerHandle: OwnerId, paperId: PaperId, generation: Generation): number {
    const owner = this.#resolve(ownerHandle);
    return (
      this.#stmt<[string, string, number], { n: number }>(
        'SELECT count(*) AS n FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ?',
      ).get(owner, paperId, generation)?.n ?? 0
    );
  }

  listRelations(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
  ): readonly RelationRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, number], RelationRow>(
      'SELECT * FROM relations WHERE owner_id = ? AND paper_id = ? AND generation = ? ORDER BY type, from_block, to_block',
    ).all(owner, paperId, generation);
  }

  // ── highlights + anchors ──────────────────────────────────────────────────────────

  createHighlight(ownerHandle: OwnerId, input: HighlightInput): HighlightId {
    const owner = this.#resolve(ownerHandle);
    const id = newId('hl');
    const now = new Date().toISOString();
    this.#stmt(
      `INSERT INTO highlights (highlight_id, owner_id, paper_id, generation, color, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, owner, input.paperId, input.generation, input.color, input.note ?? null, now, now);
    return id as HighlightId;
  }

  getHighlight(ownerHandle: OwnerId, highlightId: HighlightId): HighlightRow | undefined {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string], HighlightRow>(
      'SELECT * FROM highlights WHERE owner_id = ? AND highlight_id = ?',
    ).get(owner, highlightId);
  }

  listHighlights(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
  ): readonly HighlightRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, number], HighlightRow>(
      'SELECT * FROM highlights WHERE owner_id = ? AND paper_id = ? AND generation = ? ORDER BY created_at',
    ).all(owner, paperId, generation);
  }

  /**
   * The write that findings.md §F1 got wrong: `update_one({"_id": highlight_id}, ...)`
   * with no owner filter, letting any authenticated user mutate any other user's
   * highlight. Returns the number of rows changed, so "0" is an observable no-op rather
   * than a silent cross-tenant success.
   */
  updateHighlightNote(ownerHandle: OwnerId, highlightId: HighlightId, note: string | null): number {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt(
      'UPDATE highlights SET note = ?, updated_at = ? WHERE owner_id = ? AND highlight_id = ?',
    ).run(note, new Date().toISOString(), owner, highlightId).changes;
  }

  deleteHighlight(ownerHandle: OwnerId, highlightId: HighlightId): number {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt('DELETE FROM highlights WHERE owner_id = ? AND highlight_id = ?').run(
      owner,
      highlightId,
    ).changes;
  }

  createAnchor(ownerHandle: OwnerId, input: AnchorInput): AnchorId {
    const owner = this.#resolve(ownerHandle);
    const id = newId('anc');
    this.#stmt(
      `INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, generation, block_id, tier,
         char_start, char_end, text_quote, quote_prefix, quote_suffix, content_hash, polygon,
         bbox_x0, bbox_y0, bbox_x1, bbox_y1, resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      owner,
      input.highlightId,
      input.paperId,
      input.generation,
      input.blockId,
      input.tier,
      input.charStart ?? null,
      input.charEnd ?? null,
      input.textQuote ?? null,
      input.quotePrefix ?? null,
      input.quoteSuffix ?? null,
      input.contentHash ?? null,
      JSON.stringify(input.polygon),
      input.bbox[0],
      input.bbox[1],
      input.bbox[2],
      input.bbox[3],
      new Date().toISOString(),
    );
    return id as AnchorId;
  }

  listAnchors(ownerHandle: OwnerId, highlightId: HighlightId): readonly AnchorRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string], AnchorRow>(
      'SELECT * FROM anchors WHERE owner_id = ? AND highlight_id = ? ORDER BY tier, anchor_id',
    ).all(owner, highlightId);
  }

  /**
   * THE MULTI-TABLE JOIN. Three tables, and the owner predicate is on EVERY one of them —
   * both as a WHERE on the root and as part of each ON clause. findings.md §F3 is the
   * version of this query that filters the root only.
   *
   * Note the join keys themselves carry owner_id, so this query is owner-safe twice over:
   * once because the predicates say so, and once because `anchors → blocks` is a composite
   * foreign key that includes owner_id and therefore cannot straddle two owners.
   */
  resolveHighlights(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
  ): readonly ResolvedHighlightRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, string, number], ResolvedHighlightRow>(
      `SELECT h.highlight_id, a.anchor_id, b.block_id, a.tier, h.color, h.note, a.text_quote,
              a.content_hash AS anchor_content_hash, b.content_hash AS block_content_hash,
              b.text AS block_text, b.page_index, b.polygon AS block_polygon
         FROM highlights h
         JOIN anchors a
           ON a.owner_id = h.owner_id AND a.highlight_id = h.highlight_id
          AND a.owner_id = ?
         JOIN blocks b
           ON b.owner_id = a.owner_id AND b.paper_id = a.paper_id
          AND b.generation = a.generation AND b.block_id = a.block_id
          AND b.owner_id = h.owner_id
        WHERE h.owner_id = ? AND h.paper_id = ? AND h.generation = ?
        ORDER BY h.created_at, a.tier`,
    ).all(owner, owner, paperId, generation);
  }

  // ── derivations ───────────────────────────────────────────────────────────────────

  createDerivation(ownerHandle: OwnerId, input: DerivationInput): DerivationId {
    const owner = this.#resolve(ownerHandle);
    const id = newId('drv');
    this.#stmt(
      `INSERT INTO derivations (derivation_id, owner_id, paper_id, generation, parent_derivation_id,
         kind, author_kind, model_id, prompt_hash, content, derived_from, created_at)
       VALUES (?,?,?,?,?,?,'model',?,?,?,?,?)`,
    ).run(
      id,
      owner,
      input.paperId,
      input.generation,
      input.parentDerivationId ?? null,
      input.kind,
      input.modelId,
      input.promptHash,
      JSON.stringify(input.content),
      JSON.stringify(input.derivedFrom),
      new Date().toISOString(),
    );
    return id as DerivationId;
  }

  getDerivation(ownerHandle: OwnerId, derivationId: DerivationId): DerivationRow | undefined {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string], DerivationRow>(
      'SELECT * FROM derivations WHERE owner_id = ? AND derivation_id = ?',
    ).get(owner, derivationId);
  }

  /**
   * Walks a derivation tree downward from `rootId`.
   *
   * findings.md §F3 verbatim: "explanations/routes.py:242,246,362,365 walk parent_id chains
   * with find_one({...}) and no user_id. Ownership is checked only at the root. There is
   * also no depth or cycle guard." Both defects are addressed here: the owner predicate is
   * repeated inside the recursive term (so every level is filtered, not just the anchor),
   * and `depth < ?` bounds the walk. A cycle is additionally unrepresentable, because the
   * self-FK is owner-qualified and `parent_derivation_id <> derivation_id` is CHECKed.
   */
  derivationTree(
    ownerHandle: OwnerId,
    rootId: DerivationId,
    maxDepth: number = MAX_DERIVATION_DEPTH,
  ): readonly DerivationTreeRow[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[string, string, string, number, string], DerivationTreeRow>(
      `WITH RECURSIVE tree(derivation_id, depth) AS (
         SELECT d.derivation_id, 0
           FROM derivations d
          WHERE d.owner_id = ? AND d.derivation_id = ?
         UNION ALL
         SELECT c.derivation_id, tree.depth + 1
           FROM derivations c
           JOIN tree ON c.parent_derivation_id = tree.derivation_id
          WHERE c.owner_id = ? AND tree.depth + 1 <= ?
       )
       SELECT d.*, tree.depth AS depth
         FROM derivations d
         JOIN tree ON tree.derivation_id = d.derivation_id
        WHERE d.owner_id = ?
        ORDER BY tree.depth, d.created_at`,
    ).all(owner, rootId, owner, maxDepth, owner);
  }

  // ── block_vectors (sqlite-vec) ────────────────────────────────────────────────────

  /**
   * Stores one block's embedding. Epic 0 does not COMPUTE embeddings — no model, no
   * embedding calls — but the table and this path exist and are exercised so Epic 3
   * inherits an extension proven to load.
   */
  putBlockVector(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
    blockId: BlockId,
    model: string,
    embedding: Float32Array | readonly number[],
  ): void {
    const owner = this.#resolve(ownerHandle);
    const blob = toVectorBlob(embedding);
    const partition = paperKey(owner, paperId, generation);
    const key = `${partition}#${blockId}`;
    const write = this.#db.transaction(() => {
      // vec0 has no UPSERT; delete-then-insert is the supported replace.
      this.#stmt('DELETE FROM block_vectors WHERE vec_key = ?').run(key);
      this.#stmt(
        'INSERT INTO block_vectors (paper_key, vec_key, block_id, model, embedding) VALUES (?,?,?,?,?)',
      ).run(partition, key, blockId, model, blob);
    });
    write();
  }

  /**
   * K-nearest-neighbour search within ONE owner's paper generation.
   *
   * A vec0 table takes no foreign keys and has no owner_id column, so ownership is carried
   * by the PARTITION KEY: `owner/paper@generation`. The partition name can only be built
   * by `paperKey`, which requires an `OwnerId`, so a search never visits another owner's
   * partition — the guarantee is positional rather than predicated, and there is no
   * variant of this call that omits the scope.
   */
  searchBlockVectors(
    ownerHandle: OwnerId,
    paperId: PaperId,
    generation: Generation,
    query: Float32Array | readonly number[],
    k: number,
  ): readonly VectorHit[] {
    const owner = this.#resolve(ownerHandle);
    return this.#stmt<[Buffer, number, string], VectorHit>(
      `SELECT block_id, distance FROM block_vectors
        WHERE embedding MATCH ? AND k = ? AND paper_key = ?`,
    ).all(toVectorBlob(query), k, paperKey(owner, paperId, generation));
  }

  countBlockVectors(ownerHandle: OwnerId, paperId: PaperId, generation: Generation): number {
    const owner = this.#resolve(ownerHandle);
    return (
      this.#stmt<[string], { n: number }>(
        'SELECT count(*) AS n FROM block_vectors WHERE paper_key = ?',
      ).get(paperKey(owner, paperId, generation))?.n ?? 0
    );
  }

  // ── internals ─────────────────────────────────────────────────────────────────────

  /**
   * Turns an owner HANDLE into the `user_id` every statement binds — and refuses unless this
   * connection minted the handle.
   *
   * WHY A HANDLE AND NOT THE user_id ITSELF. `OwnerId` is a branded string, so `x as OwnerId`
   * is a legal (if conspicuous) TypeScript escape; the earlier design closed it with a set of
   * minted *user ids*, which meant the cast was rejected only for users this connection had
   * never authenticated. In the deployment this package is written for — one process, one
   * long-lived SQLite connection, many tenants — every logged-in user is in that set forever,
   * so `req.params.userId as OwnerId` was accepted and read and wrote another tenant's rows.
   * That is findings.md §F1 reintroduced through the one hole the design admitted to.
   *
   * The handle fixes it by construction: it is 32 bytes of CSPRNG output that appears nowhere
   * in the database, in a URL, in a log line or in an email. A caller cannot forge a value it
   * cannot guess, so gate 3 no longer depends on who has logged in.
   */
  #resolve(handle: OwnerId): OwnerId {
    const userId = this.#minted.get(handle);
    if (userId === undefined) {
      throw new OwnershipError(
        `that value was not minted by this connection. An OwnerId is an opaque handle ` +
          `returned by createUser() or authenticate(); casting a user id — or any other ` +
          `string — to OwnerId does not make it one.`,
      );
    }
    return userId as OwnerId;
  }

  #stmt<P extends unknown[] = unknown[], R = unknown>(sql: string): Statement<P, R> {
    const cached = this.#statements.get(sql);
    if (cached !== undefined) return cached as unknown as Statement<P, R>;
    const prepared = this.#db.prepare<P, R>(sql);
    this.#statements.set(sql, prepared as unknown as Statement<never, unknown>);
    return prepared;
  }
}

/** Opens a PaperTree database. `PaperTreeDb`'s constructor is private; this is the door. */
export function openDatabase(options: OpenOptions = {}): PaperTreeDb {
  return PaperTreeDb.open(options);
}

/**
 * The `block_vectors` partition name. Owner-first and not exported, so the only vector
 * partition any caller can name is one belonging to an authenticated owner.
 */
function paperKey(owner: OwnerId, paperId: PaperId, generation: Generation): string {
  return `${owner}/${paperId}@${generation}`;
}

/** Packs an embedding into the little-endian float32 blob sqlite-vec expects. */
export function toVectorBlob(values: Float32Array | readonly number[]): Buffer {
  const floats = values instanceof Float32Array ? values : Float32Array.from(values);
  if (floats.length !== VECTOR_DIMENSIONS) {
    throw new RangeError(
      `embedding must have ${VECTOR_DIMENSIONS} dimensions, got ${floats.length}`,
    );
  }
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

export type { PageId };
