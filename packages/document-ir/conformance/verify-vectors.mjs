/**
 * Reference JavaScript implementation of the PaperTree block_id, written ONLY from the
 * `spec` / `ligature_table` / `whitespace_chars` / `case_fold_map` blocks inside
 * identity-vectors.json.  It imports nothing from the measurement harness and nothing
 * outside node:crypto and node:fs -- that is the entire point: it is the machine proof
 * that the written contract is reimplementable in a second language without reading the
 * first implementation.
 *
 * NOTE THE THINGS THIS FILE NEVER CALLS.  No String.prototype.toLowerCase (the case fold
 * comes entirely from case_fold_map -- Node 22 carries Unicode 17.0 and the map is pinned
 * to 15.0.0, so a runtime fallback would fork on 55 code points).  No String.prototype
 * .slice for truncation (that is UTF-16 code units; the contract is code points).  No
 * Math.round (half-away-from-zero vs Python's half-to-even).  No toFixed (negative zero).
 *
 *   node packages/document-ir/conformance/verify-vectors.mjs
 *   node packages/document-ir/conformance/verify-vectors.mjs <vectors.json> [extra-rows.json]
 *
 * Exit code 0 iff every vector, every negative pair and every equivalence pair holds.
 * This is a REFERENCE CHECK, not the test suite; Epic 0's identity.spec consumes the same
 * file from TypeScript and from Python.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, "identity-vectors.json");
const doc = JSON.parse(readFileSync(file, "utf8"));

const SPEC = doc.spec;
const LIG = doc.ligature_table;
const WS = new Set(
  doc.whitespace_chars.map((u) => String.fromCodePoint(parseInt(u.slice(2), 16))),
);
// The COMPLETE fold map, keyed by code point. A code point absent from it folds to
// ITSELF; there is deliberately no fallback to ch.toLowerCase().
const FOLD = new Map(
  Object.entries(doc.case_fold_map).map(([u, v]) => [parseInt(u.slice(2), 16), v]),
);
const Q_MAX = 9007199254740991;               // 2^53 - 1, per SPEC.quantise
const GRID = SPEC.grid_pt;
const NPFX = SPEC.text_prefix_codepoints;
const GEOM = SPEC.geometry_payload;

// ENCODE -- RFC 4648 base32, lowercased, first 16 characters
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

// NORMALISE -- NFC, ligatures, whitespace, full case folding (per code point, by table)
function foldChar(ch) {
  const m = FOLD.get(ch.codePointAt(0));
  return m === undefined ? ch : m;
}
function normalise(s) {
  s = s.normalize("NFC");
  let a = "";
  for (const ch of s) a += LIG[ch] !== undefined ? LIG[ch] : ch;
  let b = "", prevWs = false;
  for (const ch of a) {
    if (WS.has(ch)) { if (!prevWs) b += " "; prevWs = true; }
    else { b += ch; prevWs = false; }
  }
  while (b.startsWith(" ")) b = b.slice(1);
  while (b.endsWith(" ")) b = b.slice(0, -1);
  let f = "";
  for (const ch of b) f += foldChar(ch);
  return f;
}

// TRUNCATE -- code points, not UTF-16 code units
const truncate = (s, n) => Array.from(s).slice(0, n).join("");

// QUANTISE -- floor(v/g + 0.5), emitted as a base-10 integer
function q(v, g) {
  const r = Math.floor(v / g + 0.5);
  if (!(Math.abs(r) <= Q_MAX)) {
    throw new RangeError(`quantised bucket ${r} outside +/-${Q_MAX}: reject, never emit ` +
                         `(String() would give exponential notation above 1e21)`);
  }
  return Object.is(r, -0) ? 0 : r;      // Math.floor(-0.4 + 0.5) is -0 in JS
}
function coords(bbox) {
  if (GEOM === "full_bbox") return bbox;
  if (GEOM === "anchor_xy") return [bbox[0], bbox[1]];
  if (GEOM === "centre_xy") return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  throw new Error("unknown geometry_payload " + GEOM);
}

export function blockId({ source_hash, page_index, bbox, block_type, raw_text }) {
  const payload = [
    source_hash, String(page_index),
    ...coords(bbox).map((v) => String(q(v, GRID))),
    block_type, truncate(normalise(raw_text), NPFX),
  ].join("|");
  const digest = createHash("sha256").update(Buffer.from(payload, "utf8")).digest();
  return { payload, block_id: "blk_" + base32(digest).toLowerCase().slice(0, 16) };
}

const SHAPE = /^blk_[a-z2-7]{16}$/;
const fails = [];
const byLabel = new Map();
for (const v of doc.vectors) {
  const tn = normalise(v.raw_text);
  const qc = coords(v.bbox).map((c) => q(c, GRID));
  const { payload, block_id } = blockId(v);
  byLabel.set(v.label, block_id);
  if (JSON.stringify(qc) !== JSON.stringify(v.quantised_coords)) fails.push(["QUANT", v.label]);
  else if (tn !== v.normalised_text) fails.push(["NORM", v.label]);
  else if (payload !== v.payload) fails.push(["PAYLOAD", v.label]);
  else if (block_id !== v.block_id) fails.push(["ID", v.label]);
  else if (!SHAPE.test(block_id)) fails.push(["SHAPE", v.label]);
}
for (const p of doc.negative_vectors ?? []) {
  if (byLabel.get(p.a) === byLabel.get(p.b)) fails.push(["NEGATIVE", p.label]);
}
for (const p of doc.equivalence_vectors ?? []) {
  if (byLabel.get(p.a) !== byLabel.get(p.b)) fails.push(["EQUIVALENCE", p.label]);
}

let extra = 0;
if (process.argv[3]) {
  for (const r of JSON.parse(readFileSync(process.argv[3], "utf8"))) {
    extra++;
    if (blockId(r).block_id !== r.block_id) fails.push(["EXTRA", r.label ?? String(extra)]);
  }
}

console.log(JSON.stringify({
  node: process.version,
  node_unicode: process.versions.unicode,
  contract_unicode: doc.case_fold_unicode_version,
  fold_map_entries: FOLD.size,
  whitespace_chars: WS.size,
  formula_version: doc.formula_version,
  config: { geometry_payload: GEOM, grid_pt: GRID, text_prefix_codepoints: NPFX,
            hash: SPEC.hash },
  vectors: doc.vectors.length,
  negative_pairs: (doc.negative_vectors ?? []).length,
  equivalence_pairs: (doc.equivalence_vectors ?? []).length,
  extra_rows: extra,
  failures: fails.length,
  examples: fails.slice(0, 10),
}, null, 2));
process.exit(fails.length ? 1 : 0);
