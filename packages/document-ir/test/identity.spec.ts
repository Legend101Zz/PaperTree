/**
 * document-ir/identity.spec — the named EPIC-00 acceptance test for F0.4.
 *
 *   "Same input ⇒ same ID, 10k times. Different input ⇒ different ID.
 *    Cross-language: TS and Python produce identical IDs for the shared vector file."
 *
 * Both halves are asserted for real:
 *
 * (a) DETERMINISM is measured over the whole 427-vector contract, 24 rounds each (10 248 ids),
 *     not over 10 000 identical calls — a constant function passes that. The negative pairs
 *     assert that different input gives a different id, and the equivalence pairs assert that
 *     inputs which SHOULD collapse (whitespace, ligature, sub-bucket jitter, −0.0, text past the
 *     prefix, a block that grew downward) really do collapse to one id.
 *
 * (b) CROSS-LANGUAGE agreement is asserted against the COMMITTED FILE, never against the other
 *     language. `conformance/identity-vectors.json` carries the ids and the intermediates;
 *     `python/tests/test_identity.py` reads the same file and asserts the same things. Neither
 *     implementation is the oracle, so neither can drag the other along. The intermediates
 *     (`normalised_text`, `quantised_coords`, `payload`) are asserted too, because a bug that
 *     cancels out inside the digest is still a bug and the file records them precisely so it can
 *     be caught.
 *
 * Then the edge cases the cross-language proof (ADR-001 Amendment 1 §§ B, F) identified as real
 * hazards, each of which a future refactor WILL reintroduce if nothing guards it: code-point
 * truncation, the version-pinned fold table, NFC-before-fold, non-NFC output, the 2^53 range
 * guard and the enumerated whitespace set. Every one of those is a negative control in § B's
 * table of ten; here they are tests.
 *
 * Finally `resolvedText` (DESIGN.md D4), which is not part of the id formula but is the other
 * half of F0.4's contract: the single sanctioned reader of `Block.text`.
 *
 * EVERY NON-ASCII CHARACTER IN THIS FILE'S TEST DATA IS WRITTEN AS AN ESCAPE. That is not
 * fussiness: revision 3 of the contract shipped a corrupt whitespace table because an editor
 * flattened 16 exotic spaces held as literal characters in a source file (Amendment 1 § F defect
 * 1). A test whose expectations can be silently rewritten by a paste is not a test.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BLOCK_ID_FORMULA_VERSION,
  BLOCK_ID_PATTERN,
  CASE_FOLD_MAP,
  CASE_FOLD_UNICODE_VERSION,
  CONTENT_HASH_ALGORITHM,
  GRID_PT,
  LIGATURE_TABLE,
  MAX_QUANTISED_BUCKET,
  NFC_POST_PIN_DECOMPOSITIONS,
  TEXT_PREFIX_CODEPOINTS,
  WHITESPACE_CODE_POINTS,
  blockId,
  blockIdParts,
  contentHash,
  contentHashOfNormalised,
  normaliseText,
  quantise,
  resolvedText,
  truncateCodePoints,
} from '../src/identity.js';
import type { BlockIdInput, BlockLike, RepairLike } from '../src/identity.js';
import type { Block, Repair } from '../src/generated/types.js';

// ─── the normative contract ─────────────────────────────────────────────────────────────────

interface Vector {
  readonly label: string;
  readonly group: string;
  readonly source_hash: string;
  readonly page_index: number;
  readonly bbox: readonly [number, number, number, number];
  readonly block_type: string;
  readonly raw_text: string;
  readonly normalised_text: string;
  readonly quantised_coords: readonly number[];
  readonly payload: string;
  readonly block_id: string;
  readonly note?: string;
}

interface Pair {
  readonly label: string;
  readonly a: string;
  readonly b: string;
  readonly a_block_id: string;
  readonly b_block_id: string;
  readonly must: 'differ' | 'match';
  readonly why: string;
}

interface VectorFile {
  readonly formula_version: string;
  readonly spec: Record<string, unknown>;
  readonly ligature_table: Record<string, string>;
  readonly whitespace_chars: readonly string[];
  readonly case_fold_unicode_version: string;
  readonly case_fold_map: Record<string, string>;
  readonly vector_count: number;
  readonly vectors: readonly Vector[];
  readonly negative_vectors: readonly Pair[];
  readonly equivalence_vectors: readonly Pair[];
}

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = JSON.parse(
  readFileSync(join(PKG, 'conformance/identity-vectors.json'), 'utf8'),
) as VectorFile;

const VECTORS = CONTRACT.vectors;
const BY_LABEL = new Map(VECTORS.map((vector) => [vector.label, vector]));

const inputOf = (vector: Vector): BlockIdInput => ({
  source_hash: vector.source_hash,
  page_index: vector.page_index,
  x0: vector.bbox[0],
  y0: vector.bbox[1],
  block_type: vector.block_type,
  text: vector.raw_text,
});

const idOfLabel = (label: string): string => {
  const vector = BY_LABEL.get(label);
  if (vector === undefined) throw new Error(`vector ${label} is not in the contract file`);
  return blockId(inputOf(vector));
};

/** A stable, ordinary input to vary one field of at a time. */
const [FIRST_VECTOR] = VECTORS;
if (FIRST_VECTOR === undefined) throw new Error('the contract file carries no vectors');
const SAMPLE: BlockIdInput = inputOf(FIRST_VECTOR);

const cp = (value: number): string => String.fromCodePoint(value);

/**
 * The 55 code points that gained a case mapping AFTER Unicode 15.0.0 (§ F defect 2): U+1C89, the
 * eight U+A7Cx/U+A7Dx additions, Garay U+10D50–U+10D65 and Medefaidrin U+16EA0–U+16EB8. Node 22
 * carries Unicode 17.0 and maps every one of them; the pinned 15.0.0 table maps none.
 */
const POST_15_DRIFT: number[] = [0x1c89, 0xa7cb, 0xa7cc, 0xa7ce, 0xa7d2, 0xa7d4, 0xa7da, 0xa7dc];
for (let point = 0x10d50; point <= 0x10d65; point += 1) POST_15_DRIFT.push(point);
for (let point = 0x16ea0; point <= 0x16eb8; point += 1) POST_15_DRIFT.push(point);

// ─── the contract this implementation was built from ────────────────────────────────────────

describe('the shipped contract', () => {
  it('is revision 4: 427 vectors, 8 negative pairs, 11 equivalence pairs', () => {
    expect(CONTRACT.vector_count).toBe(427);
    expect(VECTORS).toHaveLength(427);
    expect(CONTRACT.negative_vectors).toHaveLength(8);
    expect(CONTRACT.equivalence_vectors).toHaveLength(11);
    expect(CONTRACT.formula_version).toBe(BLOCK_ID_FORMULA_VERSION);
  });

  it("agrees with this module's frozen configuration", () => {
    expect(CONTRACT.spec['hash']).toBe(CONTENT_HASH_ALGORITHM);
    expect(CONTRACT.spec['grid_pt']).toBe(GRID_PT);
    expect(CONTRACT.spec['text_prefix_codepoints']).toBe(TEXT_PREFIX_CODEPOINTS);
    expect(CONTRACT.spec['geometry_payload']).toBe('anchor_xy');
    expect(CONTRACT.spec['id_shape']).toBe(BLOCK_ID_PATTERN.source);
    expect(CONTRACT.case_fold_unicode_version).toBe(CASE_FOLD_UNICODE_VERSION);
  });

  it('the EMBEDDED tables are identical to the shipped ones, entry by entry', () => {
    // The tables live in src/identity.ts rather than being read from this 396 KB test file at
    // runtime (the Python wheel does not ship it). That is only safe if drift is a test failure.
    const shippedFold = new Map(
      Object.entries(CONTRACT.case_fold_map).map(
        ([key, value]) => [Number.parseInt(key.slice(2), 16), value] as const,
      ),
    );
    expect(shippedFold.size).toBe(1530);
    expect(CASE_FOLD_MAP.size).toBe(shippedFold.size);
    for (const [point, folded] of shippedFold) expect(CASE_FOLD_MAP.get(point)).toBe(folded);
    for (const [point, folded] of CASE_FOLD_MAP) expect(shippedFold.get(point)).toBe(folded);

    const shippedWhitespace = CONTRACT.whitespace_chars.map((u) => Number.parseInt(u.slice(2), 16));
    // 26 DISTINCT code points: revision 3 shipped 16 duplicated "U+0020" entries (§ F defect 1).
    expect(new Set(shippedWhitespace).size).toBe(26);
    expect([...WHITESPACE_CODE_POINTS].toSorted((a, b) => a - b)).toEqual(
      [...new Set(shippedWhitespace)].toSorted((a, b) => a - b),
    );

    const shippedLigatures = new Map(
      Object.entries(CONTRACT.ligature_table).map(
        ([key, value]) => [key.codePointAt(0) ?? -1, value] as const,
      ),
    );
    expect(LIGATURE_TABLE.size).toBe(shippedLigatures.size);
    for (const [point, expansion] of shippedLigatures) {
      expect(LIGATURE_TABLE.get(point)).toBe(expansion);
    }
  });
});

// ─── (a) same input ⇒ same ID, 10k times ────────────────────────────────────────────────────

describe('(a) same input => same ID', () => {
  it('427 vectors x 24 rounds = 10 248 ids, every one deterministic and equal to the record', () => {
    const ROUNDS = 24;
    const first = new Map<string, string>();
    let computed = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      // Walk the vectors in a different order every round, so determinism cannot come from a
      // warm cache or from evaluation order.
      const order = round % 2 === 0 ? VECTORS : VECTORS.toReversed();
      for (const vector of order) {
        const id = blockId(inputOf(vector));
        computed += 1;
        const seen = first.get(vector.label);
        if (seen === undefined) first.set(vector.label, id);
        else expect(id).toBe(seen);
        expect(id).toBe(vector.block_id);
      }
    }
    expect(computed).toBe(VECTORS.length * ROUNDS);
    expect(computed).toBeGreaterThanOrEqual(10_000);
    expect(first.size).toBe(427);
    console.log(
      `[identity.spec] determinism: ${String(computed)} ids over ${String(VECTORS.length)} ` +
        `distinct inputs x ${String(ROUNDS)} rounds, 0 mismatches`,
    );
  });

  it('different input => different id (all 8 negative pairs)', () => {
    for (const pair of CONTRACT.negative_vectors) {
      const a = idOfLabel(pair.a);
      const b = idOfLabel(pair.b);
      expect(a, pair.why).not.toBe(b);
      // …and each side is the id the contract recorded, so "they differ" cannot be satisfied by
      // two equally wrong ids.
      expect(a).toBe(pair.a_block_id);
      expect(b).toBe(pair.b_block_id);
    }
    expect(CONTRACT.negative_vectors).toHaveLength(8);
  });

  it('inputs that should collapse do collapse (all 11 equivalence pairs)', () => {
    for (const pair of CONTRACT.equivalence_vectors) {
      const a = idOfLabel(pair.a);
      const b = idOfLabel(pair.b);
      expect(a, pair.why).toBe(b);
      expect(a).toBe(pair.a_block_id);
      expect(b).toBe(pair.b_block_id);
    }
    expect(CONTRACT.equivalence_vectors).toHaveLength(11);
  });
});

// ─── (b) TS and Python produce identical IDs for the shared vector file ─────────────────────

describe('(b) TS and Python agree, because both agree with the committed file', () => {
  it('reproduces all 427 recorded block_ids', () => {
    const mismatches = VECTORS.filter((v) => blockId(inputOf(v)) !== v.block_id).map(
      (v) => v.label,
    );
    expect(mismatches).toEqual([]);
  });

  it('reproduces the recorded INTERMEDIATES too, not just the digest', () => {
    // A bug that cancels out in the hash is still a bug. The file records the quantised
    // coordinates, the normalised text and the exact payload precisely so it can be localised.
    const quantFailures: string[] = [];
    const normFailures: string[] = [];
    const payloadFailures: string[] = [];
    for (const vector of VECTORS) {
      const parts = blockIdParts(inputOf(vector));
      if ([...parts.quantised_coords].join(',') !== [...vector.quantised_coords].join(',')) {
        quantFailures.push(vector.label);
      }
      if (parts.normalised_text !== vector.normalised_text) normFailures.push(vector.label);
      if (parts.payload !== vector.payload) payloadFailures.push(vector.label);
    }
    expect(quantFailures).toEqual([]);
    expect(normFailures).toEqual([]);
    expect(payloadFailures).toEqual([]);
  });

  it("every id satisfies the IR schema's ^blk_[a-z2-7]{16}$", () => {
    // Revision 2's 217 vectors were UPPERCASE base32 and 0 of them validated against the schema
    // they were written for; the formula moved, not the schema.
    for (const vector of VECTORS) {
      const id = blockId(inputOf(vector));
      expect(id).toMatch(BLOCK_ID_PATTERN);
      expect(id).toHaveLength(20);
    }
  });

  it('pins content_hash across the two languages', () => {
    // content_hash is NOT in the vector file — ADR-001 left it as "blake2s:3f9a…" with no digest
    // length, the very defect Amendment 1 fixed for block_id and flagged for this. So the
    // cross-language pin is asserted here instead: the SHA-256 of all 427 content hashes, joined
    // by "\n" in vector order, is the same constant in this suite and in
    // python/tests/test_identity.py. If the two implementations ever disagree by one character,
    // this fails in both.
    const aggregate = createHash('sha256')
      .update(VECTORS.map((vector) => contentHash(vector.raw_text)).join('\n'), 'utf8')
      .digest('hex');
    expect(aggregate).toBe('6ccde4b3bda72069733972a45f137a576fc225b67afb216940e180a7a86cd85b');
  });

  it("content_hash is the schema's hash shape and shares block_id's normalisation", () => {
    const SHA256_HASH = /^sha256:[0-9a-f]{64}$/; // $defs/Sha256Hash
    const ALGO_PREFIXED = /^[a-z0-9]+:[0-9a-f]{16,128}$/; // $defs/AlgoPrefixedHash, content_hash's type
    for (const vector of VECTORS) {
      const digest = contentHash(vector.raw_text);
      expect(digest).toMatch(SHA256_HASH);
      expect(digest).toMatch(ALGO_PREFIXED);
      // the FULL normalised text, not the 8-code-point prefix the id uses
      expect(digest).toBe(
        `${CONTENT_HASH_ALGORITHM}:${createHash('sha256')
          .update(normaliseText(vector.raw_text), 'utf8')
          .digest('hex')}`,
      );
    }
    // Tier 2's whole job: same text ⇒ same hash, changed text ⇒ changed hash. This is what
    // detects the 11.7 % of merge survivors that inherit an id onto changed content (§ E.4).
    expect(contentHash('Residual   learning')).toBe(contentHash('residual learning'));
    expect(contentHash('residual learning')).not.toBe(contentHash('residual learnings'));
    // Unlike block_id, nothing is truncated: text differing past the 8-code-point prefix, which
    // block_id CANNOT see by design, is visible here.
    expect(blockId({ ...SAMPLE, text: 'abcdefghXXXX' })).toBe(
      blockId({ ...SAMPLE, text: 'abcdefghYYYY' }),
    );
    expect(contentHash('abcdefghXXXX')).not.toBe(contentHash('abcdefghYYYY'));
  });

  it('normaliseText is idempotent, so hashing text_normalised gives the same answer (rule 29)', () => {
    for (const vector of VECTORS) {
      expect(normaliseText(vector.normalised_text)).toBe(vector.normalised_text);
      expect(contentHash(vector.raw_text)).toBe(contentHash(vector.normalised_text));
    }
  });
});

// ─── the edge cases the cross-language proof called out ─────────────────────────────────────

describe('edge case: truncation is by CODE POINT', () => {
  it('does not split an astral character into a lone surrogate', () => {
    const text = 'abcdefg\u{1F600}tail';
    const prefix = truncateCodePoints(normaliseText(text), TEXT_PREFIX_CODEPOINTS);
    expect([...prefix]).toHaveLength(8);
    expect(prefix).toBe('abcdefg\u{1F600}');
    expect(prefix.codePointAt(7)).toBe(0x1f600);

    // The UTF-16 mistake (control C1): `.slice(0, 8)` keeps only the HIGH surrogate.
    const utf16Wrong = normaliseText(text).slice(0, TEXT_PREFIX_CODEPOINTS);
    expect(utf16Wrong).not.toBe(prefix);
    const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(LONE_SURROGATE.test(utf16Wrong)).toBe(true);
    expect(LONE_SURROGATE.test(prefix)).toBe(false);
    expect(blockIdParts({ ...SAMPLE, text }).text_prefix).toBe(prefix);
  });

  it('counts an astral character as ONE, not as four bytes', () => {
    // Byte truncation (control C2, the Rust hazard, and 266 divergences on the real corpus)
    // would cut this at 8 UTF-8 bytes, i.e. two emoji.
    const text =
      '\u{1F600}\u{1F601}\u{1F602}\u{1F603}\u{1F604}\u{1F605}\u{1F606}\u{1F607}\u{1F608}';
    const prefix = truncateCodePoints(normaliseText(text), TEXT_PREFIX_CODEPOINTS);
    expect([...prefix]).toHaveLength(8);
    expect(Buffer.from(prefix, 'utf8')).toHaveLength(32);
  });

  it('rejects an unpaired surrogate rather than hashing U+FFFD', () => {
    // Node substitutes U+FFFD on encode where Python raises: one input, two ids.
    expect(() => blockId({ ...SAMPLE, text: 'ab\uD83Dcd' })).toThrow(TypeError);
    expect(() => contentHash('ab\uDC00')).toThrow(TypeError);
  });
});

describe('edge case: the case fold comes from the SHIPPED TABLE, never the runtime', () => {
  it('folds where toLowerCase() would not: U+1E9E and the final sigma', () => {
    // These fail on EVERY runtime and every Unicode version if an implementation reaches for
    // String.prototype.toLowerCase (controls C3 and C4), so they are never vacuous.
    expect(normaliseText('\u1e9e')).toBe('ss'); // capital sharp s folds to "ss"…
    expect('\u1e9e'.toLowerCase()).toBe('\u00df'); // …while toLowerCase gives U+00DF
    expect(normaliseText('\u00df')).toBe('ss');

    expect(normaliseText('\u0391\u03a3')).toBe('\u03b1\u03c3');
    // JS's context-sensitive final-sigma rule gives U+03C2 here. Per-code-point folding cannot
    // see neighbours, which is exactly why the contract mandates it.
    expect('\u0391\u03a3'.toLowerCase()).toBe('\u03b1\u03c2');
  });

  it('ignores the 55 code points that gained a mapping after Unicode 15.0.0', () => {
    expect(POST_15_DRIFT).toHaveLength(55);
    for (const point of POST_15_DRIFT) {
      expect(CASE_FOLD_MAP.has(point), `U+${point.toString(16)} is not in a 15.0.0 table`).toBe(
        false,
      );
      expect(normaliseText(cp(point))).toBe(cp(point));
    }
    // Evidence that this is a LIVE fork and not a hypothetical one: on Node 22 (Unicode 17.0)
    // the runtime maps every one of them, so a `toLowerCase` fallback "for the remainder"
    // (control C11, 55/55) would fork all 55 against Python 3.12. If Node is ever pinned below
    // Unicode 16 this count drops, and the assertions above still hold.
    const runtimeMapped = POST_15_DRIFT.filter((point) => cp(point).toLowerCase() !== cp(point));
    console.log(
      `[identity.spec] Node ${process.version} carries Unicode ` +
        `${String(process.versions.unicode)}; ${String(runtimeMapped.length)}/55 post-15.0.0 code ` +
        `points are mapped by the runtime and 0 by the pinned table`,
    );
  });

  it("never CALLS a runtime case function: the contract's MUST NOT, enforced", () => {
    // The strongest form of this assertion is structural. A behavioural test can only catch a
    // runtime primitive where the runtime and the pinned table happen to disagree TODAY; the
    // Python twin has no such point at all while its interpreter carries UCD 15.0.0. So both
    // suites also read their implementation and check that the forbidden calls are absent.
    const source = readFileSync(join(PKG, 'src/identity.ts'), 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replaceAll(/^[^\n]*?\/\/[^\n]*$/gm, ''); // line comments
    for (const forbidden of [
      'toLowerCase',
      'toUpperCase',
      'localeCompare',
      'Math.round',
      'toFixed',
      'toPrecision',
      '\\s',
    ]) {
      expect(source, `identity.ts must never use ${forbidden}`).not.toContain(forbidden);
    }
    // …and it must still contain the things that replace them.
    expect(source).toContain('Math.floor');
    expect(source).toContain('CASE_FOLD_MAP.get');
  });

  it('wins over the runtime on EVERY code point where the two disagree', () => {
    // The exhaustive sweep, as a test: 1 112 064 code points, pinned table vs the runtime.
    // Wherever they differ, normaliseText must follow the table.
    const disagreements: number[] = [];
    for (let point = 0; point <= 0x10ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue; // surrogates are not encodable text
      const char = cp(point);
      if (char.toLowerCase() !== (CASE_FOLD_MAP.get(point) ?? char)) disagreements.push(point);
    }
    expect(disagreements.length).toBeGreaterThan(0);
    for (const point of disagreements) {
      expect(normaliseText(cp(point))).toBe(CASE_FOLD_MAP.get(point) ?? cp(point));
    }
    console.log(
      `[identity.spec] table vs toLowerCase: ${String(disagreements.length)} disagreeing code ` +
        `points, and the table wins on all of them`,
    );
  }, 60_000);
});

describe('edge case: NFC comes BEFORE the fold, and the output is not re-composed', () => {
  it('composes first, so a decomposed input and its composed twin get one id', () => {
    // NFC("J" + U+030C) is U+01F0, whose fold is "j" + U+030C.
    expect(normaliseText('J\u030c')).toBe('j\u030c');
    expect(normaliseText('J\u030c')).toBe(normaliseText('\u01f0'));
    expect(blockId({ ...SAMPLE, text: 'J\u030c' })).toBe(blockId({ ...SAMPLE, text: '\u01f0' }));
  });

  it("differs from fold-then-NFC, which is control C8's failure mode", () => {
    // U+00DF + U+0323 (sharp s, combining dot below).
    //   NFC first, then fold  ⇒ "s" "s" U+0323   (this contract)
    //   fold first, then NFC  ⇒ "s" U+1E63      (wrong, and it is a DIFFERENT id)
    expect(normaliseText('\u00df\u0323')).toBe('ss\u0323');
    expect(normaliseText('\u00df\u0323')).not.toBe('s\u1e63');
    expect(blockId({ ...SAMPLE, text: '\u00df\u0323' })).not.toBe(
      blockId({ ...SAMPLE, text: 's\u1e63' }),
    );
  });

  it("does NOT guarantee NFC output \u2014 never 'tidy up' with a trailing normalize('NFC')", () => {
    const folded = normaliseText('\u01f0');
    expect([...folded].map((c) => c.codePointAt(0))).toEqual([0x6a, 0x030c]);
    expect(folded.normalize('NFC')).toBe('\u01f0');
    expect(folded).not.toBe(folded.normalize('NFC'));
    expect(blockIdParts({ ...SAMPLE, text: '\u01f0' }).text_prefix).toBe('j\u030c');
  });
});

describe('step 1 (NFC) is version-pinned too, not inherited from the runtime', () => {
  /**
   * The runtime's NFC was the last unpinned step in the formula, and it forks the id exactly the
   * way the runtime case functions do. Node 22 carries Unicode 17.0 and composes 20 sequences that
   * Python 3.12's UCD 15.0.0 does not, all from the Unicode 16.0 scripts (Todhri, Tulu-Tigalari,
   * Gurung Khema, Kirat Rai). `NFC_POST_PIN_DECOMPOSITIONS` undoes exactly those.
   */
  it('undoes every composition newer than the pinned Unicode version', () => {
    expect(NFC_POST_PIN_DECOMPOSITIONS.size).toBe(20);
    // The witness: without the pin, Node returns U+113C5 here and Python returns the input.
    expect('\u{113c2}\u{113c2}'.normalize('NFC')).toBe(
      String.fromCodePoint(0x113c2, 0x113c2).normalize('NFC'),
    );
    for (const [point, decomposition] of NFC_POST_PIN_DECOMPOSITIONS) {
      // Each entry really is that code point's full canonical decomposition in THIS runtime…
      expect(String.fromCodePoint(point).normalize('NFD')).toBe(decomposition);
      // …and normalise() never lets the composed form out, from either direction.
      expect(normaliseText(String.fromCodePoint(point))).toBe(decomposition);
      expect(normaliseText(decomposition)).toBe(decomposition);
    }
  });

  it("leaves the runtime's canonical-decomposition table identical to Python's, entry by entry", () => {
    // THE TRIPWIRE. The pinned list above is only correct while it is exactly the difference
    // between the two runtimes. This digest is over every canonical decomposition the runtime
    // knows MINUS the pinned ones, and `test_identity.py` asserts the same constant on Python
    // 3.12 / UCD 15.0.0. The day either runtime gains a 21st composition, this fails — instead of
    // block_ids, content_hashes and text_normaliseds silently forking between the two languages.
    const lines: string[] = [];
    for (let point = 0; point < 0x110000; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      if (NFC_POST_PIN_DECOMPOSITIONS.has(point)) continue;
      const decomposed = [...String.fromCodePoint(point).normalize('NFD')];
      if (decomposed.length < 2) continue;
      lines.push(
        `${point.toString(16)}:${decomposed.map((c) => (c.codePointAt(0) ?? 0).toString(16)).join(',')}`,
      );
    }
    expect(lines).toHaveLength(12_216);
    const digest = createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
    expect(digest).toBe('1e66edb5461d417bd118d65e245348ac95d6005f4582cb15a1393336dd6e69fa');
    console.log(
      `[identity.spec] canonical decompositions: ${String(lines.length)} after pinning ` +
        `${String(NFC_POST_PIN_DECOMPOSITIONS.size)} post-${CASE_FOLD_UNICODE_VERSION} ` +
        `compositions; digest matches the Python twin`,
    );
  }, 60_000);
});

describe('normaliseText is NOT idempotent, and contentHash must not pretend it is', () => {
  /**
   * `normalise()` output is deliberately not NFC (Amendment 1 § A), so a second pass re-composes
   * what the first produced. Any rule that normalises `Block.text_normalised` therefore digests a
   * DIFFERENT string from `contentHash(Block.text)` — which is the library's own documented way of
   * producing `content_hash`. Semantic rule 29 calls `contentHashOfNormalised` for this reason.
   */
  it('re-normalising a normalised string changes it', () => {
    const once = normaliseText('\ufb01\u0302');
    expect([...once].map((c) => c.codePointAt(0))).toEqual([0x66, 0x69, 0x302]);
    expect(normaliseText(once)).not.toBe(once);
    expect([...normaliseText(once)].map((c) => c.codePointAt(0))).toEqual([0x66, 0xee]);
  });

  it('contentHash(text) equals contentHashOfNormalised(normaliseText(text)) — always', () => {
    for (const text of ['\ufb01\u0302', '\u00df\u0323', '\u0132\u0301', 'plain ascii', '']) {
      expect(contentHash(text)).toBe(contentHashOfNormalised(normaliseText(text)));
    }
    // …and the trap it replaces: digesting the normalised form THROUGH contentHash disagrees.
    expect(contentHash(normaliseText('\ufb01\u0302'))).not.toBe(contentHash('\ufb01\u0302'));
  });
});

describe('edge case: the |q| <= 2^53-1 range guard REJECTS rather than emitting 1e+21', () => {
  it('throws instead of producing exponential notation', () => {
    expect(() => quantise(1e21)).toThrow(RangeError);
    expect(() => quantise(-1e21)).toThrow(RangeError);
    expect(() => quantise(1e22)).toThrow(RangeError);
    expect(() => quantise(Number.NaN)).toThrow(RangeError);
    expect(() => quantise(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    // 2^53 − 1 is one bucket too far once 0.5 is added; 2^53 − 2 lands exactly on the guard.
    expect(() => quantise(MAX_QUANTISED_BUCKET)).toThrow(RangeError);
    expect(quantise(MAX_QUANTISED_BUCKET - 1)).toBe(MAX_QUANTISED_BUCKET - 1);
    expect(() => blockId({ ...SAMPLE, x0: 1e21 })).toThrow(RangeError);
    // Field 2 is emitted with String() exactly like fields 3 and 4, and `Number.isInteger(1e21)`
    // is true — so it needs the same guard or the payload forks silently against Python's str().
    expect(() => blockId({ ...SAMPLE, page_index: 1e21 })).toThrow(RangeError);
    expect(() => blockId({ ...SAMPLE, page_index: MAX_QUANTISED_BUCKET + 1 })).toThrow(RangeError);
    expect(
      String(blockIdParts({ ...SAMPLE, page_index: MAX_QUANTISED_BUCKET }).payload),
    ).not.toMatch(/e\+/i);
    // The point of the guard: String() can never fork, because nothing above it is ever emitted.
    for (const value of [0, -0, 1, -1, 32767, -32767, 1e15, MAX_QUANTISED_BUCKET - 1]) {
      expect(String(quantise(value))).not.toMatch(/e/i);
    }
  });

  it('quantises half-buckets UP on both signs, with no negative zero', () => {
    expect(quantise(22.5)).toBe(23); // half-to-even (Python round()) would give 22
    expect(quantise(-22.5)).toBe(-22); // half-away-from-zero (Math.round) would give −23
    expect(quantise(-0.5)).toBe(0);
    expect(quantise(0.5)).toBe(1);
    expect(quantise(90.0, 4.0)).toBe(23); // the § B regression witness, at the refuted 4 pt grid
    expect(String(quantise(-0))).toBe('0');
    expect(String(quantise(-0.4))).toBe('0'); // Math.floor(-0.4 + 0.5) is -0 in JS
    expect(quantise(10.499999999999998)).toBe(10);
    expect(quantise(10.500000000000002)).toBe(11);
    expect(quantise(0.30000000000000004)).toBe(0);
  });
});

describe('edge case: the whitespace set is the enumerated 26 code points, not \\s', () => {
  it("collapses U+0085, which JavaScript's \\s does not match", () => {
    expect(/\s/u.test('\u0085')).toBe(false); // ← a JS-\s implementation would keep it
    expect(WHITESPACE_CODE_POINTS.has(0x0085)).toBe(true);
    expect(normaliseText('a\u0085b')).toBe('a b');
  });

  it("collapses U+FEFF, which Python's \\s does not match", () => {
    expect(WHITESPACE_CODE_POINTS.has(0xfeff)).toBe(true);
    expect(normaliseText('a\ufeffb')).toBe('a b');
  });

  it("does NOT collapse U+001C..U+001F, which Python's \\s DOES match", () => {
    for (const point of [0x1c, 0x1d, 0x1e, 0x1f]) {
      expect(WHITESPACE_CODE_POINTS.has(point)).toBe(false);
      expect(normaliseText(`a${cp(point)}b`)).toBe(`a${cp(point)}b`);
    }
  });

  it('collapses all 16 exotic spaces \u2014 the \u00a7 F defect-1 class', () => {
    const exotic = [
      0x1680,
      ...Array.from({ length: 11 }, (_, index) => 0x2000 + index),
      0x2028,
      0x2029,
      0x202f,
      0x205f,
    ];
    expect(exotic).toHaveLength(16);
    for (const point of exotic) {
      expect(WHITESPACE_CODE_POINTS.has(point)).toBe(true);
      expect(normaliseText(`a${cp(point)}b`)).toBe('a b');
    }
    // A run of many different spaces collapses to exactly one U+0020, and the ends are stripped.
    const run = exotic.map(cp).join('');
    expect(normaliseText(`${run}a${run}b${run}`)).toBe('a b');
  });

  it('collapses each of the 26 and nothing that merely looks like a space', () => {
    for (const point of WHITESPACE_CODE_POINTS) expect(normaliseText(`a${cp(point)}b`)).toBe('a b');
    for (const point of [0x00b7, 0x180e, 0x200b, 0x2060]) {
      // U+200B ZERO WIDTH SPACE and U+2060 WORD JOINER are not in the set and must survive.
      expect(normaliseText(`a${cp(point)}b`)).toBe(`a${cp(point)}b`);
    }
  });
});

describe('edge case: the payload encoding admits no escaping', () => {
  it('keeps U+007C confined to the last field', () => {
    const parts = blockIdParts({ ...SAMPLE, block_type: 'paragraph', text: 'b|c' });
    const fields = parts.payload.split('|');
    expect(fields.slice(0, 5)).toEqual([
      SAMPLE.source_hash,
      String(SAMPLE.page_index),
      String(parts.quantised_coords[0]),
      String(parts.quantised_coords[1]),
      'paragraph',
    ]);
    expect(fields.slice(5).join('|')).toBe('b|c');
    // block_type is the field BEFORE text, and its pattern is what makes the encoding
    // unambiguous: "paragraph" + "b|c" must not collide with "paragraph_b" + "c".
    expect(blockId({ ...SAMPLE, block_type: 'paragraph', text: 'b|c' })).not.toBe(
      blockId({ ...SAMPLE, block_type: 'paragraph_b', text: 'c' }),
    );
    expect(() => blockId({ ...SAMPLE, block_type: 'para|graph' })).toThrow(TypeError);
    expect(() => blockId({ ...SAMPLE, block_type: 'Paragraph' })).toThrow(TypeError);
  });

  it('rejects a source_hash that still carries the IR\'s "sha256:" prefix', () => {
    expect(() => blockId({ ...SAMPLE, source_hash: `sha256:${SAMPLE.source_hash}` })).toThrow(
      TypeError,
    );
    expect(() => blockId({ ...SAMPLE, source_hash: SAMPLE.source_hash.toUpperCase() })).toThrow(
      TypeError,
    );
    expect(() => blockId({ ...SAMPLE, page_index: -1 })).toThrow(RangeError);
    expect(() => blockId({ ...SAMPLE, page_index: 1.5 })).toThrow(RangeError);
  });
});

// ─── resolvedText — DESIGN.md D4 ────────────────────────────────────────────────────────────

const PROMPT_HASH = `sha256:${'0'.repeat(64)}`;

const proposedOcr: Repair = {
  kind: 'ocr_correction',
  applied: false,
  at: 3,
  from: 'm',
  to: 'rn',
  model_id: 'vision/ocr-1',
  prompt_hash: PROMPT_HASH,
};

describe('resolvedText \u2014 the single sanctioned reader of Block.text (D4)', () => {
  it('returns Block.text VERBATIM by default, and says what it did not apply', () => {
    const block: BlockLike = { text: 'leaming', repairs: [proposedOcr] };
    const view = resolvedText(block);
    expect(view.text).toBe('leaming');
    expect(view.containsProposedText).toBe(false);
    expect(view.appliedProposals).toEqual([]);
    expect(view.skippedProposals).toEqual([
      { index: 0, kind: 'ocr_correction', reason: 'not_requested' },
    ]);
  });

  it('applies proposals only when asked, and is honest about which', () => {
    const block: BlockLike = { text: 'leaming', repairs: [proposedOcr] };
    const view = resolvedText(block, { applyProposed: true });
    expect(view.text).toBe('learning'); // the OCR "rn" -> "m" confusion, undone on request
    expect(view.containsProposedText).toBe(true);
    expect(view.appliedProposals).toEqual([
      { index: 0, kind: 'ocr_correction', at: 3, from: 'm', to: 'rn' },
    ]);
    expect(view.skippedProposals).toEqual([]);
  });

  it('leaves APPLIED repairs alone \u2014 they are already in Block.text', () => {
    // What applied:true means. Re-applying would double the edit.
    const repairs: RepairLike[] = [
      { kind: 'dehyphenate', applied: true, at: 0, from: 'resid-\nual', to: 'residual' },
    ];
    const block: BlockLike = { text: 'residual', repairs };
    expect(resolvedText(block).text).toBe('residual');
    expect(resolvedText(block, { applyProposed: true })).toEqual({
      text: 'residual',
      appliedProposals: [],
      skippedProposals: [],
      containsProposedText: false,
    });
  });

  it('applies several proposals right-to-left so the offsets stay valid', () => {
    const repairs: RepairLike[] = [
      { kind: 'vlm_substitution', applied: false, at: 0, from: 'aaa', to: 'AAAA' },
      { kind: 'vlm_substitution', applied: false, at: 8, from: 'ccc', to: 'C' },
    ];
    const view = resolvedText({ text: 'aaa bbb ccc', repairs }, { applyProposed: true });
    expect(view.text).toBe('AAAA bbb C');
    expect(view.appliedProposals.map((proposal) => proposal.index)).toEqual([0, 1]);
  });

  it('SKIPS with a reason rather than corrupting text it cannot verify', () => {
    const repairs: RepairLike[] = [
      { kind: 'ocr_correction', applied: false, at: 2, from: 'zz', to: '!' },
      { kind: 'reorder', applied: false, from: 'a b', to: 'b a' },
      { kind: 'vlm_substitution', applied: false, at: 5, from: 'fgh', to: 'X' },
    ];
    const view = resolvedText({ text: 'abcdef', repairs }, { applyProposed: true });
    expect(view.text).toBe('abcdef');
    expect(view.containsProposedText).toBe(false);
    expect(view.skippedProposals).toEqual([
      { index: 0, kind: 'ocr_correction', reason: 'text_mismatch' },
      { index: 1, kind: 'reorder', reason: 'missing_offset' },
      { index: 2, kind: 'vlm_substitution', reason: 'offset_out_of_range' },
    ]);
  });

  it('skips the second of two overlapping proposals rather than guessing', () => {
    const repairs: RepairLike[] = [
      { kind: 'vlm_substitution', applied: false, at: 1, from: 'bcd', to: 'X' },
      { kind: 'vlm_substitution', applied: false, at: 2, from: 'cde', to: 'Y' },
    ];
    const view = resolvedText({ text: 'abcdef', repairs }, { applyProposed: true });
    expect(view.appliedProposals.map((proposal) => proposal.index)).toEqual([1]);
    expect(view.skippedProposals).toEqual([
      { index: 0, kind: 'vlm_substitution', reason: 'conflicting_range' },
    ]);
    expect(view.text).toBe('abYf');
  });

  it('counts offsets in CODE POINTS, so an astral character is one position', () => {
    // Semantic rule 25 defines offsets in code points; Python's len() agrees and JS's .length
    // does not. A UTF-16 implementation lands one position late here and reports a mismatch.
    const repairs: RepairLike[] = [
      { kind: 'vlm_substitution', applied: false, at: 1, from: 'xy', to: 'ZZ' },
    ];
    const view = resolvedText({ text: '\u{1F600}xy', repairs }, { applyProposed: true });
    expect(view.text).toBe('\u{1F600}ZZ');
    expect(view.skippedProposals).toEqual([]);
  });

  it('handles a block with no text at all', () => {
    const view = resolvedText({ repairs: [proposedOcr] }, { applyProposed: true });
    expect(view.text).toBe('');
    expect(view.skippedProposals).toEqual([
      { index: 0, kind: 'ocr_correction', reason: 'no_text' },
    ]);
    expect(resolvedText({}).text).toBe('');
  });

  it('accepts a real generated Block \u2014 the structural types are not a parallel schema', () => {
    const block: Block = {
      block_id: 'blk_aaaaaaaaaaaaaaaa',
      type: 'paragraph',
      page_index: 0,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      bbox: [0, 0, 10, 10],
      flow: 'body',
      order: 0,
      source: 'pdf_text_layer',
      confidence: 1,
      provenance: { parser: 'pymupdf', stage: 'layout+text' },
      text: 'leaming',
      repairs: [proposedOcr],
    };
    expect(resolvedText(block).text).toBe('leaming');
    expect(resolvedText(block, { applyProposed: true }).containsProposedText).toBe(true);
  });
});
