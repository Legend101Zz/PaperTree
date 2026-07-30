/**
 * document-ir/validate — the SEMANTIC VALIDATOR: the invariants JSON Schema cannot express.
 *
 * DESIGN.md §5.2 is the specification. Every rule below carries its §5.2 number in `RuleInfo.design`
 * and the rule list is exported as `SEMANTIC_RULES`, so "which rules exist" is data rather than
 * folklore. `python/papertree_document_ir/validate.py` is the twin; both are graded against
 * `conformance/validator-cases.json`, and neither is the other's oracle.
 *
 * PRECONDITION: the input is already SCHEMA-VALID (ajv against `schema/paperir-1.0.0.schema.json`,
 * or `PaperSchema.parse` / `Paper.model_validate`). This module checks the layer *above* that and
 * deliberately does not re-check field shapes — with two exceptions that exist because a caller may
 * skip the schema: rule G5 (finite coordinates) and the defensive `resolves?` guards, which turn a
 * dangling id into a diagnostic instead of a crash.
 *
 * WHAT IS AND IS NOT PART OF THE CROSS-LANGUAGE CONTRACT.
 *   · IN:  the ordered list of `(rule, severity, path)` triples. Both languages emit them in the
 *          same order — rules run in `SEMANTIC_RULES` order, each iterating in document order.
 *   · OUT: `message`. It is human-facing and interpolates numbers, and `String(1.0)` is `"1"` in JS
 *          while `str(1.0)` is `"1.0"` in Python. Pinning message bytes across the two runtimes
 *          would buy nothing and would fail for reasons that have nothing to do with the rule.
 *
 * SEVERITY. Everything is ERROR except the two places DESIGN.md §5.2 says otherwise: rule 3
 * (polygon outside crop_box) is a WARN until G7's 5 %-of-page threshold promotes it, and the
 * self-intersecting-ring half of G6 is a WARN because a bowtie is a parser bug rather than a
 * data-integrity failure.
 *
 * NOT IMPLEMENTED HERE, deliberately — see the module's report and DESIGN.md §5.2:
 *   · rule 32b  Tier B, owned by Epic 1 (the grid→HTML serialiser lives there).
 *   · rule 34   Tier B, owned by Epic 3 (cross-document; Epic 0 has no second store to check).
 *   · rule 33   deleted by DESIGN.md D20.
 */

import {
  isKnownHeadingBlockType,
  type BBox,
  type Page,
  type Paper,
  type Polygon,
  type Reference,
  type Section,
} from './generated/types.js';
import {
  BBOX_EXTENT_EPSILON_PT,
  bboxMatchesPolygonExtent,
  polygonArea,
  polygonExtent,
  polygonIsSimple,
} from './geometry.js';
import {
  LIGATURE_TABLE,
  WHITESPACE_CODE_POINTS,
  blockId as recomputeBlockId,
  contentHashOfNormalised as computeContentHash,
  normaliseText,
} from './identity.js';

// ─── PUBLIC SHAPES ──────────────────────────────────────────────────────────────────────────

/** WARN is "a parser bug worth reporting"; ERROR is "this document is not internally consistent". */
export type Severity = 'error' | 'warning';

export interface Diagnostic {
  /** The rule id, e.g. `"R14"`, `"G7"`, `"I1"`. See `SEMANTIC_RULES` for the §5.2 mapping. */
  readonly rule: string;
  readonly severity: Severity;
  /**
   * Where in the document, in dotted/bracketed form: `blocks[3].bbox`, `pages[0].flows.body[1]`,
   * `references[2].doi`. Part of the cross-language contract — both twins emit the same string.
   */
  readonly path: string;
  /** Human-facing. Deliberately NOT part of the cross-language contract; see the module doc. */
  readonly message: string;
}

export interface ValidationReport {
  /** True when there is no diagnostic of severity `"error"`. Warnings do not fail a document. */
  readonly ok: boolean;
  /** Every diagnostic, in rule order and then document order. */
  readonly diagnostics: readonly Diagnostic[];
  readonly errors: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
}

export interface ValidateOptions {
  /**
   * Rule ids to skip. The one rule anybody legitimately disables is `"I1"` — a fixture written by
   * hand carries invented block ids and cannot satisfy it. Disabling anything else is a decision
   * that should be written down next to the call.
   */
  readonly disabledRules?: readonly string[];
  /** Tolerance for rule 1 (bbox == polygon extent) and G4. Defaults to `BBOX_EXTENT_EPSILON_PT`. */
  readonly bboxEpsilonPt?: number;
  /** Tolerance for rule 3 / G7 containment. Defaults to `BBOX_EXTENT_EPSILON_PT`. */
  readonly cropBoxTolerancePt?: number;
  /** G7's promotion threshold as a fraction of a page's blocks. Defaults to 0.05. */
  readonly outOfCropBoxErrorFraction?: number;
  /** G8's minimum union coverage as a fraction of page area. Defaults to 0.01. */
  readonly minPageCoverageFraction?: number;
}

export interface RuleInfo {
  readonly id: string;
  /** The DESIGN.md §5.2 rule number this implements. */
  readonly design: string;
  readonly title: string;
  /** The severity the rule emits, or its worst when it emits more than one. */
  readonly severity: Severity;
  readonly tier: 'A';
}

export class SemanticValidationError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(diagnostics: readonly Diagnostic[]) {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    super(
      `PaperIR failed semantic validation: ${String(errors.length)} error(s), ` +
        `first is ${errors[0]?.rule ?? '?'} at ${errors[0]?.path ?? '?'} — ` +
        `${errors[0]?.message ?? ''}`,
    );
    this.name = 'SemanticValidationError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Every rule this module implements, in the order it runs — which is also the order diagnostics
 * come out in. Exported so a caller can enumerate coverage rather than trust a comment.
 */
export const SEMANTIC_RULES: readonly RuleInfo[] = [
  {
    id: 'G5',
    design: 'G5',
    title: 'every polygon/bbox coordinate is finite',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R2',
    design: '2',
    title: 'every bbox satisfies x0 <= x1 and y0 <= y1',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R1',
    design: '1',
    title: 'block.bbox equals the extent of block.polygon',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'G6',
    design: 'G6',
    title: 'block polygon has positive area (error) and a simple ring (warn)',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R3',
    design: '3',
    title: 'block polygon lies within the page crop_box',
    severity: 'warning',
    tier: 'A',
  },
  {
    id: 'G7',
    design: 'G7',
    title: "rule 3 promoted to error past 5% of a page's blocks",
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'G4',
    design: 'G4',
    title: 'page.width/height match crop_box, and crop_box starts at (0,0)',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'G8',
    design: 'G8',
    title: 'block bboxes cover >= 1% of the page area',
    // WARNING, not ERROR (DESIGN.md §5.2 G8): low coverage means the page is SUSPICIOUS, not that
    // the document is wrong. A page carrying one running header covers 0.25 % of US Letter and is
    // perfectly valid. Suspicion belongs in page.confidence / weakest_pages / needs_review.
    severity: 'warning',
    tier: 'A',
  },
  {
    id: 'R8',
    design: '8',
    title: 'block ids, page ids and page indices are unique',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R40',
    design: '40',
    title: 'page indices are contiguous 0..n-1; pages exist when blocks do',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R41',
    design: '41',
    title: 'status and partial_reason agree',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R13',
    design: '13',
    title: 'confidence.by_page has one entry per page; weakest_pages resolve',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R13b',
    design: '13b',
    title: 'a complete paper has no null confidences',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R10',
    design: '10',
    title: 'page.block_ids is exactly the blocks claiming that page',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R11',
    design: '11',
    title: "page.flows partition the page's top-level blocks by flow",
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R42',
    design: '42',
    title: 'no nested block appears in any page.flows[f]',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R12',
    design: '12',
    title: 'each page.flows[f] is in ascending block.order',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R14',
    design: '14',
    title: 'order is dense and unique within (page_index, flow, container)',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R15',
    design: '15',
    title: 'doc_order is on exactly the top-level body blocks, dense and unique',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R16',
    design: '16',
    title: 'doc_order does not run backwards through (page_index, order)',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R4',
    design: '4',
    title: 'every relation endpoint resolves to a block',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R5',
    design: '5',
    title: 'parent_id, prev_id, next_id and child_ids[] resolve',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R6',
    design: '6',
    title: 'metadata source_block_id and abstract.block_ids[] resolve',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R6b',
    design: '6b',
    title: "a metadata value is a substring of its source block's text",
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R7',
    design: '7',
    title: 'every other block-id-bearing field resolves',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R9',
    design: '9',
    title: 'relations are unique on (type, from, to)',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R17',
    design: '17',
    title: 'parent_id and child_ids are mutually consistent',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R18',
    design: '18',
    title: 'prev_id/next_id are mutual and link siblings only',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R19',
    design: '19',
    title: 'parent_of and next_in_reading_order agree with the fields',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R20',
    design: '20',
    title: 'the parent graph and the sibling chain are acyclic',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R21',
    design: '21',
    title: 'section.level and heading_block_id are consistent',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R38',
    design: '38',
    title: 'section.block_ids excludes its heading, duplicates and nested blocks',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R22',
    design: '22',
    title: 'caption_of and payload.caption_block are typed correctly',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R23',
    design: '23',
    title: 'cites.to points at a reference_entry block',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R24',
    design: '24',
    title: 'continues_on_next_page crosses pages in ascending order',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R24b',
    design: '24b',
    title: 'continues_in_next_column stays on the page with disjoint x-extents',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R25',
    design: '25',
    title: 'span offsets lie within the stored text',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R26',
    design: '26',
    title: 'spans do not overlap and ascend by start',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R27',
    design: '27',
    title: 'repair.at addresses the text the repair claims',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R28',
    design: '28',
    title: "text_normalised is the library's normalisation of text",
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R29',
    design: '29',
    title: "content_hash is the library's digest of text_normalised",
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R30',
    design: '30',
    title: 'model-authored repairs carry model_id and prompt_hash',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R30b',
    design: '30b',
    title: 'a deterministic repair is reproducibly an edit of its own class',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R31',
    design: '31',
    title: 'at most one selected alternative, and it matches block.text',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R32',
    design: '32',
    title: 'table grid cells agree with their table_cell blocks',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R35',
    design: '35',
    title: "every Reference scalar appears in its entry block's text",
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R36',
    design: '36',
    title: 'a complete paper has rendered crops on equations and figures',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R37',
    design: '37',
    title: 'pdf_text_layer text carries text_normalised and content_hash',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'R39',
    design: '39',
    title: 'an inline_equation payload has display == false',
    severity: 'error',
    tier: 'A',
  },
  {
    id: 'I1',
    design: '(added)',
    title: 'block_id equals identity.blockId() recomputed from the block',
    severity: 'error',
    tier: 'A',
  },
];

const RULE_SEVERITY = new Map(SEMANTIC_RULES.map((r) => [r.id, r.severity]));

// ─── INTERNAL SHAPES ────────────────────────────────────────────────────────────────────────

/**
 * The block as this module reads it. `Block` is a discriminated union whose payload members are
 * interfaces, and TypeScript will not give an interface an implicit index signature, so a single
 * `as unknown as` at the boundary is cheaper and more honest than four narrowing branches per rule.
 */
interface AnyBlock {
  readonly block_id: string;
  readonly type: string;
  readonly page_index: number;
  readonly polygon: Polygon;
  readonly bbox: BBox;
  readonly flow: string;
  readonly order: number;
  readonly doc_order?: number;
  readonly parent_id?: string;
  readonly child_ids?: readonly string[];
  readonly prev_id?: string;
  readonly next_id?: string;
  readonly text?: string;
  readonly text_normalised?: string;
  readonly content_hash?: string;
  readonly spans?: readonly AnySpan[];
  readonly source: string;
  readonly repairs?: readonly AnyRepair[];
  readonly alternatives?: readonly AnyAlternative[];
  readonly payload?: Readonly<Record<string, unknown>>;
}
interface AnySpan {
  readonly start: number;
  readonly end: number;
  readonly bbox: BBox;
  readonly role?: string;
  readonly block_id?: string;
}
interface AnyRepair {
  readonly kind: string;
  readonly applied: boolean;
  readonly at?: number;
  readonly from: string;
  readonly to: string;
  readonly model_id?: string;
  readonly prompt_hash?: string;
}
interface AnyAlternative {
  readonly decision: string;
  readonly text?: string;
}

const FLOW_KEYS = ['body', 'caption', 'footnote', 'header', 'footer', 'margin'] as const;
const MODEL_REPAIR_KINDS = new Set(['ocr_correction', 'vlm_substitution']);
const DETERMINISTIC_REPAIR_KINDS = new Set([
  'dehyphenate',
  'ligature',
  'unicode_normalise',
  'whitespace',
  'reorder',
]);
/** DESIGN.md rule 22: what `caption_of.to` may point at. */
const FLOAT_BLOCK_TYPES = new Set(['figure', 'table', 'diagram', 'plot']);
/** DESIGN.md rule 36 / D16: the types whose payload carries a required-and-nullable `image`. */
const CROPPED_BLOCK_TYPES = new Set(['equation', 'inline_equation', 'figure']);

interface Ctx {
  readonly paper: Paper;
  readonly blocks: readonly AnyBlock[];
  readonly pages: readonly Page[];
  readonly byId: Map<string, AnyBlock>;
  /** Index of the FIRST block carrying each id, so a duplicate id (rule 8) still localises. */
  readonly indexById: Map<string, number>;
  readonly pageByIndex: Map<number, Page>;
  readonly blocksOnPage: Map<number, AnyBlock[]>;
  readonly out: Diagnostic[];
  readonly disabled: Set<string>;
  readonly bboxEpsilon: number;
  readonly cropTolerance: number;
  readonly outOfBoxFraction: number;
  readonly minCoverage: number;
}

// ─── SMALL SHARED HELPERS ───────────────────────────────────────────────────────────────────

function codePoints(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) out.push(ch.codePointAt(0) as number);
  return out;
}

function fromCodePoints(points: readonly number[]): string {
  let out = '';
  for (const p of points) out += String.fromCodePoint(p);
  return out;
}

/** Length in UNICODE CODE POINTS. `.length` counts UTF-16 units and would mis-size any astral text. */
function codePointLength(text: string): number {
  return codePoints(text).length;
}

/** `text[start:end]` in CODE POINTS, matching Python slicing. */
function sliceCodePoints(text: string, start: number, end: number): string {
  return fromCodePoints(codePoints(text).slice(start, end));
}

function fmt(value: number): string {
  if (value === 0) return '0';
  return Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(0) : String(value);
}

function quote(value: string): string {
  return JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value);
}

/**
 * Collapse every maximal run of `WHITESPACE_CODE_POINTS` to one U+0020 and strip both ends —
 * step 3 of the identity normalisation, ALONE. Rule 30b's `whitespace` class is defined in terms
 * of whitespace collapse only, so it must not also case-fold; the table is imported rather than
 * re-enumerated so the two cannot drift.
 */
function collapseWhitespace(text: string): string {
  const out: number[] = [];
  let inRun = false;
  for (const point of codePoints(text)) {
    if (WHITESPACE_CODE_POINTS.has(point)) {
      if (!inRun) out.push(0x20);
      inRun = true;
    } else {
      out.push(point);
      inRun = false;
    }
  }
  let start = 0;
  let end = out.length;
  while (start < end && out[start] === 0x20) start += 1;
  while (end > start && out[end - 1] === 0x20) end -= 1;
  return fromCodePoints(out.slice(start, end));
}

/** Step 2 of the identity normalisation, ALONE — rule 30b's `ligature` class. Case is preserved. */
function expandLigatures(text: string): string {
  let out = '';
  for (const ch of text) {
    const expansion = LIGATURE_TABLE.get(ch.codePointAt(0) as number);
    out += expansion === undefined ? ch : expansion;
  }
  return out;
}

const HYPHENS = new Set([0x002d, 0x00ad, 0x2010]);
const LINE_BREAKS = new Set([0x000a, 0x000d, 0x2028, 0x2029]);
const INLINE_SPACES = new Set([0x0020, 0x0009]);

/**
 * The canonical dehyphenation transform for rule 30b: delete every `hyphen · spaces? · line break ·
 * spaces?` run, and delete every remaining SOFT hyphen (U+00AD is invisible by definition, so its
 * removal is the same class of edit even without a break).
 *
 * Written as one total function rather than "does `to` look plausibly dehyphenated", because 30b's
 * whole point is that a deterministic repair must be REPRODUCIBLE: `dehyphenate(from) === to` or it
 * is not a dehyphenation.
 */
function dehyphenate(text: string): string {
  const points = codePoints(text);
  const out: number[] = [];
  let i = 0;
  while (i < points.length) {
    const point = points[i] as number;
    if (HYPHENS.has(point)) {
      let j = i + 1;
      while (j < points.length && INLINE_SPACES.has(points[j] as number)) j += 1;
      if (j < points.length && LINE_BREAKS.has(points[j] as number)) {
        while (j < points.length && LINE_BREAKS.has(points[j] as number)) j += 1;
        while (j < points.length && INLINE_SPACES.has(points[j] as number)) j += 1;
        i = j;
        continue;
      }
      if (point === 0x00ad) {
        i += 1;
        continue;
      }
    }
    out.push(point);
    i += 1;
  }
  return fromCodePoints(out);
}

/**
 * Whitespace-separated tokens as a MULTISET (token → count). A multiset rather than a sorted list
 * because JS sorts strings by UTF-16 code unit and Python by code point, and the two orders differ
 * above U+FFFF — map equality has no ordering in it at all.
 */
function tokenMultiset(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  let current: number[] = [];
  const flush = (): void => {
    if (current.length > 0) {
      const token = fromCodePoints(current);
      counts.set(token, (counts.get(token) ?? 0) + 1);
      current = [];
    }
  };
  for (const point of codePoints(text)) {
    if (WHITESPACE_CODE_POINTS.has(point)) flush();
    else current.push(point);
  }
  flush();
  return counts;
}

function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, count] of a) if (b.get(key) !== count) return false;
  return true;
}

/** Exact union area of axis-aligned rectangles, by coordinate compression over x. */
function rectUnionArea(rects: readonly BBox[]): number {
  if (rects.length === 0) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].toSorted((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const left = xs[i] as number;
    const right = xs[i + 1] as number;
    const width = right - left;
    if (width <= 0) continue;
    const intervals: Array<[number, number]> = [];
    for (const r of rects) {
      if (r[0] <= left && r[2] >= right && r[3] > r[1]) intervals.push([r[1], r[3]]);
    }
    if (intervals.length === 0) continue;
    const ordered = intervals.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
    let covered = 0;
    let cursorStart = (ordered[0] as [number, number])[0];
    let cursorEnd = (ordered[0] as [number, number])[1];
    for (let k = 1; k < ordered.length; k += 1) {
      const [s, e] = ordered[k] as [number, number];
      if (s > cursorEnd) {
        covered += cursorEnd - cursorStart;
        cursorStart = s;
        cursorEnd = e;
      } else if (e > cursorEnd) {
        cursorEnd = e;
      }
    }
    covered += cursorEnd - cursorStart;
    total += covered * width;
  }
  return total;
}

function allFinite(values: readonly number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

// ─── CONTEXT ────────────────────────────────────────────────────────────────────────────────

function emit(ctx: Ctx, rule: string, path: string, message: string, severity?: Severity): void {
  if (ctx.disabled.has(rule)) return;
  ctx.out.push({
    rule,
    severity: severity ?? RULE_SEVERITY.get(rule) ?? 'error',
    path,
    message,
  });
}

/** A block whose `parent_id` names a NON-heading block is NESTED (DESIGN.md §3.2 / D14). */
function isNested(ctx: Ctx, block: AnyBlock): boolean {
  if (block.parent_id === undefined) return false;
  const parent = ctx.byId.get(block.parent_id);
  // An UNRESOLVED parent nests by default — the same safe direction §3.2 chose for an unknown
  // parent TYPE. Splicing the children of a container we cannot see into the body stream is the
  // damaging error; rule 5 reports the dangling id separately.
  if (parent === undefined) return true;
  return !isKnownHeadingBlockType(parent.type);
}

function blockPath(ctx: Ctx, id: string): string {
  const index = ctx.indexById.get(id);
  return index === undefined ? `blocks[?${id}]` : `blocks[${String(index)}]`;
}

// ─── GEOMETRY RULES ─────────────────────────────────────────────────────────────────────────

function ruleG5(ctx: Ctx): void {
  ctx.pages.forEach((page, p) => {
    for (const key of ['crop_box', 'media_box'] as const) {
      if (!allFinite(page[key])) {
        emit(ctx, 'G5', `pages[${String(p)}].${key}`, `${key} contains a non-finite coordinate`);
      }
    }
  });
  ctx.blocks.forEach((block, b) => {
    if (!allFinite(block.bbox)) {
      emit(ctx, 'G5', `blocks[${String(b)}].bbox`, 'bbox contains a non-finite coordinate');
    }
    block.polygon.forEach((vertex, v) => {
      if (!allFinite(vertex)) {
        emit(
          ctx,
          'G5',
          `blocks[${String(b)}].polygon[${String(v)}]`,
          'polygon vertex is not finite',
        );
      }
    });
    (block.spans ?? []).forEach((span, s) => {
      if (!allFinite(span.bbox)) {
        emit(
          ctx,
          'G5',
          `blocks[${String(b)}].spans[${String(s)}].bbox`,
          'span bbox contains a non-finite coordinate',
        );
      }
    });
  });
}

function checkBoxOrder(ctx: Ctx, box: BBox, path: string): void {
  if (!allFinite(box)) return; // G5 already said so; a NaN comparison here would say nothing.
  if (box[0] > box[2] || box[1] > box[3]) {
    emit(
      ctx,
      'R2',
      path,
      `bbox must satisfy x0 <= x1 and y0 <= y1, got [${box.map(fmt).join(', ')}]`,
    );
  }
}

function ruleR2(ctx: Ctx): void {
  ctx.pages.forEach((page, p) => {
    checkBoxOrder(ctx, page.crop_box, `pages[${String(p)}].crop_box`);
    checkBoxOrder(ctx, page.media_box, `pages[${String(p)}].media_box`);
  });
  ctx.blocks.forEach((block, b) => {
    checkBoxOrder(ctx, block.bbox, `blocks[${String(b)}].bbox`);
    (block.spans ?? []).forEach((span, s) => {
      checkBoxOrder(ctx, span.bbox, `blocks[${String(b)}].spans[${String(s)}].bbox`);
    });
  });
}

function ruleR1(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    if (!allFinite(block.bbox) || block.polygon.some((v) => !allFinite(v))) return;
    if (block.polygon.length === 0) return;
    // polygonExtent() is the CANONICAL implementation (geometry.ts). A second extent loop here is
    // exactly the drift this rule exists to catch, so the rule calls the producer's own function.
    if (!bboxMatchesPolygonExtent(block.bbox, block.polygon, ctx.bboxEpsilon)) {
      const extent = polygonExtent(block.polygon);
      emit(
        ctx,
        'R1',
        `blocks[${String(b)}].bbox`,
        `bbox [${block.bbox.map(fmt).join(', ')}] is not the polygon extent ` +
          `[${extent.map(fmt).join(', ')}] (epsilon ${String(ctx.bboxEpsilon)})`,
      );
    }
  });
}

function ruleG6(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    if (block.polygon.some((v) => !allFinite(v))) return;
    const area = polygonArea(block.polygon);
    if (!(area > 0)) {
      emit(
        ctx,
        'G6',
        `blocks[${String(b)}].polygon`,
        `polygon must have strictly positive area, got ${fmt(area)}`,
        'error',
      );
      return; // A degenerate ring is not meaningfully "simple"; one diagnostic is enough.
    }
    if (!polygonIsSimple(block.polygon)) {
      emit(
        ctx,
        'G6',
        `blocks[${String(b)}].polygon`,
        'polygon ring is self-intersecting (a bowtie): a parser bug, not a data-integrity failure',
        'warning',
      );
    }
  });
}

/** Rules 3 and G7 together: the individual diagnostic IS the promoted one past the threshold. */
function ruleR3AndG7(ctx: Ctx): void {
  for (const [pageIndex, blocks] of ctx.blocksOnPage) {
    const page = ctx.pageByIndex.get(pageIndex);
    if (page === undefined || !allFinite(page.crop_box)) continue;
    const [cx0, cy0, cx1, cy1] = page.crop_box;
    const tol = ctx.cropTolerance;
    const outside: AnyBlock[] = [];
    for (const block of blocks) {
      if (block.polygon.some((v) => !allFinite(v))) continue;
      const escapes = block.polygon.some(
        (v) =>
          (v[0] as number) < cx0 - tol ||
          (v[0] as number) > cx1 + tol ||
          (v[1] as number) < cy0 - tol ||
          (v[1] as number) > cy1 + tol,
      );
      if (escapes) outside.push(block);
    }
    if (outside.length === 0) continue;
    const promoted = blocks.length > 0 && outside.length / blocks.length > ctx.outOfBoxFraction;
    for (const block of outside) {
      const detail =
        `polygon leaves the page crop_box [${page.crop_box.map(fmt).join(', ')}]` +
        (promoted
          ? ` — and ${String(outside.length)}/${String(blocks.length)} blocks on page ` +
            `${String(pageIndex)} do, which is a systematic coordinate-space error rather than ` +
            `parser jitter (G7)`
          : '');
      emit(
        ctx,
        promoted ? 'G7' : 'R3',
        `${blockPath(ctx, block.block_id)}.polygon`,
        detail,
        promoted ? 'error' : 'warning',
      );
    }
  }
}

function ruleG4(ctx: Ctx): void {
  ctx.pages.forEach((page, p) => {
    const path = `pages[${String(p)}]`;
    if (!allFinite(page.crop_box)) return;
    const [x0, y0, x1, y1] = page.crop_box;
    const eps = ctx.bboxEpsilon;
    if (Math.abs(x0) > eps || Math.abs(y0) > eps) {
      emit(
        ctx,
        'G4',
        `${path}.crop_box`,
        `crop_box must start at (0, 0) — geometry is CropBox-relative (D23) — got ` +
          `[${page.crop_box.map(fmt).join(', ')}]`,
      );
    }
    if (Math.abs(page.width - (x1 - x0)) > eps) {
      emit(
        ctx,
        'G4',
        `${path}.width`,
        `page.width ${fmt(page.width)} != crop_box[2] - crop_box[0] = ${fmt(x1 - x0)}`,
      );
    }
    if (Math.abs(page.height - (y1 - y0)) > eps) {
      emit(
        ctx,
        'G4',
        `${path}.height`,
        `page.height ${fmt(page.height)} != crop_box[3] - crop_box[1] = ${fmt(y1 - y0)}`,
      );
    }
  });
}

function ruleG8(ctx: Ctx): void {
  ctx.pages.forEach((page, p) => {
    const blocks = ctx.blocksOnPage.get(page.index) ?? [];
    // A page with no blocks carries no coordinate evidence at all. Failing a legitimately blank
    // page would make the rule unusable on real documents, which is not what G8 is for.
    if (blocks.length === 0) return;
    const pageArea = page.width * page.height;
    if (!(pageArea > 0)) return; // the schema bounds these > 0; G4 owns the disagreement.
    const threshold = pageArea * ctx.minCoverage;
    const rects = blocks
      .map((b) => b.bbox)
      .filter((b) => allFinite(b) && b[2] > b[0] && b[3] > b[1]);
    // Fast path: a single bbox already over the threshold makes the union over it too. On a real
    // page one paragraph clears 1 % on its own, so the O(n^2) sweep below almost never runs.
    const largest = rects.reduce((best, r) => Math.max(best, (r[2] - r[0]) * (r[3] - r[1])), 0);
    if (largest >= threshold) return;
    const union = rectUnionArea(rects);
    if (union < threshold) {
      emit(
        ctx,
        'G8',
        `pages[${String(p)}]`,
        `block bboxes cover ${fmt(union)} pt² of a ${fmt(pageArea)} pt² page ` +
          `(${(100 * (pageArea > 0 ? union / pageArea : 0)).toFixed(4)} %), below the ` +
          `${(100 * ctx.minCoverage).toFixed(2)} % floor — either the parser missed content on ` +
          `this page, or geometry is stored as normalised [0,1] fractions; review the page`,
      );
    }
  });
}

// ─── DOCUMENT-LEVEL RULES ───────────────────────────────────────────────────────────────────

function ruleR8(ctx: Ctx): void {
  const seenBlock = new Set<string>();
  ctx.blocks.forEach((block, b) => {
    if (seenBlock.has(block.block_id)) {
      emit(
        ctx,
        'R8',
        `blocks[${String(b)}].block_id`,
        `duplicate block_id ${quote(block.block_id)}`,
      );
    }
    seenBlock.add(block.block_id);
  });
  const seenPageId = new Set<string>();
  const seenPageIndex = new Set<number>();
  ctx.pages.forEach((page, p) => {
    if (seenPageId.has(page.page_id)) {
      emit(ctx, 'R8', `pages[${String(p)}].page_id`, `duplicate page_id ${quote(page.page_id)}`);
    }
    seenPageId.add(page.page_id);
    if (seenPageIndex.has(page.index)) {
      emit(ctx, 'R8', `pages[${String(p)}].index`, `duplicate page index ${fmt(page.index)}`);
    }
    seenPageIndex.add(page.index);
  });
}

function ruleR40(ctx: Ctx): void {
  if (ctx.pages.length === 0) {
    if (ctx.blocks.length > 0) {
      emit(ctx, 'R40', 'pages', `pages is empty but ${String(ctx.blocks.length)} block(s) exist`);
    }
    return;
  }
  const indices = ctx.pages.map((p) => p.index).toSorted((a, b) => a - b);
  indices.forEach((index, i) => {
    if (index !== i) {
      emit(
        ctx,
        'R40',
        'pages',
        `page indices must be contiguous 0..n-1; sorted position ${String(i)} holds ` +
          `${fmt(index)}`,
      );
    }
  });
}

function ruleR41(ctx: Ctx): void {
  const { status, partial_reason: reason } = ctx.paper;
  if (status === 'failed' && reason === null) {
    emit(ctx, 'R41', 'partial_reason', 'status "failed" requires a non-null partial_reason');
  }
  if (status === 'complete' && reason !== null) {
    emit(ctx, 'R41', 'partial_reason', 'status "complete" requires partial_reason to be null');
  }
}

function ruleR13(ctx: Ctx): void {
  const conf = ctx.paper.confidence;
  if (conf.by_page.length !== ctx.pages.length) {
    emit(
      ctx,
      'R13',
      'confidence.by_page',
      `by_page has ${String(conf.by_page.length)} entries for ${String(ctx.pages.length)} pages`,
    );
  }
  conf.weakest_pages.forEach((index, i) => {
    if (!ctx.pageByIndex.has(index)) {
      emit(
        ctx,
        'R13',
        `confidence.weakest_pages[${String(i)}]`,
        `${fmt(index)} is not a page index in this document`,
      );
    }
  });
}

function ruleR13b(ctx: Ctx): void {
  if (ctx.paper.status !== 'complete') return;
  const conf = ctx.paper.confidence;
  if (conf.overall === null) {
    emit(
      ctx,
      'R13b',
      'confidence.overall',
      'a "complete" paper must have a calibrated overall confidence',
    );
  }
  conf.by_page.forEach((value, i) => {
    if (value === null) {
      emit(
        ctx,
        'R13b',
        `confidence.by_page[${String(i)}]`,
        'a "complete" paper must have a calibrated confidence for every page',
      );
    }
  });
}

// ─── PAGE / FLOW RULES ──────────────────────────────────────────────────────────────────────

function ruleR10(ctx: Ctx): void {
  ctx.pages.forEach((page, p) => {
    const claimed = new Set((ctx.blocksOnPage.get(page.index) ?? []).map((b) => b.block_id));
    const listed = new Set<string>();
    page.block_ids.forEach((id, i) => {
      const path = `pages[${String(p)}].block_ids[${String(i)}]`;
      if (listed.has(id)) {
        emit(ctx, 'R10', path, `block_ids lists ${quote(id)} more than once`);
        return;
      }
      listed.add(id);
      if (!claimed.has(id)) {
        const block = ctx.byId.get(id);
        emit(
          ctx,
          'R10',
          path,
          block === undefined
            ? `block_ids names ${quote(id)}, which is not a block in this document`
            : `block_ids names ${quote(id)}, whose page_index is ${fmt(block.page_index)}`,
        );
      }
    });
    for (const block of ctx.blocksOnPage.get(page.index) ?? []) {
      if (!listed.has(block.block_id)) {
        emit(
          ctx,
          'R10',
          `pages[${String(p)}].block_ids`,
          `block ${quote(block.block_id)} claims page_index ${fmt(page.index)} but is not listed`,
        );
      }
    }
  });
}

function ruleR11AndR42(ctx: Ctx): void {
  ctx.pages.forEach((page, p) => {
    const onPage = ctx.blocksOnPage.get(page.index) ?? [];
    const expected = new Set(onPage.filter((b) => !isNested(ctx, b)).map((b) => b.block_id));
    const seen = new Set<string>();
    for (const flow of FLOW_KEYS) {
      const ids = page.flows[flow];
      ids.forEach((id, i) => {
        const path = `pages[${String(p)}].flows.${flow}[${String(i)}]`;
        const block = ctx.byId.get(id);
        if (block === undefined) {
          emit(ctx, 'R11', path, `flow names ${quote(id)}, which is not a block in this document`);
          return;
        }
        if (seen.has(id)) {
          emit(ctx, 'R11', path, `${quote(id)} appears in more than one flow on this page`);
          return;
        }
        seen.add(id);
        if (isNested(ctx, block)) {
          // Rule 42 is the enforcement half of D14 and owns this case exclusively, so a nested
          // block in a flow is reported once, not twice.
          emit(
            ctx,
            'R42',
            path,
            `${quote(id)} is NESTED (its parent ${quote(block.parent_id ?? '')} is not a heading) ` +
              `and must be reached through child_ids, never listed in a flow`,
          );
          return;
        }
        if (block.page_index !== page.index) {
          emit(
            ctx,
            'R11',
            path,
            `${quote(id)} sits on page ${fmt(block.page_index)}, not ${fmt(page.index)}`,
          );
          return;
        }
        if (block.flow !== flow) {
          emit(ctx, 'R11', path, `${quote(id)} has flow ${quote(block.flow)}, not ${quote(flow)}`);
        }
      });
    }
    for (const block of onPage) {
      if (!isNested(ctx, block) && !seen.has(block.block_id)) {
        emit(
          ctx,
          'R11',
          `pages[${String(p)}].flows.${block.flow}`,
          `top-level block ${quote(block.block_id)} on this page is in no flow`,
        );
      }
    }
    // `expected` exists to make the "union equals" half of rule 11 explicit rather than implied by
    // the two loops; it is deliberately not re-reported.
    void expected;
  });
}

function ruleR12(ctx: Ctx): void {
  ctx.pages.forEach((page, p) => {
    for (const flow of FLOW_KEYS) {
      const ids = page.flows[flow];
      let previous: number | null = null;
      ids.forEach((id, i) => {
        const block = ctx.byId.get(id);
        if (block === undefined) return; // rule 11 owns it.
        if (previous !== null && block.order < previous) {
          emit(
            ctx,
            'R12',
            `pages[${String(p)}].flows.${flow}[${String(i)}]`,
            `flow must ascend by block.order: ${fmt(block.order)} follows ${fmt(previous)}`,
          );
        }
        previous = block.order;
      });
    }
  });
}

// ─── ORDERING RULES ─────────────────────────────────────────────────────────────────────────

function ruleR14(ctx: Ctx): void {
  const groups = new Map<string, AnyBlock[]>();
  for (const block of ctx.blocks) {
    const container = isNested(ctx, block) ? (block.parent_id as string) : '';
    const key = `${String(block.page_index)} ${block.flow} ${container}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [block]);
    else bucket.push(block);
  }
  for (const [key, members] of groups) {
    const [pageIndex, flow, container] = key.split(' ') as [string, string, string];
    const label =
      `(page_index ${pageIndex}, flow ${flow}, ` +
      `${container === '' ? 'top level' : `container ${container}`})`;
    const seen = new Map<number, string>();
    for (const block of members) {
      const owner = seen.get(block.order);
      if (owner !== undefined) {
        emit(
          ctx,
          'R14',
          `${blockPath(ctx, block.block_id)}.order`,
          `order ${fmt(block.order)} is already taken by ${quote(owner)} in ${label}`,
        );
      } else {
        seen.set(block.order, block.block_id);
      }
    }
    for (let expected = 0; expected < members.length; expected += 1) {
      if (!seen.has(expected)) {
        emit(
          ctx,
          'R14',
          `${blockPath(ctx, (members[0] as AnyBlock).block_id)}.order`,
          `order must be dense 0..${String(members.length - 1)} within ${label}; ` +
            `${String(expected)} is missing`,
        );
      }
    }
  }
}

function ruleR15(ctx: Ctx): void {
  const carriers: AnyBlock[] = [];
  for (const block of ctx.blocks) {
    const shouldCarry = !isNested(ctx, block) && block.flow === 'body';
    const does = block.doc_order !== undefined;
    if (shouldCarry && !does) {
      emit(
        ctx,
        'R15',
        `${blockPath(ctx, block.block_id)}.doc_order`,
        'a top-level block in the body flow must carry doc_order',
      );
    }
    if (!shouldCarry && does) {
      emit(
        ctx,
        'R15',
        `${blockPath(ctx, block.block_id)}.doc_order`,
        isNested(ctx, block)
          ? 'a NESTED block must not carry doc_order — it is read as part of its container (D14)'
          : `only the body flow carries doc_order; this block's flow is ${quote(block.flow)}`,
      );
    }
    if (does) carriers.push(block);
  }
  const seen = new Map<number, string>();
  for (const block of carriers) {
    const value = block.doc_order as number;
    const owner = seen.get(value);
    if (owner !== undefined) {
      emit(
        ctx,
        'R15',
        `${blockPath(ctx, block.block_id)}.doc_order`,
        `doc_order ${fmt(value)} is already taken by ${quote(owner)}`,
      );
    } else {
      seen.set(value, block.block_id);
    }
  }
  for (let expected = 0; expected < carriers.length; expected += 1) {
    if (!seen.has(expected)) {
      emit(
        ctx,
        'R15',
        'blocks',
        `doc_order must be dense 0..${String(carriers.length - 1)} across the body flow; ` +
          `${String(expected)} is missing`,
      );
    }
  }
}

function ruleR16(ctx: Ctx): void {
  const stream = ctx.blocks
    .map((block, index) => ({ block, index }))
    .filter(
      ({ block }) =>
        block.doc_order !== undefined && !isNested(ctx, block) && block.flow === 'body',
    )
    .toSorted(
      (a, b) =>
        a.block.page_index - b.block.page_index ||
        a.block.order - b.block.order ||
        a.index - b.index,
    );
  for (let i = 1; i < stream.length; i += 1) {
    const previous = stream[i - 1] as { block: AnyBlock; index: number };
    const current = stream[i] as { block: AnyBlock; index: number };
    if ((current.block.doc_order as number) < (previous.block.doc_order as number)) {
      emit(
        ctx,
        'R16',
        `${blockPath(ctx, current.block.block_id)}.doc_order`,
        `the body stream runs backwards: (page ${fmt(current.block.page_index)}, order ` +
          `${fmt(current.block.order)}) has doc_order ${fmt(current.block.doc_order as number)} ` +
          `after (page ${fmt(previous.block.page_index)}, order ${fmt(previous.block.order)}) ` +
          `at ${fmt(previous.block.doc_order as number)}`,
      );
    }
  }
}

// ─── REFERENTIAL INTEGRITY ──────────────────────────────────────────────────────────────────

function resolves(
  ctx: Ctx,
  rule: string,
  id: string,
  path: string,
  what: string,
): AnyBlock | undefined {
  const block = ctx.byId.get(id);
  if (block === undefined) {
    emit(ctx, rule, path, `${what} names ${quote(id)}, which is not a block in this document`);
  }
  return block;
}

function ruleR4(ctx: Ctx): void {
  ctx.paper.relations.forEach((relation, r) => {
    resolves(ctx, 'R4', relation.from, `relations[${String(r)}].from`, 'relation endpoint');
    resolves(ctx, 'R4', relation.to, `relations[${String(r)}].to`, 'relation endpoint');
  });
}

function ruleR5(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    const base = `blocks[${String(b)}]`;
    for (const field of ['parent_id', 'prev_id', 'next_id'] as const) {
      const id = block[field];
      if (id !== undefined) resolves(ctx, 'R5', id, `${base}.${field}`, field);
    }
    (block.child_ids ?? []).forEach((id, c) => {
      resolves(ctx, 'R5', id, `${base}.child_ids[${String(c)}]`, 'child_ids');
    });
  });
}

const METADATA_VALUE_FIELDS = ['title', 'doi', 'arxiv_id', 'venue'] as const;

function ruleR6(ctx: Ctx): void {
  const metadata = ctx.paper.metadata;
  for (const field of METADATA_VALUE_FIELDS) {
    const value = metadata[field];
    if (value !== null) {
      resolves(ctx, 'R6', value.source_block_id, `metadata.${field}.source_block_id`, field);
    }
  }
  metadata.authors.forEach((author, a) => {
    resolves(
      ctx,
      'R6',
      author.source_block_id,
      `metadata.authors[${String(a)}].source_block_id`,
      'author',
    );
  });
  if (metadata.year !== null) {
    resolves(ctx, 'R6', metadata.year.source_block_id, 'metadata.year.source_block_id', 'year');
  }
  if (metadata.abstract !== null) {
    metadata.abstract.block_ids.forEach((id, i) => {
      resolves(ctx, 'R6', id, `metadata.abstract.block_ids[${String(i)}]`, 'abstract');
    });
  }
}

/**
 * Rule 6b / rule 35's shared engine: is `value`, under the library's normalisation, a substring of
 * the normalised text of `sourceId`? One `includes()` per field, exactly as §5.2 says — and it is
 * `normaliseText` from identity.ts, never a second normalisation, because rules 28/29/30b/35 all
 * key on that one contract.
 */
function assertQuoted(
  ctx: Ctx,
  rule: string,
  path: string,
  value: string,
  sourceId: string,
  label: string,
): void {
  const block = ctx.byId.get(sourceId);
  if (block === undefined) return; // rule 6/7 owns the dangling id.
  if (block.text === undefined) {
    emit(
      ctx,
      rule,
      path,
      `${label} ${quote(value)} cites block ${quote(sourceId)}, which has no text at all`,
    );
    return;
  }
  const needle = normaliseText(value);
  const haystack = normaliseText(block.text);
  if (!haystack.includes(needle)) {
    emit(
      ctx,
      rule,
      path,
      `${label} ${quote(value)} does not occur in the normalised text of ${quote(sourceId)} — ` +
        `a PaperIR scalar is EXTRACTED from its block, never composed, cleaned up or enriched`,
    );
  }
}

function ruleR6b(ctx: Ctx): void {
  const metadata = ctx.paper.metadata;
  for (const field of METADATA_VALUE_FIELDS) {
    const value = metadata[field];
    if (value !== null) {
      assertQuoted(
        ctx,
        'R6b',
        `metadata.${field}.value`,
        value.value,
        value.source_block_id,
        field,
      );
    }
  }
  metadata.authors.forEach((author, a) => {
    assertQuoted(
      ctx,
      'R6b',
      `metadata.authors[${String(a)}].value`,
      author.value,
      author.source_block_id,
      'author',
    );
  });
  if (metadata.year !== null) {
    assertQuoted(
      ctx,
      'R6b',
      'metadata.year.value',
      fmt(metadata.year.value),
      metadata.year.source_block_id,
      'year',
    );
  }
}

function ruleR7(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    const base = `blocks[${String(b)}]`;
    (block.spans ?? []).forEach((span, s) => {
      if (span.block_id !== undefined) {
        resolves(ctx, 'R7', span.block_id, `${base}.spans[${String(s)}].block_id`, 'span.block_id');
      }
    });
    const payload = block.payload;
    if (payload === undefined) return;
    const captionBlock = payload['caption_block'];
    if (typeof captionBlock === 'string') {
      resolves(ctx, 'R7', captionBlock, `${base}.payload.caption_block`, 'caption_block');
    }
    const referencedBy = payload['referenced_by'];
    if (Array.isArray(referencedBy)) {
      referencedBy.forEach((id, i) => {
        if (typeof id === 'string') {
          resolves(ctx, 'R7', id, `${base}.payload.referenced_by[${String(i)}]`, 'referenced_by');
        }
      });
    }
    const symbols = payload['symbols'];
    if (Array.isArray(symbols)) {
      symbols.forEach((symbol, i) => {
        const definition = (symbol as Record<string, unknown> | null)?.['definition_block'];
        if (typeof definition === 'string') {
          resolves(
            ctx,
            'R7',
            definition,
            `${base}.payload.symbols[${String(i)}].definition_block`,
            'definition_block',
          );
        }
      });
    }
    for (const cell of tableCells(payload)) {
      if (typeof cell.value['cell_id'] === 'string') {
        resolves(
          ctx,
          'R7',
          cell.value['cell_id'],
          `${base}.payload.grid.cells[${String(cell.index)}].cell_id`,
          'cell_id',
        );
      }
    }
  });
  ctx.paper.sections.forEach((section, s) => {
    resolves(
      ctx,
      'R7',
      section.heading_block_id,
      `sections[${String(s)}].heading_block_id`,
      'heading_block_id',
    );
    if (section.parent_heading_block_id !== undefined) {
      resolves(
        ctx,
        'R7',
        section.parent_heading_block_id,
        `sections[${String(s)}].parent_heading_block_id`,
        'parent_heading_block_id',
      );
    }
    section.block_ids.forEach((id, i) => {
      resolves(
        ctx,
        'R7',
        id,
        `sections[${String(s)}].block_ids[${String(i)}]`,
        'section.block_ids',
      );
    });
  });
  ctx.paper.references.forEach((reference, r) => {
    resolves(
      ctx,
      'R7',
      reference.reference_entry_block_id,
      `references[${String(r)}].reference_entry_block_id`,
      'reference_entry_block_id',
    );
  });
}

function tableCells(
  payload: Readonly<Record<string, unknown>>,
): Array<{ index: number; value: Record<string, unknown> }> {
  const grid = payload['grid'];
  if (grid === null || typeof grid !== 'object') return [];
  const cells = (grid as Record<string, unknown>)['cells'];
  if (!Array.isArray(cells)) return [];
  const out: Array<{ index: number; value: Record<string, unknown> }> = [];
  cells.forEach((cell, index) => {
    if (cell !== null && typeof cell === 'object') {
      out.push({ index, value: cell as Record<string, unknown> });
    }
  });
  return out;
}

function ruleR9(ctx: Ctx): void {
  const seen = new Map<string, number>();
  ctx.paper.relations.forEach((relation, r) => {
    const key = `${relation.type} ${relation.from} ${relation.to}`;
    const first = seen.get(key);
    if (first !== undefined) {
      emit(
        ctx,
        'R9',
        `relations[${String(r)}]`,
        `duplicate relation (${relation.type}, ${relation.from}, ${relation.to}); ` +
          `identity is the triple, so relations[${String(first)}] is the same edge`,
      );
    } else {
      seen.set(key, r);
    }
  });
}

// ─── TREE CONSISTENCY ───────────────────────────────────────────────────────────────────────

function ruleR17(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    const base = `blocks[${String(b)}]`;
    if (block.parent_id !== undefined) {
      const parent = ctx.byId.get(block.parent_id);
      if (parent !== undefined && !(parent.child_ids ?? []).includes(block.block_id)) {
        emit(
          ctx,
          'R17',
          `${base}.parent_id`,
          `parent ${quote(block.parent_id)} does not list ${quote(block.block_id)} in child_ids`,
        );
      }
    }
    (block.child_ids ?? []).forEach((childId, c) => {
      const child = ctx.byId.get(childId);
      if (child !== undefined && child.parent_id !== block.block_id) {
        emit(
          ctx,
          'R17',
          `${base}.child_ids[${String(c)}]`,
          `child ${quote(childId)} has parent_id ${quote(child.parent_id ?? '(absent)')}, ` +
            `not ${quote(block.block_id)}`,
        );
      }
    });
  });
}

function ruleR18(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    const base = `blocks[${String(b)}]`;
    if (block.next_id !== undefined) {
      const next = ctx.byId.get(block.next_id);
      if (next !== undefined) {
        if (next.prev_id !== block.block_id) {
          emit(
            ctx,
            'R18',
            `${base}.next_id`,
            `next ${quote(block.next_id)} has prev_id ${quote(next.prev_id ?? '(absent)')}, ` +
              `not ${quote(block.block_id)}`,
          );
        }
        if (next.parent_id !== block.parent_id) {
          emit(
            ctx,
            'R18',
            `${base}.next_id`,
            `prev/next link SIBLINGS only: parent_id ${quote(block.parent_id ?? '(absent)')} != ` +
              `${quote(next.parent_id ?? '(absent)')}`,
          );
        }
        if (next.block_id === block.parent_id || next.parent_id === block.block_id) {
          emit(ctx, 'R18', `${base}.next_id`, "a parent is never its child's next");
        }
      }
    }
    if (block.prev_id !== undefined) {
      const prev = ctx.byId.get(block.prev_id);
      if (prev !== undefined && prev.next_id !== block.block_id) {
        emit(
          ctx,
          'R18',
          `${base}.prev_id`,
          `prev ${quote(block.prev_id)} has next_id ${quote(prev.next_id ?? '(absent)')}, ` +
            `not ${quote(block.block_id)}`,
        );
      }
    }
  });
}

function ruleR19(ctx: Ctx): void {
  ctx.paper.relations.forEach((relation, r) => {
    const path = `relations[${String(r)}]`;
    if (relation.type === 'parent_of') {
      const child = ctx.byId.get(relation.to);
      const parent = ctx.byId.get(relation.from);
      if (child === undefined || parent === undefined) return; // rule 4 owns it.
      if (child.parent_id !== relation.from) {
        emit(
          ctx,
          'R19',
          path,
          `parent_of says ${quote(relation.from)} owns ${quote(relation.to)}, but that block's ` +
            `parent_id is ${quote(child.parent_id ?? '(absent)')}`,
        );
      }
      if (!(parent.child_ids ?? []).includes(relation.to)) {
        emit(
          ctx,
          'R19',
          path,
          `parent_of says ${quote(relation.from)} owns ${quote(relation.to)}, but that block is ` +
            `not in its child_ids`,
        );
      }
    }
    if (relation.type === 'next_in_reading_order') {
      const from = ctx.byId.get(relation.from);
      const to = ctx.byId.get(relation.to);
      if (from === undefined || to === undefined) return;
      if (from.next_id !== relation.to) {
        emit(
          ctx,
          'R19',
          path,
          `next_in_reading_order says ${quote(relation.to)} follows ${quote(relation.from)}, but ` +
            `its next_id is ${quote(from.next_id ?? '(absent)')}`,
        );
      }
      if (to.prev_id !== relation.from) {
        emit(
          ctx,
          'R19',
          path,
          `next_in_reading_order says ${quote(relation.to)} follows ${quote(relation.from)}, but ` +
            `its prev_id is ${quote(to.prev_id ?? '(absent)')}`,
        );
      }
    }
  });
}

/**
 * Walk `step` from `start` and return the CYCLE, if one is reached — the trail from the repeated
 * id onward, not the whole path. Returning only the cycle is what lets `ruleR20` report one
 * diagnostic per cycle rather than one per block that happens to lead into it.
 */
function walkCycle(
  ctx: Ctx,
  start: AnyBlock,
  step: (block: AnyBlock) => string | undefined,
): string[] | null {
  const seen = new Set<string>([start.block_id]);
  const trail = [start.block_id];
  let current: AnyBlock | undefined = start;
  while (current !== undefined) {
    const nextId = step(current);
    if (nextId === undefined) return null;
    trail.push(nextId);
    if (seen.has(nextId)) return trail.slice(trail.indexOf(nextId));
    seen.add(nextId);
    current = ctx.byId.get(nextId);
  }
  return null;
}

function ruleR20(ctx: Ctx): void {
  const reportedParent = new Set<string>();
  const reportedSibling = new Set<string>();
  ctx.blocks.forEach((block, b) => {
    const base = `blocks[${String(b)}]`;
    const parentCycle = walkCycle(ctx, block, (n) => n.parent_id);
    if (parentCycle !== null) {
      const key = [...new Set(parentCycle)].toSorted().join(',');
      if (!reportedParent.has(key)) {
        reportedParent.add(key);
        emit(
          ctx,
          'R20',
          `${base}.parent_id`,
          `the parent graph is cyclic: ${parentCycle.join(' -> ')}`,
        );
      }
    }
    const siblingCycle = walkCycle(ctx, block, (n) => n.next_id);
    if (siblingCycle !== null) {
      const key = [...new Set(siblingCycle)].toSorted().join(',');
      if (!reportedSibling.has(key)) {
        reportedSibling.add(key);
        emit(
          ctx,
          'R20',
          `${base}.next_id`,
          `the sibling chain is cyclic: ${siblingCycle.join(' -> ')}`,
        );
      }
    }
  });
}

function ruleR21(ctx: Ctx): void {
  const byHeading = new Map<string, Section>();
  for (const section of ctx.paper.sections) {
    if (!byHeading.has(section.heading_block_id)) byHeading.set(section.heading_block_id, section);
  }
  ctx.paper.sections.forEach((section, s) => {
    const path = `sections[${String(s)}]`;
    const heading = ctx.byId.get(section.heading_block_id);
    if (heading !== undefined && !isKnownHeadingBlockType(heading.type)) {
      emit(
        ctx,
        'R21',
        `${path}.heading_block_id`,
        `a section is opened by a heading block ("title" or "heading"), not by ` +
          `${quote(heading.type)}`,
      );
    }
    if (section.parent_heading_block_id === undefined) {
      if (section.level !== 1) {
        emit(
          ctx,
          'R21',
          `${path}.level`,
          `a section with no parent_heading_block_id is level 1, got ${fmt(section.level)}`,
        );
      }
      return;
    }
    const parent = byHeading.get(section.parent_heading_block_id);
    if (parent === undefined) {
      emit(
        ctx,
        'R21',
        `${path}.parent_heading_block_id`,
        `${quote(section.parent_heading_block_id)} does not open a section in this document`,
      );
      return;
    }
    if (section.level !== parent.level + 1) {
      emit(
        ctx,
        'R21',
        `${path}.level`,
        `level must be parent.level + 1 = ${fmt(parent.level + 1)}, got ${fmt(section.level)}`,
      );
    }
  });
}

function ruleR38(ctx: Ctx): void {
  ctx.paper.sections.forEach((section, s) => {
    const seen = new Set<string>();
    section.block_ids.forEach((id, i) => {
      const path = `sections[${String(s)}].block_ids[${String(i)}]`;
      if (id === section.heading_block_id) {
        emit(ctx, 'R38', path, 'section.block_ids must exclude its own heading_block_id');
      }
      if (seen.has(id)) emit(ctx, 'R38', path, `duplicate block id ${quote(id)}`);
      seen.add(id);
      const block = ctx.byId.get(id);
      if (block !== undefined && isNested(ctx, block)) {
        emit(
          ctx,
          'R38',
          path,
          `${quote(id)} is NESTED and belongs to its container, not directly to a section`,
        );
      }
    });
  });
}

// ─── TYPED-RELATION SEMANTICS ───────────────────────────────────────────────────────────────

function ruleR22(ctx: Ctx): void {
  ctx.paper.relations.forEach((relation, r) => {
    if (relation.type !== 'caption_of') return;
    const from = ctx.byId.get(relation.from);
    const to = ctx.byId.get(relation.to);
    if (from !== undefined && from.type !== 'caption') {
      emit(
        ctx,
        'R22',
        `relations[${String(r)}].from`,
        `caption_of.from must be a "caption" block, got ${quote(from.type)}`,
      );
    }
    if (to !== undefined && !FLOAT_BLOCK_TYPES.has(to.type)) {
      emit(
        ctx,
        'R22',
        `relations[${String(r)}].to`,
        `caption_of.to must be a float (figure/table/diagram/plot), got ${quote(to.type)}`,
      );
    }
  });
  ctx.blocks.forEach((block, b) => {
    const captionBlock = block.payload?.['caption_block'];
    if (typeof captionBlock !== 'string') return;
    const caption = ctx.byId.get(captionBlock);
    if (caption !== undefined && caption.type !== 'caption') {
      emit(
        ctx,
        'R22',
        `blocks[${String(b)}].payload.caption_block`,
        `caption_block must name a "caption" block, got ${quote(caption.type)}`,
      );
    }
  });
}

function ruleR23(ctx: Ctx): void {
  ctx.paper.relations.forEach((relation, r) => {
    if (relation.type !== 'cites') return;
    const to = ctx.byId.get(relation.to);
    if (to !== undefined && to.type !== 'reference_entry') {
      emit(
        ctx,
        'R23',
        `relations[${String(r)}].to`,
        `cites.to must be a "reference_entry" block, got ${quote(to.type)}`,
      );
    }
  });
}

function ruleR24(ctx: Ctx): void {
  ctx.paper.relations.forEach((relation, r) => {
    if (relation.type !== 'continues_on_next_page') return;
    const from = ctx.byId.get(relation.from);
    const to = ctx.byId.get(relation.to);
    if (from === undefined || to === undefined) return;
    if (from.page_index >= to.page_index) {
      emit(
        ctx,
        'R24',
        `relations[${String(r)}]`,
        `continues_on_next_page must run to a LATER page: ${fmt(from.page_index)} -> ` +
          `${fmt(to.page_index)}`,
      );
    }
  });
}

function ruleR24b(ctx: Ctx): void {
  ctx.paper.relations.forEach((relation, r) => {
    if (relation.type !== 'continues_in_next_column') return;
    const path = `relations[${String(r)}]`;
    const from = ctx.byId.get(relation.from);
    const to = ctx.byId.get(relation.to);
    if (from === undefined || to === undefined) return;
    if (from.page_index !== to.page_index) {
      emit(
        ctx,
        'R24b',
        path,
        `continues_in_next_column stays on ONE page: ${fmt(from.page_index)} -> ` +
          `${fmt(to.page_index)} (use continues_on_next_page)`,
      );
      return;
    }
    if (!(from.bbox[0] < to.bbox[0])) {
      emit(
        ctx,
        'R24b',
        path,
        `continues_in_next_column must ascend by bbox.x0: ${fmt(from.bbox[0])} -> ` +
          `${fmt(to.bbox[0])}`,
      );
    }
    if (from.bbox[2] > to.bbox[0]) {
      emit(
        ctx,
        'R24b',
        path,
        `the two columns' x-extents overlap ([${fmt(from.bbox[0])}, ${fmt(from.bbox[2])}] and ` +
          `[${fmt(to.bbox[0])}, ${fmt(to.bbox[2])}]) — a single block spanning the gutter is the ` +
          `highlight bleed Commitment 2 exists to prevent`,
      );
    }
  });
}

// ─── TEXT, SPANS AND REPAIRS ────────────────────────────────────────────────────────────────

function ruleR25(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    const spans = block.spans;
    if (spans === undefined) return;
    if (block.text === undefined) {
      emit(ctx, 'R25', `blocks[${String(b)}].spans`, 'a block with spans must have text');
      return;
    }
    const length = codePointLength(block.text);
    spans.forEach((span, s) => {
      const path = `blocks[${String(b)}].spans[${String(s)}]`;
      if (!(span.start >= 0 && span.start < span.end && span.end <= length)) {
        emit(
          ctx,
          'R25',
          path,
          `span must satisfy 0 <= start < end <= len(text) = ${String(length)} code points, got ` +
            `[${fmt(span.start)}, ${fmt(span.end)})`,
        );
      }
    });
  });
}

function ruleR26(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    const spans = block.spans;
    if (spans === undefined) return;
    for (let s = 1; s < spans.length; s += 1) {
      const previous = spans[s - 1] as AnySpan;
      const current = spans[s] as AnySpan;
      const path = `blocks[${String(b)}].spans[${String(s)}]`;
      if (current.start < previous.start) {
        emit(
          ctx,
          'R26',
          path,
          `spans must ascend by start: ${fmt(current.start)} follows ${fmt(previous.start)}`,
        );
      } else if (current.start < previous.end) {
        emit(
          ctx,
          'R26',
          path,
          `spans must not overlap: [${fmt(current.start)}, ${fmt(current.end)}) overlaps ` +
            `[${fmt(previous.start)}, ${fmt(previous.end)})`,
        );
      }
    }
  });
}

function ruleR27(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    (block.repairs ?? []).forEach((repair, r) => {
      if (repair.at === undefined) return; // e.g. reorder: no single offset, and never guessed.
      const path = `blocks[${String(b)}].repairs[${String(r)}].at`;
      if (block.text === undefined) {
        emit(ctx, 'R27', path, 'a repair with an offset requires the block to have text');
        return;
      }
      const expected = repair.applied ? repair.to : repair.from;
      const length = codePointLength(block.text);
      if (repair.at < 0 || repair.at + codePointLength(expected) > length) {
        emit(
          ctx,
          'R27',
          path,
          `at ${fmt(repair.at)} + len(${repair.applied ? 'to' : 'from'}) = ` +
            `${String(repair.at + codePointLength(expected))} runs past len(text) = ` +
            `${String(length)} code points`,
        );
        return;
      }
      const actual = sliceCodePoints(block.text, repair.at, repair.at + codePointLength(expected));
      if (actual !== expected) {
        emit(
          ctx,
          'R27',
          path,
          `text[${fmt(repair.at)}:] is ${quote(actual)}, but an applied=${String(repair.applied)} ` +
            `repair requires ${quote(expected)} there`,
        );
      }
    });
  });
}

function ruleR28(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    if (block.text_normalised === undefined) return;
    const path = `blocks[${String(b)}].text_normalised`;
    if (block.text === undefined) {
      emit(
        ctx,
        'R28',
        path,
        'text_normalised without text: there is nothing it can be derived from',
      );
      return;
    }
    const expected = normaliseText(block.text);
    if (block.text_normalised !== expected) {
      emit(
        ctx,
        'R28',
        path,
        `text_normalised is ${quote(block.text_normalised)}, but the library's normalisation of ` +
          `text is ${quote(expected)}`,
      );
    }
  });
}

function ruleR29(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    if (block.content_hash === undefined) return;
    const path = `blocks[${String(b)}].content_hash`;
    // The subject is a string ALREADY in normalised form, so it is digested as-is:
    // `normaliseText` is deliberately not idempotent (Amendment 1 § A: its output is not
    // guaranteed to be NFC), and normalising `text_normalised` a second time re-composes a
    // ligature expansion that lands in front of a combining mark. Doing that would fail a
    // document whose `content_hash` came from `identity.contentHash(block.text)` — the library's
    // own documented API — so the two must be compared through the same single normalisation.
    const subject =
      block.text_normalised ?? (block.text === undefined ? undefined : normaliseText(block.text));
    if (subject === undefined) {
      emit(ctx, 'R29', path, 'content_hash without text or text_normalised: nothing to digest');
      return;
    }
    const expected = computeContentHash(subject);
    if (block.content_hash !== expected) {
      emit(
        ctx,
        'R29',
        path,
        `content_hash is ${quote(block.content_hash)}, but the library's digest of ` +
          `text_normalised is ${quote(expected)}`,
      );
    }
  });
}

function ruleR30(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    (block.repairs ?? []).forEach((repair, r) => {
      if (!MODEL_REPAIR_KINDS.has(repair.kind)) return;
      const path = `blocks[${String(b)}].repairs[${String(r)}]`;
      if (repair.model_id === undefined) {
        emit(ctx, 'R30', path, `a ${repair.kind} repair must name the model_id that proposed it`);
      }
      if (repair.prompt_hash === undefined) {
        emit(
          ctx,
          'R30',
          path,
          `a ${repair.kind} repair must carry the prompt_hash that produced it, so the proposal ` +
            `is reproducible and auditable`,
        );
      }
      if (repair.applied) {
        emit(
          ctx,
          'R30',
          path,
          `a ${repair.kind} repair is a PROPOSAL and must have applied: false — a model never ` +
            `overwrites source`,
        );
      }
    });
  });
}

function ruleR30b(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    (block.repairs ?? []).forEach((repair, r) => {
      if (!DETERMINISTIC_REPAIR_KINDS.has(repair.kind)) return;
      const path = `blocks[${String(b)}].repairs[${String(r)}]`;
      const complain = (rule: string, expected: string): void => {
        emit(
          ctx,
          'R30b',
          path,
          `a "${repair.kind}" repair must be exactly ${rule}: from ${quote(repair.from)} gives ` +
            `${quote(expected)}, but to is ${quote(repair.to)}. A deterministic kind whose ` +
            `from -> to is not reproducibly an edit of its own class is an arbitrary rewrite of ` +
            `source wearing a rule-based label`,
        );
      };
      switch (repair.kind) {
        case 'whitespace': {
          const a = collapseWhitespace(repair.from);
          const c = collapseWhitespace(repair.to);
          if (a !== c) complain('from == to under whitespace collapse', a);
          break;
        }
        case 'ligature': {
          const expected = expandLigatures(repair.from);
          if (expected !== repair.to) complain('ligature expansion of from', expected);
          break;
        }
        case 'unicode_normalise': {
          // ESCALATION, measured. This is the ONE check in this file that calls a RUNTIME Unicode
          // function, and it forks the two twins for exactly the reason ADR-001 Amendment 1 §
          // "case fold by table" forbids one: Node 22 carries Unicode 17.0 and Python 3.12 carries
          // UCD 15.0.0, and NFKC differs on 37 code points between them (U+A7F1 and U+1CCD6…
          // U+1CCF9 — measured, not assumed; `unicode_normalise NFKC is a RUNTIME call` in
          // validate.spec pins the measurement so a runtime upgrade surfaces it). A repair whose
          // `from` contains one of those 37 is accepted here and rejected by the Python twin.
          // Closing it properly means shipping a pinned NFKC table in conformance/, which is a
          // contract change and is not this module's to make — DESIGN.md §5.2 rule 30b says
          // "to == NFKC(from)" and this implements exactly that.
          const expected = repair.from.normalize('NFKC');
          if (expected !== repair.to) complain('NFKC(from)', expected);
          break;
        }
        case 'dehyphenate': {
          const expected = dehyphenate(repair.from);
          if (expected !== repair.to) {
            complain('from with a soft/hard hyphen + line break removed', expected);
          }
          break;
        }
        case 'reorder': {
          if (!multisetsEqual(tokenMultiset(repair.from), tokenMultiset(repair.to))) {
            complain("a permutation of from's whitespace-separated tokens", repair.from);
          }
          break;
        }
        default:
          break;
      }
      if (repair.model_id !== undefined || repair.prompt_hash !== undefined) {
        emit(
          ctx,
          'R30b',
          path,
          `a deterministic "${repair.kind}" repair must not name a model: its entire ` +
            `justification is that it is rule-based and reproducible`,
        );
      }
    });
  });
}

function ruleR31(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    const alternatives = block.alternatives;
    if (alternatives === undefined) return;
    let selectedIndex: number | null = null;
    alternatives.forEach((alternative, a) => {
      if (alternative.decision !== 'selected') return;
      const path = `blocks[${String(b)}].alternatives[${String(a)}]`;
      if (selectedIndex !== null) {
        emit(
          ctx,
          'R31',
          path,
          `at most one alternative may be "selected"; alternatives[${String(selectedIndex)}] ` +
            `already is`,
        );
        return;
      }
      selectedIndex = a;
      if (alternative.text !== undefined && alternative.text !== block.text) {
        emit(
          ctx,
          'R31',
          `${path}.text`,
          `the selected alternative's text ${quote(alternative.text)} is not block.text ` +
            `${quote(block.text ?? '(absent)')} — the selected reading IS what renders`,
        );
      }
    });
  });
}

// ─── MATERIALISED-VIEW HONESTY ──────────────────────────────────────────────────────────────

function ruleR32(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    if (block.type !== 'table' || block.payload === undefined) return;
    for (const { index, value } of tableCells(block.payload)) {
      const path = `blocks[${String(b)}].payload.grid.cells[${String(index)}]`;
      const cellId = value['cell_id'];
      if (typeof cellId !== 'string') continue;
      const cell = ctx.byId.get(cellId);
      if (cell === undefined) continue; // rule 7 owns it.
      if (cell.type !== 'table_cell') {
        emit(
          ctx,
          'R32',
          `${path}.cell_id`,
          `cell_id must name a "table_cell" block, got ${quote(cell.type)}`,
        );
      }
      if (cell.page_index !== block.page_index) {
        emit(
          ctx,
          'R32',
          `${path}.cell_id`,
          `cell sits on page ${fmt(cell.page_index)} but its table is on page ` +
            `${fmt(block.page_index)}`,
        );
      }
      const text = value['text'];
      if (typeof text === 'string' && text !== cell.text) {
        emit(
          ctx,
          'R32',
          `${path}.text`,
          `grid cell text ${quote(text)} != the table_cell block's text ` +
            `${quote(cell.text ?? '(absent)')} — a derived field nobody checks is a second ` +
            `representation that drifts`,
        );
      }
    }
  });
}

const REFERENCE_STRING_FIELDS = ['title', 'venue', 'doi', 'arxiv_id', 'url'] as const;

function ruleR35(ctx: Ctx): void {
  ctx.paper.references.forEach((reference, r) => {
    const base = `references[${String(r)}]`;
    const source = reference.reference_entry_block_id;
    for (const field of REFERENCE_STRING_FIELDS) {
      const value = (reference as Reference)[field];
      if (value !== undefined) {
        assertQuoted(ctx, 'R35', `${base}.${field}`, value, source, `reference ${field}`);
      }
    }
    (reference.authors ?? []).forEach((author, a) => {
      assertQuoted(ctx, 'R35', `${base}.authors[${String(a)}]`, author, source, 'reference author');
    });
    if (reference.year !== undefined) {
      assertQuoted(ctx, 'R35', `${base}.year`, fmt(reference.year), source, 'reference year');
    }
  });
}

function ruleR36(ctx: Ctx): void {
  if (ctx.paper.status !== 'complete') return;
  ctx.blocks.forEach((block, b) => {
    if (!CROPPED_BLOCK_TYPES.has(block.type)) return;
    const image = block.payload?.['image'];
    if (image === null || image === undefined) {
      emit(
        ctx,
        'R36',
        `blocks[${String(b)}].payload.image`,
        `a "complete" paper retains the rendered source region on every ${block.type} block; ` +
          `the crop is ground truth and the latex/vector reading is an interpretation of it`,
      );
    }
  });
}

function ruleR37(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    if (block.text === undefined || block.source !== 'pdf_text_layer') return;
    if (block.text_normalised === undefined) {
      emit(
        ctx,
        'R37',
        `blocks[${String(b)}].text_normalised`,
        'tier-2 anchoring cannot be optional on exactly the blocks anchors land on',
      );
    }
    if (block.content_hash === undefined) {
      emit(
        ctx,
        'R37',
        `blocks[${String(b)}].content_hash`,
        'tier-2 anchoring cannot be optional on exactly the blocks anchors land on',
      );
    }
  });
}

function ruleR39(ctx: Ctx): void {
  ctx.blocks.forEach((block, b) => {
    if (block.type !== 'inline_equation' || block.payload === undefined) return;
    if (block.payload['display'] !== false) {
      emit(
        ctx,
        'R39',
        `blocks[${String(b)}].payload.display`,
        'an inline_equation is by definition not display math: payload.display must be false',
      );
    }
  });
}

// ─── IDENTITY ───────────────────────────────────────────────────────────────────────────────

const SOURCE_HASH_PREFIX = 'sha256:';

/**
 * I1 — the rule that catches a producer INVENTING ids.
 *
 * Not numbered in DESIGN.md §5.2, because §5.2 was written before F0.4 existed and the rule is not
 * expressible without it. It is the only check in this file that reaches outside the document: it
 * recomputes `blk_…` from the block's own `source_hash | page_index | q(x0) | q(y0) | type |
 * normalise(text)[:8]` and compares. Everything else here checks that the document agrees with
 * itself; this checks that it agrees with the formula.
 *
 * The anchor is `bbox[0], bbox[1]` — the stored top-left, which is what the producer hashed. Rule 1
 * separately pins that bbox to the polygon, so the two together mean the id is derived from the
 * geometry the reader actually sees.
 */
function ruleI1(ctx: Ctx): void {
  const raw = ctx.paper.source_hash;
  const sourceHash = raw.startsWith(SOURCE_HASH_PREFIX)
    ? raw.slice(SOURCE_HASH_PREFIX.length)
    : raw;
  ctx.blocks.forEach((block, b) => {
    const path = `blocks[${String(b)}].block_id`;
    if (!allFinite(block.bbox)) return; // G5 owns it.
    let expected: string;
    try {
      expected = recomputeBlockId({
        source_hash: sourceHash,
        page_index: block.page_index,
        x0: block.bbox[0],
        y0: block.bbox[1],
        block_type: block.type,
        // A block legitimately has no text (the `unknown` requirement). The formula hashes the
        // normalised prefix, and normalise("") is "", so the empty string is the only encoding
        // of "no text" that does not invent one.
        text: block.text ?? '',
      });
    } catch (error) {
      emit(
        ctx,
        'I1',
        path,
        `block_id cannot be recomputed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (block.block_id !== expected) {
      emit(
        ctx,
        'I1',
        path,
        `block_id is ${quote(block.block_id)} but the formula (ADR-001 Amendment 1) over this ` +
          `block's own source_hash | page_index | q(x0) | q(y0) | type | normalise(text)[:8] ` +
          `gives ${quote(expected)}`,
      );
    }
  });
}

// ─── ENTRY POINT ────────────────────────────────────────────────────────────────────────────

/** Rules in the order they run, which is the order diagnostics come out in. */
const RULE_PASSES: ReadonlyArray<readonly [string, (ctx: Ctx) => void]> = [
  ['G5', ruleG5],
  ['R2', ruleR2],
  ['R1', ruleR1],
  ['G6', ruleG6],
  ['R3', ruleR3AndG7],
  ['G4', ruleG4],
  ['G8', ruleG8],
  ['R8', ruleR8],
  ['R40', ruleR40],
  ['R41', ruleR41],
  ['R13', ruleR13],
  ['R13b', ruleR13b],
  ['R10', ruleR10],
  ['R11', ruleR11AndR42],
  ['R12', ruleR12],
  ['R14', ruleR14],
  ['R15', ruleR15],
  ['R16', ruleR16],
  ['R4', ruleR4],
  ['R5', ruleR5],
  ['R6', ruleR6],
  ['R6b', ruleR6b],
  ['R7', ruleR7],
  ['R9', ruleR9],
  ['R17', ruleR17],
  ['R18', ruleR18],
  ['R19', ruleR19],
  ['R20', ruleR20],
  ['R21', ruleR21],
  ['R38', ruleR38],
  ['R22', ruleR22],
  ['R23', ruleR23],
  ['R24', ruleR24],
  ['R24b', ruleR24b],
  ['R25', ruleR25],
  ['R26', ruleR26],
  ['R27', ruleR27],
  ['R28', ruleR28],
  ['R29', ruleR29],
  ['R30', ruleR30],
  ['R30b', ruleR30b],
  ['R31', ruleR31],
  ['R32', ruleR32],
  ['R35', ruleR35],
  ['R36', ruleR36],
  ['R37', ruleR37],
  ['R39', ruleR39],
  ['I1', ruleI1],
];

/**
 * Run every semantic rule against a SCHEMA-VALID `Paper`.
 *
 * Never throws for a malformed document — that is the whole point of a validator — but it does
 * assume the input has already satisfied the JSON Schema. See `assertValidPaper` for the throwing
 * form.
 */
export function validatePaper(paper: Paper, options: ValidateOptions = {}): ValidationReport {
  // One cast at the boundary: `Block` is a discriminated union whose payload members are
  // interfaces, and TypeScript gives an interface no implicit index signature.
  const blocks = paper.blocks as unknown as readonly AnyBlock[];
  const byId = new Map<string, AnyBlock>();
  const indexById = new Map<string, number>();
  blocks.forEach((block, index) => {
    if (!byId.has(block.block_id)) {
      byId.set(block.block_id, block);
      indexById.set(block.block_id, index);
    }
  });
  const pageByIndex = new Map<number, Page>();
  for (const page of paper.pages)
    if (!pageByIndex.has(page.index)) pageByIndex.set(page.index, page);
  const blocksOnPage = new Map<number, AnyBlock[]>();
  for (const block of blocks) {
    const bucket = blocksOnPage.get(block.page_index);
    if (bucket === undefined) blocksOnPage.set(block.page_index, [block]);
    else bucket.push(block);
  }

  const ctx: Ctx = {
    paper,
    blocks,
    pages: paper.pages,
    byId,
    indexById,
    pageByIndex,
    blocksOnPage,
    out: [],
    disabled: new Set(options.disabledRules ?? []),
    bboxEpsilon: options.bboxEpsilonPt ?? BBOX_EXTENT_EPSILON_PT,
    cropTolerance: options.cropBoxTolerancePt ?? BBOX_EXTENT_EPSILON_PT,
    outOfBoxFraction: options.outOfCropBoxErrorFraction ?? 0.05,
    minCoverage: options.minPageCoverageFraction ?? 0.01,
  };

  for (const [, pass] of RULE_PASSES) pass(ctx);

  const diagnostics: readonly Diagnostic[] = ctx.out;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  return { ok: errors.length === 0, diagnostics, errors, warnings };
}

/** `validatePaper`, but a document with any ERROR throws. Warnings never throw. */
export function assertValidPaper(paper: Paper, options: ValidateOptions = {}): void {
  const report = validatePaper(paper, options);
  if (!report.ok) throw new SemanticValidationError(report.diagnostics);
}

/** `rule severity path` per line — the form a test failure and a CI log both want. */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => `${d.rule} ${d.severity} ${d.path}: ${d.message}`).join('\n');
}
