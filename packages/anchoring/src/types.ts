/**
 * anchoring/types — the persisted anchor record (ADR-004), and the resolver's verdict.
 *
 * WHY THIS IS AN ARRAY OF SELECTORS AND NOT A BLOCK ID.
 *
 * The W3C Web Annotation Data Model (Rec, 23 Feb 2017) permits an array of alternative selectors
 * "so that the consuming user agent will be able to use at least one", and deliberately defines NO
 * priority order — resolution order is an implementation concern, which is what `resolve.ts` is.
 * PaperTree needs the redundancy for a measured reason rather than a stylistic one:
 *
 *   A paragraph-merge segmentation change retires **42.2 %** of block ids corpus-wide, of which
 *   35.75 pp is a floor no formula can beat (EPIC-00-RESULT §4.3). Of the ids that DO survive a
 *   merge, 11.73 % land on a block whose text has changed; under a split, 30.9 % do.
 *
 * So `BlockSelector` alone tops out near 58 % and is wrong about a ninth of what it does return.
 * `≥99 %` is only reachable through the lower tiers, and the lower tiers only work if they were
 * captured at the same time as the block id. An anchor written with one selector cannot be
 * repaired later — the document it referred to is gone. That is why ADR-004 is MANDATORY.
 *
 * COORDINATE SPACE. Every geometric field here is **IR space**: PDF user-space points, origin
 * TOP-LEFT of the page's post-rotation crop rect, y growing DOWNWARD, `/Rotate` already applied,
 * `/UserUnit` recorded but NOT applied. That is `document-ir/geometry`'s space, and it is NOT
 * pdf.js's — pdf.js hands out bottom-left-origin raw PDF space. `bridge.ts` is the only place the
 * two meet. Never store viewport pixels, device pixels, DPR, or fractions of a DOM element: doing
 * exactly that is why every highlight in the v1 app is unrecoverable.
 */

import type { BBox, BlockId, Polygon } from '@papertree/document-ir';

// ─── the ten target kinds ───────────────────────────────────────────────────────────────────────

/**
 * What the user pointed at. `anchoring/targets.spec` requires all ten to resolve.
 *
 * These are NOT block types. `equation_part` and `figure_region` are sub-block targets that share
 * their parent's block id and are distinguished by `subTarget`; `guided_para` is a target in a
 * representation that has no geometry at all.
 */
export type TargetKind =
  | 'text'
  | 'guided_para'
  | 'equation'
  | 'equation_part'
  | 'figure'
  | 'figure_region'
  | 'table_row'
  | 'table_cell'
  | 'algorithm'
  | 'citation';

/**
 * Source or model. A HARD RULE, not a label: a Guided-mode highlight over derived prose is NOT a
 * highlight of the paper, and must never be fed back to a model as "text from a research paper".
 * The v1 app stores both identically and does exactly that.
 */
export type ProvenanceClass = 'source' | 'ai_generated';

// ─── selectors ──────────────────────────────────────────────────────────────────────────────────

/** T1. Ours, O(1), and never trusted on its own — see `blockTextHash`. */
export interface BlockSelector {
  readonly type: 'BlockSelector';
  readonly blockId: BlockId;
  /**
   * `Block.content_hash` AS IT WAS AT CAPTURE, `"sha256:"`-prefixed.
   *
   * Stored SEPARATELY from the id, because the id hashes only the block's TOP-LEFT ANCHOR
   * (`x0, y0`) — never `x1`/`y1` — so a block that grows downward keeps its id while its text
   * changes underneath. Measured: 11.73 % of merge survivors and 30.9 % of split survivors inherit
   * an id onto changed text. `content_hash` catches 100 % of them. A tier-1 hit returned without
   * this check is a silent misresolution, which is worse than an orphan because nothing surfaces.
   */
  readonly blockTextHash: string;
  /** Code-point offsets into the block's OWN text. Both absent ⇒ the whole block. */
  readonly startOffset?: number;
  readonly endOffset?: number;
  /** Set for `table_cell` / `table_row`. `[startRow, startCol]` per Docling's offset indices. */
  readonly cellRef?: readonly [number, number];
  readonly rowIndex?: number;
}

/** 0-based index plus the PRINTED label, which is not the index on roman or appendix pages. */
export interface PageSelector {
  readonly type: 'PageSelector';
  readonly index: number;
  readonly label?: string;
}

/**
 * T2. Document-global code-point offsets into the concatenated text stream. A HINT ONLY.
 *
 * Hypothesis's PDF path strips all whitespace before matching, with a decisive source comment:
 * text extracted from a PDF "by different PDF viewers, including different versions of PDF.js, can
 * often differ in the whitespace between characters and words". Any offset-based anchor into
 * extracted text is fragile across extractor versions, so this tier proposes and T3 disposes.
 */
export interface TextPositionSelector {
  readonly type: 'TextPositionSelector';
  readonly start: number;
  readonly end: number;
}

/**
 * T3. The durable one.
 *
 * `exact` is stored RAW for display; matching runs against `exactNormalised`. Context is 64 chars
 * rather than Hypothesis's hard-coded 32, snapped to word boundaries: academic prose is dense in
 * repeated phrasing ("we show that", "as shown in Figure") and 32 characters is frequently
 * non-discriminating.
 */
export interface TextQuoteSelector {
  readonly type: 'TextQuoteSelector';
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
  /** NFC + ws-collapsed + ligatures folded + line-break hyphens joined. MATCH ON THIS. */
  readonly exactNormalised: string;
  readonly prefixNormalised: string;
  readonly suffixNormalised: string;
}

/**
 * T4. Parser-independent geometry — the tier that survives when every text tier has failed,
 * because the glyphs did not move when the segmenter changed its mind about paragraphs.
 *
 * `quads` are axis-aligned min/max rects, ONE PER TYPOGRAPHIC LINE, in IR space. Never trust PDF
 * quad VERTEX ORDER: ISO 32000-1 §12.5.6.10 specifies an order that real files do not follow, and
 * pdf.js's own source calls the situation "even worse" because Adobe's own applications violate it
 * too. pdf.js discards the ordering and renormalises via min/max; so does this.
 */
export interface ShapeSelector {
  readonly type: 'ShapeSelector';
  readonly pageIndex: number;
  readonly quads: readonly BBox[];
  /**
   * The region outline. Polygons, NOT a bounding box: a selection crossing the gutter of a
   * two-column paper is two polygons, and flattening it to one box paints over the gutter. There
   * is more than one polygon exactly when the selection is disconnected.
   */
  readonly polygons: readonly Polygon[];
  /** The page frame at capture, so the anchor is re-projectable without the original file. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly userUnit: number;
  /** `Page.crop_box`, always `[0, 0, width, height]` in IR space (DESIGN.md D23 / rule G4). */
  readonly cropBox: BBox;
}

/** T5. For reflowed representations, where geometry does not exist. */
export interface SectionPathSelector {
  readonly type: 'SectionPathSelector';
  readonly path: readonly string[];
  readonly headingText: string;
  readonly paraIndexInSection: number;
  readonly charOffsetInPara: number;
}

/**
 * A sub-block target: part of an equation, a region inside a figure, one cell of a table.
 *
 * The normalised rect is relative to the PARENT BLOCK's bbox, `(0,0)` at its top-left, so it
 * re-projects onto a re-parsed block of a different size. That is what makes "part of equation (2)"
 * survive a re-parse: the detector gives the formula's bbox before recognition runs, so the anchor
 * survives even when the LaTeX is wrong or absent.
 */
export interface SubTarget {
  readonly kind: 'equation_part' | 'figure_region' | 'table_cell' | 'table_row' | 'algorithm_line';
  /** `[nx0, ny0, nx1, ny1]`, each in `[0, 1]`, relative to the parent block's bbox. */
  readonly normalisedRect?: readonly [number, number, number, number];
  /** Code-point offsets into `EquationPayload.latex`, when it exists. Geometry-only otherwise. */
  readonly latexStart?: number;
  readonly latexEnd?: number;
  readonly lineIndex?: number;
}

export type Selector =
  | BlockSelector
  | PageSelector
  | TextPositionSelector
  | TextQuoteSelector
  | ShapeSelector
  | SectionPathSelector;

// ─── the record ─────────────────────────────────────────────────────────────────────────────────

/** Which extraction produced the offsets. Two runs of one library can differ — see T2's note. */
export interface AnchorDoc {
  readonly paperId: string;
  /** `sha256:…` of the PDF bytes. The bytes are immutable; this is the strongest identity there is. */
  readonly pdfSha256: string;
  readonly parserVersion: string;
  readonly textStreamId: string;
}

export type ResolutionState = 'anchored' | 'approximate' | 'orphan';

/**
 * The T0 cache. MUST be persisted with the anchor, or T3 re-runs on every open — Hypothesis issue
 * #3919 reports fuzzy anchoring blocking for >10 s on long documents with short quotes, with ~60 %
 * of load time in imperfect-match resolution. (User-reported, 2021, not instrumented by the
 * Hypothesis team: a hazard signal, not a benchmark. The mitigation is mandatory regardless.)
 *
 * Keyed by `(parserVersion, textStreamId)`: a cache hit is only valid against the same parse.
 */
export interface ResolutionCache {
  readonly tier: number;
  readonly score: number;
  readonly resolvedBlockIds: readonly BlockId[];
  readonly resolvedAt: string;
  readonly parserVersion: string;
  readonly textStreamId: string;
  readonly state: ResolutionState;
}

export interface Anchor {
  /** Schema version of THIS record; the migration key. */
  readonly anchorVersion: 1;
  /**
   * Declare it. `approx-string-match` operates on UTF-16 code units; W3C mandates code points;
   * `document-ir`'s `normaliseText` counts code points. The three conflict and offsets drift
   * SILENTLY if this is left implicit. Everything in this package is `unicode` (code points).
   */
  readonly offsetUnit: 'unicode';
  readonly id: string;
  readonly doc: AnchorDoc;
  readonly targetKind: TargetKind;
  readonly provenanceClass: ProvenanceClass;
  readonly subTarget?: SubTarget;
  readonly selectors: readonly Selector[];
  readonly resolution?: ResolutionCache;
  readonly created: { readonly mode: 'source' | 'guided'; readonly at: string; readonly client: string };
}

// ─── the verdict ────────────────────────────────────────────────────────────────────────────────

/**
 * Which rung of the ladder produced the answer. Persisted and shown to the user, because "we found
 * this by fuzzy-matching the quote" and "this is the block you highlighted" are different claims
 * and the UI must not present them identically.
 */
export enum Tier {
  Cache = 0,
  Block = 1,
  Position = 2,
  Quote = 3,
  Shape = 4,
  SectionPath = 5,
  Orphan = 6,
}

/**
 * Why an anchor did not resolve cleanly. EVERY value here reaches the user — `reparse.spec`
 * requires that every failure is surfaced and never silently dropped, and a reason code that is
 * only ever logged does not satisfy that.
 */
export type AnchorFailureReason =
  | 'block_id_missing'
  | 'block_text_changed'
  | 'quote_below_threshold'
  | 'quote_too_short_no_context'
  | 'no_geometric_overlap'
  | 'section_not_found'
  | 'page_out_of_range'
  | 'no_selectors';

export interface Resolution {
  readonly tier: Tier;
  /** `[0, 1]`. Not a confidence: it is the ladder's own score, and the tier says what it means. */
  readonly score: number;
  readonly state: ResolutionState;
  readonly blockIds: readonly BlockId[];
  /** Where to paint, in IR space. Empty for a `guided_para` target, which has no geometry. */
  readonly polygons: readonly Polygon[];
  readonly quads: readonly BBox[];
  readonly pageIndex: number | null;
  /** Present whenever `state !== 'anchored'`. The UI renders this; it is not for the log. */
  readonly reason?: AnchorFailureReason;
  /**
   * Set when the tier that answered cannot place the anchor precisely — T4 and T5 always, T3 in
   * the 0.60–0.72 band. The UI must render an "approximate location" affordance rather than a
   * fabricated confidence number.
   */
  readonly approximate: boolean;
}
