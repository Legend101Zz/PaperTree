/**
 * document-ir/identity (F0.4) — the block-id formula, its normalisation, the tier-2
 * `content_hash`, and the single sanctioned reader of `Block.text`.
 *
 * THE SPECIFICATION IS **ADR-001 Amendment 1 § A** (2026-07-30, "stable block ID formula,
 * resolved by measurement"), and the normative machine-readable form of it is
 * `conformance/identity-vectors.json` — 427 vectors, 8 negative pairs, 11 equivalence pairs.
 * Where the ADR's prose and that file disagree, THE FILE WINS. `test/identity.spec.ts` and its
 * Python twin `python/tests/test_identity.py` both read that file, so neither language is the
 * oracle: the committed vectors are.
 *
 *     block_id = "blk_" + LOWER(BASE32(SHA-256(PAYLOAD)))[:16]
 *     PAYLOAD  = source_hash | page_index | q(x0) | q(y0) | block_type | normalise(text)[:8]
 *
 * WHAT THIS FILE DELIBERATELY NEVER CALLS, and why each one is a cross-language fork:
 *   • `String.prototype.toLowerCase()` / `.toUpperCase()` — the case fold comes ENTIRELY from
 *     the shipped `case_fold_map`, pinned to Unicode 15.0.0. Node 22 carries Unicode 17.0 and
 *     maps 55 code points the pinned table does not; a runtime fallback forks the id against
 *     Python and forks it again the day the runtime is upgraded (Amendment 1 § F defect 2).
 *   • `String.prototype.slice()` for truncation — that is UTF-16 code units; the contract is
 *     UNICODE CODE POINTS, and `"abcdefg😀".slice(0, 8)` ends in a lone surrogate.
 *   • `Math.round` — half-away-from-zero in JS, half-to-even in Python. `floor(v + 0.5)` has
 *     one definition in every language; this is the revision-1 bug that broke the epic's
 *     cross-language acceptance test.
 *   • `Number.prototype.toFixed` / any float formatting — `(-0).toFixed(4)` is `"0.0000"` in
 *     JS and `"-0.0000"` in Python. The payload carries integer bucket INDICES, never floats.
 *   • `\s` — JavaScript's, Python's and Rust's whitespace classes are three different sets.
 *     The set here is the enumerated 26 code points, built from NUMERIC code points (a
 *     literal-character table is what revision 3 shipped, and an editor had flattened all 16
 *     exotic spaces to U+0020 — Amendment 1 § F defect 1).
 *   • a trailing `.normalize("NFC")` to "tidy up" — `normalise()` output is NOT NFC by design
 *     (U+01F0 folds to `006A 030C`). Re-composing it is control C8's failure mode exactly.
 *
 * THE TABLES ARE EMBEDDED, NOT LOADED. `conformance/identity-vectors.json` is 396 KB of test
 * data and is not shipped inside the Python wheel, so a runtime dependency on it would work in
 * the repo and break when installed. They are embedded as ASCII hex code points instead — no
 * literal exotic character survives a copy-paste — and `identity.spec` asserts, in BOTH
 * languages, that every embedded entry is byte-identical to the shipped contract. Drift is a
 * test failure, not a silent id change.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * NODE-ONLY, AND THAT IS ENFORCED. `createHash` is imported at module scope below and webpack 5
 * does not resolve a `node:`-prefixed builtin, so importing this module into a browser bundle
 * fails to compile. `src/index.ts` therefore re-exports `./normalise.js` rather than this file
 * (issue #33), and this one is reachable only as `@papertree/document-ir/identity`.
 *
 * The PURE half — the pinned tables, `pinnedNfc`, `normaliseText`, `truncateCodePoints`,
 * `quantise` and `resolvedText` — moved to `./normalise.js` and is re-exported below, so every
 * existing `from './identity.js'` import still resolves. Only the two functions that actually
 * hash live here.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import { createHash } from 'node:crypto';

import type { AlgoPrefixedHash, BlockId } from './generated/types.js';
import {
  CONTENT_HASH_ALGORITHM,
  ID_BASE32_CHARS,
  MAX_QUANTISED_BUCKET,
  TEXT_PREFIX_CODEPOINTS,
  assertEncodable,
  normaliseText,
  quantise,
  truncateCodePoints,
} from './normalise.js';

// Re-exported so `from './identity.js'` keeps resolving every symbol it used to. The BARREL takes
// these from `./normalise.js` directly; this line is for direct importers of this module, which is
// what `test/identity.spec.ts`, `test/schema.spec.ts` and `test/validate.spec.ts` are.
export * from './normalise.js';

// ─── BLOCK ID ───────────────────────────────────────────────────────────────────────────────

/**
 * Everything the formula hashes. Only the TOP-LEFT ANCHOR is hashed: `x1`/`y1` are deliberately
 * absent, which is what makes a block that grows downward keep its id (§ E.4) — and is exactly
 * why a tier-1 hit MUST be confirmed against `content_hash` before it is trusted.
 */
export interface BlockIdInput {
  /**
   * Lowercase hex SHA-256 of the PDF bytes, 64 characters, WITHOUT the `"sha256:"` prefix the
   * IR stores. Passing the prefixed form is rejected rather than hashed: it would produce a
   * complete, plausible, wrong id space.
   */
  readonly source_hash: string;
  /** 0-based page ordinal. */
  readonly page_index: number;
  /**
   * Left edge, and `y0` the TOP edge, in PDF default user-space units (1/72 in), origin
   * top-left of the page's post-rotation rect, y growing DOWNWARD, `/Rotate` already applied,
   * relative to the page rect's own origin, `/UserUnit` NOT applied, and NOT pre-rounded.
   * Getting this frame wrong is the single highest-leverage error in the formula: the P9
   * origin-flip perturbation loses 99.93 % of ids.
   */
  readonly x0: number;
  readonly y0: number;
  /** The IR's block-type discriminator verbatim; `^[a-z][a-z0-9_]{0,63}$`, so it has no U+007C. */
  readonly block_type: string;
  /** The block's raw text. Normalised and truncated here; callers must not pre-normalise. */
  readonly text: string;
}

/**
 * The id together with every intermediate the conformance file records, so a failure localises
 * to the quantiser, the normaliser or the payload rather than vanishing into the digest.
 */
export interface BlockIdParts {
  readonly normalised_text: string;
  readonly text_prefix: string;
  readonly quantised_coords: readonly [number, number];
  readonly payload: string;
  readonly block_id: BlockId;
}

const SOURCE_HASH_PATTERN = /^[0-9a-f]{64}$/;
const BLOCK_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
// Lowercase directly rather than base32-then-toLowerCase: identical output, and this file does
// not call a runtime case function anywhere. RFC 4648 alphabet, "=" padding never emitted.
const BASE32_LOWER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array, chars: number): string {
  let buffer = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      bits -= 5;
      out += BASE32_LOWER_ALPHABET.charAt((buffer >>> bits) & 31);
    }
    if (out.length >= chars) return out;
  }
  if (bits > 0 && out.length < chars) {
    out += BASE32_LOWER_ALPHABET.charAt((buffer << (5 - bits)) & 31);
  }
  return out;
}

/** `blockId()` with its intermediates. See `BlockIdParts`. */
export function blockIdParts(input: BlockIdInput): BlockIdParts {
  if (!SOURCE_HASH_PATTERN.test(input.source_hash)) {
    throw new TypeError(
      `source_hash must be 64 lowercase hex characters WITHOUT the "sha256:" prefix the IR ` +
        `stores (strip it), got ${JSON.stringify(input.source_hash)}`,
    );
  }
  if (!Number.isInteger(input.page_index) || input.page_index < 0) {
    throw new RangeError(
      `page_index must be a non-negative integer, got ${String(input.page_index)}`,
    );
  }
  // The SAME guard the quantised bucket carries, for the SAME reason (Amendment 1 § F defect 3):
  // field 2 is emitted with String()/str() exactly like fields 3 and 4, and `String(1e21)` is
  // "1e+21" where Python's `str(10**21)` is "1000000000000000000000". `Number.isInteger(1e21)` is
  // true, so without this the payload forks silently instead of being rejected.
  if (input.page_index > MAX_QUANTISED_BUCKET) {
    throw new RangeError(
      `page_index ${String(input.page_index)} is outside 0..${String(MAX_QUANTISED_BUCKET)}: ` +
        `reject, never emit (String() gives exponential notation above 1e21 where Python's str() ` +
        `stays positional, which is two ids for one block)`,
    );
  }
  if (!BLOCK_TYPE_PATTERN.test(input.block_type)) {
    throw new TypeError(
      `block_type must match ${String(BLOCK_TYPE_PATTERN)} — the pattern is what guarantees it ` +
        `carries no U+007C, and the payload defines no escaping — got ` +
        `${JSON.stringify(input.block_type)}`,
    );
  }
  assertEncodable(input.text, 'text');

  const quantised: [number, number] = [quantise(input.x0), quantise(input.y0)];
  const normalised = normaliseText(input.text);
  const prefix = truncateCodePoints(normalised, TEXT_PREFIX_CODEPOINTS);
  // Only the last field may contain U+007C, and it is last, so the encoding is unambiguous.
  // No escaping is defined or permitted.
  const payload = [
    input.source_hash,
    String(input.page_index),
    String(quantised[0]),
    String(quantised[1]),
    input.block_type,
    prefix,
  ].join('|');
  const digest = createHash('sha256').update(payload, 'utf8').digest();
  return {
    normalised_text: normalised,
    text_prefix: prefix,
    quantised_coords: quantised,
    payload,
    block_id: `blk_${base32(digest, ID_BASE32_CHARS)}`,
  };
}

/**
 * The block id: ANCHORING TIER 1, and tier 1 only.
 *
 * Ids are mostly-stable, not perfectly stable, and the measurement says how far from perfect:
 * a paragraph-merge segmentation change retires 42.2 % of them (35.75 pp of that is a floor no
 * formula can beat), and of those that survive, 11.7 % land on a block whose text has changed.
 * `contentHash()` detects 100 % of the latter — measured, not assumed — which is why ADR-004's
 * multi-selector anchor is MANDATORY and why Epic 2's resolver must verify `content_hash` on
 * every tier-1 hit.
 */
export function blockId(input: BlockIdInput): BlockId {
  return blockIdParts(input).block_id;
}

// ─── CONTENT HASH — anchoring tier 2 ────────────────────────────────────────────────────────

/**
 * The tier-2 anchor: a digest over the FULL normalised text, algorithm-prefixed.
 *
 * ADR-001 § Identity specified this as `"blake2s:3f9a…"` with NO DIGEST LENGTH — the exact
 * defect Amendment 1 fixed for `block_id`, and the schema's `$defs/Block.content_hash` example
 * still carries it. Amendment 1 § "What Wave 1 must know" flags it; this function closes it,
 * because tier-2 resolution only works if TS and Python produce the same string:
 *
 *   • hash family: SHA-256 — the same as `block_id` (§ C.5: Node cannot emit blake2s-128 at all).
 *   • digest length: the FULL 32 bytes. Unlike `block_id`, nothing is truncated: this is the
 *     verification tier and it should be as strong as the digest is.
 *   • encoding: `"sha256:"` + 64 lowercase hex characters, which satisfies the schema's
 *     `$defs/Sha256Hash` (`^sha256:[0-9a-f]{64}$`) as well as the `$defs/AlgoPrefixedHash`
 *     (`^[a-z0-9]+:[0-9a-f]{16,128}$`) that `content_hash` is actually typed as. The algorithm
 *     prefix is mandatory so that changing the hash is a visible, migratable event.
 *   • input: `normaliseText(text)`, the SAME normalisation as `block_id` — never a second copy.
 *
 * Pass the block's RAW text.
 *
 * DO NOT pass an already-normalised string: `normaliseText` is NOT idempotent, and that is by
 * design, not an oversight. Amendment 1 § A says outright that its output is not guaranteed to be
 * NFC (U+01F0 folds to `006A 030C`), so a second pass re-composes what the first produced —
 * `normaliseText("ﬁ̂")` is `f i ◌̂` and normalising THAT gives `f î`. Anything that
 * needs the digest of a string already in normalised form must call `contentHashOfNormalised`;
 * semantic rule 29 does exactly that, which is what keeps it from failing a legitimate document.
 */
export function contentHash(text: string): AlgoPrefixedHash {
  return contentHashOfNormalised(normaliseText(text));
}

/**
 * `contentHash` for a string that has ALREADY been through `normaliseText` — `Block.text_normalised`,
 * in practice. Digests it as-is; does not normalise a second time.
 *
 * The distinction is load-bearing rather than stylistic. `normaliseText` is deliberately not
 * idempotent (see `contentHash`), so `contentHash(block.text_normalised)` and
 * `contentHash(block.text)` disagree on any text whose normalised form is not itself
 * normalisation-stable — a ligature or a full-fold expansion sitting immediately before a
 * combining mark, which is routine in extracted PDF text. `contentHashOfNormalised(text_normalised)`
 * and `contentHash(text)` agree on ALL of them, so tier-2 anchoring compares like with like.
 */
export function contentHashOfNormalised(normalised: string): AlgoPrefixedHash {
  assertEncodable(normalised, 'text');
  return `${CONTENT_HASH_ALGORITHM}:${createHash('sha256').update(normalised, 'utf8').digest('hex')}`;
}
