/*
DO NOT EDIT — generated from schema/paperir-1.0.0.schema.json by codegen/generate.ts.

Regenerate with `pnpm --filter @papertree/document-ir codegen`. Hand edits are deleted by
the next run and are caught before that by test/codegen-drift.spec.ts. The JSON Schema is the
single source of truth (DESIGN.md §1); TypeScript is one of its bindings, never a second one.
*/

/**
 * Paper identity: "ppr_" + a 26-character Crockford base32 ULID (uppercase, no I/L/O/U). Time-ordered, so paper ids sort by ingest time.
 *
 * A paper_id is minted ONCE per source_hash and is then HELD FIXED across every re-parse of that PDF (re-parses vary only `generation`). This is required by two things at once: ADR-001's generation model, and the milestone criterion "re-parsing produces byte-identical PaperIR" — a freshly minted ULID per parse would falsify it by construction. See DESIGN.md §7 for the exact definition of byte-identity.
 */
export type PaperId = string;

/** A SHA-256 digest, algorithm-prefixed and lowercase hex, e.g. "sha256:9f2c...". */
export type Sha256Hash = string;

/**
 * A digest carrying its own algorithm prefix, e.g. "blake2s:3f9a..." or "sha256:...". The prefix is mandatory so that changing the hash function is a visible, migratable event rather than a silent reinterpretation of existing bytes. The hex body is bounded to 16-128 characters (64-512 bits) so that a one-digit string like "x:0" cannot pose as a digest.
 */
export type AlgoPrefixedHash = string;

/**
 * Exactly which software produced this generation. Required so that a re-parse is reproducible, so a regression can be attributed, and so parser choice stays a swappable implementation detail behind an adapter.
 */
export interface ParserInfo {
  /** Parser/adapter name, e.g. "pdfium-deterministic" or "docling". */
  name: string;
  /** Parser version string, e.g. "2.14.0". */
  version: string;
  /**
   * Digest of the full effective parser configuration. Two generations with the same source_hash, name, version and config_hash must be byte-identical; this is what makes the "re-parsing is a no-op" acceptance criterion checkable.
   */
  config_hash: AlgoPrefixedHash;
  /**
   * Optional named preset, e.g. "born-digital-fast" or "scanned-ocr". Absent when no preset was used.
   */
  profile?: string;
  /**
   * RFC 3339 timestamp of when this generation was produced.
   *
   * THIS FIELD IS EXCLUDED FROM THE DETERMINISM COMPARISON. "Re-parsing produces byte-identical PaperIR" (research/build/README.md definition-of-done #1, worker/determinism.spec) is defined as byte-identity of the canonical JSON serialisation AFTER REMOVING parser.parsed_at — it is a wall-clock reading and no two parses can agree on it. Everything else must match exactly, and paper_id is held fixed per source_hash so it is not a source of nondeterminism either. See DESIGN.md §7.1 for the full definition; Epic 1 must not read the criterion literally and conclude it is unachievable.
   */
  parsed_at: string;
}

/**
 * Lifecycle of this parse generation. "partial" is a FIRST-CLASS STATE, not an error: a reader can open the paper while pages 12-14 are still in vision repair. This is the direct replacement for a pipeline that blocked an HTTP request for up to 450 s (findings.md C1).
 *
 * ADR-001 also lists "pending" and "parsing". THEY ARE DELIBERATELY ABSENT HERE. A PaperIR document requires a fully-populated ParserInfo (including config_hash and parsed_at) and a DocumentConfidence; at upload time none of those exist, so a "pending" PaperIR document could only be produced by fabricating them — which is precisely the failure class this schema exists to prevent (findings.md: title = the uploaded filename). pending/parsing are JOB states: they live in the `papers` and `jobs` tables in packages/db, and the first PaperIR document for a generation is written when there is something real to write.
 */
export type PaperStatus = "partial" | "complete" | "failed";

/**
 * Block identity: "blk_" + 16 characters of lowercase RFC 4648 base32 (80 bits).
 *
 * Block ids are CONTENT-DERIVED, not positional and not random: a digest over the paper's source_hash, page index, quantised top-left anchor, block type and a normalised text prefix. Same PDF + same parser => same ids, so re-parsing is a no-op and a highlight anchored to a block survives it. Only the STRING SHAPE is frozen by this schema, and only the string shape is anything a consumer may depend on.
 *
 * The derivation is settled by ADR-001 Amendment 1 (2026-07-30, resolved by measurement): SHA-256 over source_hash | page_index | q(x0) | q(y0) | block_type | normalise(text)[:8], quantiser q(v) = floor(v/1.0 + 0.5) emitted as an integer bucket index on a 1.0 pt grid, ANCHOR geometry only (x1/y1 deliberately not hashed), RFC 4648 base32 LOWERCASED and truncated to 16 characters. The 427 normative conformance vectors live at conformance/identity-vectors.json and every one of them validates against the pattern above.
 *
 * Ids are mostly-stable, not perfectly stable, and the measurement quantified how far from perfect: 42.2% of ids do not survive a paragraph-merge segmentation change, and because only the top-left anchor is hashed, 11.7% of the ids that DO survive land on a block whose text has changed. Block.content_hash detects 100% of those (measured, not assumed). That is why block ids are only tier 1 of anchoring, why the multi-selector anchor (ADR-004) is mandatory, and why a tier-1 hit MUST be confirmed against content_hash before it is trusted.
 */
export type BlockId = string;

/**
 * A confidence in [0, 1]. Uncertainty is represented explicitly everywhere it exists: the product must be able to say "we are not sure about this equation" instead of confidently rendering garbage. 1.0 is a legitimate value for facts read directly out of a born-digital text layer.
 */
export type Confidence = number;

/**
 * A metadata STRING together with the block it was read from and how sure we are. Never a bare string.
 *
 * source_block_id is REQUIRED, so a metadata value that cannot point at a real block is unrepresentable. This is the schema-level answer to findings.md: the live system sets title = os.path.splitext(file.filename)[0] — the uploaded filename — and there is nowhere in PaperIR to put a value with no source.
 */
export interface MetadataValue {
  /**
   * The value, as read from the source block. It must be EXTRACTED OR TRANSCRIBED from that block, never composed, cleaned up or reworded: semantic rule 6b requires the normalised value to be a substring of the normalised text of source_block_id. Requiring the citation alone was not enough — a pipeline that reads a real title block and then asks a model to "tidy" the title produces a valid document with a plausible source_block_id attached.
   */
  value: string;
  /**
   * The block this value was read from. Must resolve to a block in Paper.blocks (semantic validator).
   */
  source_block_id: BlockId;
  confidence: Confidence;
}

/**
 * The abstract is not copied into metadata — it is a POINTER at the blocks that are the abstract. Copying would create a second representation that drifts from the first, which is the failure mode this whole rewrite exists to remove.
 */
export interface AbstractRef {
  /** The blocks constituting the abstract, in reading order. */
  block_ids: [BlockId, ...BlockId[]];
  confidence: Confidence;
}

/**
 * A metadata INTEGER (publication year) with the same provenance requirement as MetadataValue: value, source_block_id, confidence.
 */
export interface MetadataYear {
  /** The year, as read from the source block. */
  value: number;
  source_block_id: BlockId;
  confidence: Confidence;
}

/**
 * Document-level bibliographic metadata. EVERY field is either a provenance-carrying value object or explicitly null: all keys are required so that "we looked and found nothing" is stated rather than silently omitted, and so there is exactly one encoding of absence.
 */
export interface Metadata {
  /** The paper's title, read from a block of type "title". Null if no title block was identified. */
  title: MetadataValue | null;
  /**
   * One entry per author, each read from a source block. Empty when no author block was identified.
   */
  authors: MetadataValue[];
  /** Pointer at the abstract blocks. Null if no abstract was identified. */
  abstract: AbstractRef | null;
  /**
   * DOI as printed in the paper, with its source block. Null if not found. A DOI resolved from an external service is NOT a PaperIR fact — it has no source block — and belongs outside this document.
   */
  doi: MetadataValue | null;
  /**
   * arXiv identifier as printed in the paper (usually the margin stamp), with its source block. Null if not found.
   */
  arxiv_id: MetadataValue | null;
  /** Publication venue as printed in the paper, with its source block. Null if not found. */
  venue: MetadataValue | null;
  /** Publication year as printed in the paper, with its source block. Null if not found. */
  year: MetadataYear | null;
}

/** Page identity: "pg_" + 16 characters of lowercase RFC 4648 base32. */
export type PageId = string;

/**
 * An axis-aligned bounding box [x0, y0, x1, y1] in PDF user space, origin top-left, with x0 <= x1 and y0 <= y1. Wherever a bbox accompanies a polygon it is a DERIVED CONVENIENCE and must equal the polygon's extent exactly; JSON Schema cannot express that, so it is enforced by the semantic validator (see DESIGN.md §Semantic validator).
 */
export type BBox = [number, number, number, number];

/**
 * A pointer to a rendered raster of a region of the source, held in object storage. The image is GROUND TRUTH: for equations and figures it is retained even when LaTeX or vector extraction succeeds, because the LaTeX is an interpretation and the crop is the paper. When latex_confidence is low the UI shows the crop and offers the LaTeX as "our reading".
 */
export interface ImageRef {
  /**
   * Opaque storage URI with an explicit scheme, e.g. "r2://papers/ppr_.../pages/000@2x.webp". The scheme pattern is load-bearing: it rejects "data:" and every other inline scheme, so PaperIR provably never embeds pixel bytes. Resolution is the storage layer's business.
   */
  uri: string;
  /**
   * Render scale relative to PDF user space, e.g. 2.0 for a 2x raster. Needed to map image pixels back to points.
   */
  scale?: number;
  /** Effective dots per inch of the render. */
  dpi?: number;
  /**
   * What was rasterised: an embedded raster image, vector drawing operations, or a crop of the rendered page.
   */
  rendered_from?: "raster" | "vector" | "page";
}

/**
 * The page's TOP-LEVEL blocks partitioned into independent reading orders, one array per Flow value, each in ascending Block.order. All six keys are required (an empty array means "this page has no top-level blocks in that flow") so consumers never have to distinguish absent from empty.
 *
 * NESTED blocks — those whose parent_id names a block that is NOT a heading (see $defs/KnownHeadingBlockType) — are DELIBERATELY NOT LISTED HERE. They appear in Page.block_ids and are reached through their container's child_ids. This is what keeps Docling's 342 cells on a single ResNet table out of the body reading order: without it, "read the document" would mean reading a table cell by cell, and every consumer of doc_order (Guided view, TTS, get_adjacent_blocks) would inherit that. See DESIGN.md §4 D14.
 *
 * Every id listed here must belong to a top-level block whose page_index is this page's index and whose flow is the corresponding key (semantic validator rule 11).
 */
export interface Flows {
  /** The main prose/float stream. */
  body: BlockId[];
  /** Figure and table captions. */
  caption: BlockId[];
  /** Footnotes, in their own order. */
  footnote: BlockId[];
  /** Running heads. */
  header: BlockId[];
  /** Running feet and page numbers. */
  footer: BlockId[];
  /** Margin notes and publisher stamps (e.g. the arXiv margin stamp). */
  margin: BlockId[];
}

/**
 * One page of the PDF, carrying every fact needed to place blocks on it and to render it at any zoom without re-consulting the PDF.
 */
export interface Page {
  page_id: PageId;
  /**
   * 0-based page index. Unique within the document (semantic validator). Note that page boundaries are NOT semantic section boundaries — an outline keyed on page index is the anti-requirement recorded in findings.md C3.
   */
  index: number;
  /**
   * Page width in points, POST-rotation — i.e. the width of the space the polygons live in. Must equal crop_box[2] - crop_box[0] (semantic validator rule G4); that identity is the cheapest available coordinate-space sanity check.
   */
  width: number;
  /** Page height in points, POST-rotation. Must equal crop_box[3] - crop_box[1] (rule G4). */
  height: number;
  /**
   * The page's /Rotate value, recorded for auditability. It has ALREADY been applied to width, height and every polygon on this page; a consumer must not apply it again.
   */
  rotation: 0 | 90 | 180 | 270;
  /**
   * The PDF /UserUnit. Recorded because a page with user_unit != 1 scales points to physical size, and the geometry library must round-trip it. Bounded so that 0, a negative, a denormal and Infinity are all rejected.
   */
  user_unit: number;
  /**
   * The page's CropBox expressed in THIS DOCUMENT'S coordinate space — normalised, top-left origin, post-rotation — not as the raw PDF array. RESOLVED CONVENTION (ADR-001 implies it; this schema states it): block geometry is expressed relative to the CropBox origin, therefore crop_box is ALWAYS [0, 0, page.width, page.height]. Semantic validator rule G4 enforces exactly that, which is what turns "we normalised the geometry" from a claim into a check. Getting this wrong silently offsets every polygon on the (common) pages where CropBox != MediaBox, so F0.4's geometry library must encode it and geometry.spec must cover CropBox != MediaBox.
   */
  crop_box: BBox;
  /**
   * The page's MediaBox in the same normalised, top-left, post-rotation space as crop_box. Because geometry is CropBox-relative, media_box coordinates are frequently NEGATIVE (the media box extends above/left of the crop box) and that is correct, not an error. Retained because CropBox != MediaBox is common and the transform must be reproducible.
   */
  media_box: BBox;
  /**
   * A rendered raster of the whole page, or null if none has been produced yet. Required-and-nullable so "not rendered yet" is explicit.
   */
  image: ImageRef | null;
  /** Whether the page carries an extractable text layer. */
  has_text_layer: boolean;
  /**
   * Whether the page is a scanned image requiring OCR. Distinct from has_text_layer: a scan may carry a bad OCR text layer already.
   */
  is_scanned: boolean;
  /**
   * EVERY block on this page, regardless of flow and including nested blocks (table cells, list items). Must exactly match the set of blocks whose page_index equals this page's index (semantic validator rule 10).
   */
  block_ids: BlockId[];
  flows: Flows;
  /** Confidence in this page's extraction as a whole. */
  confidence: Confidence;
}

/**
 * An [x, y] point in PDF user space (points), origin top-left. Both coordinates are bounded to ±20000 pt (≈278 inches, far beyond any real page) so that a JSON literal such as 1e400 — which parses to Infinity, satisfies exclusiveMinimum:0, and then re-serialises as null — cannot enter the document. A value that validates must survive a serialisation round-trip; that is a precondition of "re-parsing produces byte-identical PaperIR".
 */
export type Point = [number, number];

/**
 * A region as a polygon in PDF user space, origin top-left. Minimum 3 vertices, maximum 512; NOT closed — do not repeat the first point. Polygons rather than rectangles because a text selection spanning lines in a two-column layout is not a rectangle, and flattening it to a bounding box is exactly what makes highlights bleed across columns. Positive area and a non-self-intersecting ring are semantic-validator rules (G5/G6): JSON Schema can bound the vertex count but not the shape.
 */
export type Polygon = Point[];

/**
 * Which independent reading order a block belongs to. CLOSED vocabulary, deliberately: unlike block/relation types, adding a flow changes what "read the document" means for every consumer and is a breaking change.
 *
 * Footnotes, captions and page furniture get their own orders rather than being spliced into the body stream (ADR-001 Commitment 3, after PDF-to-Tree). This is what lets the reader run the body continuously while still knowing exactly where footnote 3 sits on the page, and what keeps running heads and arXiv margin stamps out of the prose — the failure measured in findings.md B6.
 */
export type Flow = "body" | "caption" | "footnote" | "header" | "footer" | "margin";

/**
 * Character-level geometry inside a block's text: the unit a highlight snaps to. A span maps a half-open character range [start, end) of Block.text onto a box on the page, so a selection of part of a paragraph has real coordinates instead of viewport pixels.
 *
 * OFFSETS INDEX Block.text AS STORED — that is, POST-APPLIED-REPAIR. So does Repair.at. Exactly one string is addressable in this schema and every offset in it means the same thing; the alternative (spans measured against the raw glyph stream, repairs against a different one) drifts every tier-1 anchor after offset 0 by the cumulative length delta of the applied repairs, and the drift is invisible until a highlight lands a word off.
 */
export interface Span {
  /**
   * Inclusive start offset into Block.text as stored (post-applied-repair), in Unicode code points.
   */
  start: number;
  /**
   * Exclusive end offset into Block.text. Must satisfy start < end <= len(text), and spans must not overlap (semantic validator).
   */
  end: number;
  /** The box covering this character range. */
  bbox: BBox;
  /**
   * What this character range IS, when it is not ordinary prose: "inline_equation", "citation", "footnote_marker", "code", .... An OPEN vocabulary, like Block.type. Absent means ordinary text.
   *
   * This exists because inline math and inline citation markers are the majority of real math and the unit resolve_citation needs, and the only alternatives were both failures already measured: fragment the paragraph into three blocks (the shredding of findings.md B1 — Neural ODEs' median text block was 59 characters), or lose the location entirely.
   */
  role?: string;
  /**
   * The block this span corresponds to, when the span's role names a construct that is ALSO a block — e.g. an inline_equation span pointing at the inline_equation block that carries the LaTeX and the crop. Absent otherwise. This is how "this inline equation occupies characters 45-58 of paragraph X" becomes expressible without fragmenting X.
   */
  block_id?: BlockId;
  /**
   * Font name as recorded in the PDF, e.g. "NimbusRomNo9L-Regu". Absent when unknown. Retained for evidence, NOT as a classifier: font-driven math detection is what made 36.9% of ResNet's blocks false-positive math (findings.md B1).
   */
  font?: string;
  /** Font size in points. Absent when unknown. */
  size?: number;
}

/**
 * How this block's content was obtained from the PDF. CLOSED vocabulary with NO model/LLM value, and that absence is the point: the line is TRANSCRIPTION vs GENERATION. "ocr" transcribes a region of the source and is legitimate; an LLM generating prose is not, and has no value it could be recorded under. Combined with "additionalProperties": false everywhere, this makes AI-authored source text unrepresentable rather than merely discouraged.
 *
 * - pdf_text_layer: characters read from the PDF's own text layer.
 * - pdf_vector: derived from vector drawing operations (the property the previous extractor was blind to — findings.md B3: every ResNet figure is a vector drawing and zero were extracted).
 * - pdf_raster: derived from an embedded raster image.
 * - ocr: transcribed from a rendered region by an OCR engine.
 *
 * A model's READING of a region is not a source; it is a proposed Repair (see $defs/Repair) or an Alternative, stored alongside the original and never in place of it.
 */
export type SourceKind = "pdf_text_layer" | "pdf_vector" | "pdf_raster" | "ocr";

/**
 * Which component of the pipeline produced this block, and what it called the block itself. Kept so that a bad block can be attributed to a stage, and so a parser upgrade can be diffed stage by stage.
 */
export interface Provenance {
  /**
   * The component that emitted this block, e.g. "pdfium-deterministic", "docling", "tatr". May differ from Paper.parser.name when a specialist model handled a flagged region.
   */
  parser: string;
  /** The pipeline stage, e.g. "layout+text", "table-structure", "formula-recognition". */
  stage: string;
  /**
   * The upstream tool's own identifier for this object, e.g. Docling's "#/texts/47". Recorded for debugging and for adapter round-tripping ONLY. It is deliberately NOT PaperTree's identity: positional pointers break on every re-parse, which is the concrete reason PaperIR mints its own content-derived ids.
   */
  native_id?: string;
}

/**
 * The kind of modification a Repair records.
 *
 * DETERMINISTIC (may be applied): dehyphenate, ligature, unicode_normalise, whitespace, reorder. These are rule-based, reproducible and reviewable.
 *
 * MODEL-AUTHORED (must NOT be applied): ocr_correction, vlm_substitution. A model's reading of a region is a PROPOSAL. Block.text keeps the original; the proposal sits in Repair.to and the UI can offer "this region was reconstructed" without ever silently replacing the paper.
 */
export type RepairKind = "dehyphenate" | "ligature" | "unicode_normalise" | "whitespace" | "reorder" | "ocr_correction" | "vlm_substitution";

/**
 * One recorded modification of source text — never a silent fix. The original always survives in "from".
 *
 * This exists because the previous code failed the rule twice: _clean_text rewrote U+2212 MINUS SIGN to an ASCII hyphen in the same table as ligature repair (destroying mathematical content, findings.md B7), and the LLM path silently discarded the middle of any page over 5,000 characters (C6). Both would now have to be expressed as a Repair or not happen at all.
 *
 * Repairs are split into APPLIED and PROPOSED by the required "applied" flag. When applied is true, Block.text already contains "to" and "from" preserves what was replaced. When applied is false, Block.text still contains "from" and "to" is only a proposal awaiting acceptance.
 *
 * TWO if/then branches, mirror images of each other, carry the safety property:
 * • A MODEL-AUTHORED kind (ocr_correction, vlm_substitution) must have applied:false and MUST name its model_id and prompt_hash. This is ADR-001's "the LLM never overwrites source; it proposes a repair that is stored alongside the original ... the model and prompt hash are recorded", in full, as a schema constraint.
 * • A DETERMINISTIC kind (dehyphenate, ligature, unicode_normalise, whitespace, reorder) MAY be applied and MUST NOT carry model_id or prompt_hash. Without this branch, {kind:"dehyphenate", applied:true, model_id:"gpt-4o", to:"<model prose>"} validates — an openly model-stamped rewrite of source, through a category whose entire justification is that it is rule-based and reproducible. Semantic rule 30b closes the remaining half by checking that from→to is actually an edit of the declared class.
 */
export interface Repair {
  kind: RepairKind;
  /**
   * Whether this repair has been applied to Block.text. Forced to false for model-authored kinds (see the if/then below).
   */
  applied: boolean;
  /**
   * Character offset into Block.text AS STORED at which this repair sits: for applied:true, the offset at which "to" now appears; for applied:false, the offset at which "from" still appears. Absent for repairs with no single offset, e.g. reorder. Offsets in this schema index exactly one string — see $defs/Span.
   */
  at?: number;
  /**
   * The original source text. This field is the whole point of the mechanism: it is never overwritten, and an empty string is a legitimate value (a pure insertion).
   */
  from: string;
  /**
   * The repaired or proposed replacement text. An empty string is a legitimate value (a pure deletion).
   */
  to: string;
  /**
   * Identifier of the model that proposed this repair. REQUIRED for ocr_correction and vlm_substitution and FORBIDDEN for deterministic kinds (see the if/then branches below).
   */
  model_id?: string;
  /**
   * Digest of the exact prompt that produced the proposal, so it is reproducible and auditable. Required for model-authored kinds, forbidden for deterministic ones.
   */
  prompt_hash?: AlgoPrefixedHash;
  /** How sure the proposer is. Absent for deterministic kinds, which are certain by construction. */
  confidence?: Confidence;
}

/**
 * A competing reading of the same block from a different parser, retained WITH the rule that decided between them. When two parsers disagree, both survive and the decision is auditable rather than lost.
 *
 * An Alternative is EVIDENCE, never content. `authored_by` is required and a model-authored alternative is pinned to decision:"not_selected" — the exact mirror of Repair's applied:false constraint, and for the same reason. Without it, a block could carry text:"<model prose>" with a selected alternative from "openai/gpt-4o" saying the same thing, and every check would pass: the semantic rule that a selected alternative's text equals block.text is satisfied BECAUSE the model's reading is what the reader sees. That was the last channel through which model text could sit inside a Paper without an explicit "this is not what you are reading" flag next to it.
 */
export interface Alternative {
  /** The parser or repair stage that produced this reading, e.g. "docling", "vlm-repair". */
  parser: string;
  /**
   * Whether this reading came from a deterministic parser or from a model. CLOSED, with no third option. "model" forces decision:"not_selected" (see the if/then below): a model may argue about what a region says, and its argument is kept, but it may never BE the reading the reader sees.
   */
  authored_by: "parser" | "model";
  /**
   * This parser's reading of the block's text. Absent when the disagreement is not about text. For a selected alternative this must equal Block.text (semantic rule 31); for a model-authored one it is by construction not selected, so it is never what renders.
   */
  text?: string;
  confidence: Confidence;
  /** Whether this reading won. Exactly one alternative may be "selected" (semantic validator). */
  decision: "selected" | "not_selected";
  /**
   * The named reconciliation rule that produced the decision, e.g. "prefer_native_text_when_delta<0.2". Recording the rule is what makes the choice reviewable instead of a black box.
   */
  rule?: string;
}

/**
 * A symbol occurring in an equation, linked to the block that defines it. definition_block is REQUIRED: a symbol whose definition cannot be pointed at a real block is unrepresentable, mirroring the rule for metadata values. Note that a natural-language GLOSS of a symbol is model-authored explanation and belongs in a Derivation, not here (see DESIGN.md §Deviations).
 */
export interface EquationSymbol {
  /** The symbol as it appears, e.g. "\\mathcal{F}". */
  symbol: string;
  /** The block in which this symbol is defined. */
  definition_block: BlockId;
}

/**
 * Block.payload for type "equation" AND type "inline_equation". The rendered crop is the ground truth; latex and mathml are interpretations of it, each with their own confidence. The crop is required-and-nullable so that "detected but not yet rendered" is statable, and so an inline equation that has not been cropped is expressible.
 */
export interface EquationPayload {
  /**
   * True for display (set-off) math, false for math typeset inline. Must be false when the block's type is "inline_equation" (semantic rule 39). The distinction matters because inline math is a genuinely unsolved recognition problem and is the majority of real math, while display math is largely solved — a consumer must be able to tell which regime a result came from.
   */
  display: boolean;
  /**
   * The equation number as printed, e.g. "3". A string, not an integer: papers number equations "A.2", "3a", "(iv)".
   */
  equation_number?: string;
  /**
   * The recognised LaTeX. An INTERPRETATION of the image, never a replacement for it. Absent when recognition was not attempted or produced nothing.
   */
  latex?: string;
  /**
   * Confidence in the LaTeX specifically, held separately from the block's confidence because the region can be certain while its reading is not. When this is low the UI shows the crop and labels the LaTeX "our reading".
   */
  latex_confidence?: Confidence;
  /** MathML rendering, for the audiobook's speech-rule engine. Also an interpretation. */
  mathml?: string;
  /**
   * The rendered source region, or NULL if it has not been produced yet. REQUIRED-AND-NULLABLE, mirroring Page.image, because parsing is a durable multi-step job: detecting the region and rendering the crop are different steps, and between them the region exists but the raster does not. A non-nullable image would leave an adapter three moves — invent a URI, drop the region, or emit it as "unknown" — all of which destroy the fact that was correctly extracted. Semantic rule 36 requires it non-null when Paper.status is "complete", which is where ADR-001's "always retained" actually bites.
   */
  image: ImageRef | null;
  /**
   * Symbols linked to their defining blocks. Omitted entirely when empty — an empty array is not a valid encoding, so there is exactly one way to say "none".
   */
  symbols?: [EquationSymbol, ...EquationSymbol[]];
  /**
   * Blocks that refer to this equation. A denormalised convenience over the inverse of the "references" relation; the relations array is authoritative.
   */
  referenced_by?: [BlockId, ...BlockId[]];
}

/**
 * A labelled sub-panel of a multi-part figure, e.g. "(a)", so a citation can point at a panel rather than the whole figure. A panel label is transcribed text, so it carries the same required `source` and `confidence` as DetectedLabel.
 */
export interface FigurePanel {
  /** The panel label as printed, e.g. "(a)". */
  label: string;
  /** The panel's region. */
  polygon: Polygon;
  /** How the panel label was obtained. */
  source: SourceKind;
  confidence: Confidence;
}

/**
 * Text found INSIDE a figure, e.g. "conv 3x3" on an architecture diagram, with its own geometry. Kept separate from blocks so that diagram interior text is searchable without being promoted into the reading order — promoting it is exactly how the previous extractor produced headings like "T[SEP]" and "BUFFER" (findings.md B6).
 *
 * `source` and `confidence` are REQUIRED for the same reason they are required on a Block: reading text off a VECTOR diagram is precisely the job that gets handed to a VLM, and a required-minLength string with no source field would be a transcription surface exempt from the rule the rest of the page obeys. SourceKind has no model value here either.
 */
export interface DetectedLabel {
  /** The label text, transcribed from the source. */
  text: string;
  /** The label's region. */
  polygon: Polygon;
  /** How this label was obtained. Same closed transcription vocabulary as Block.source. */
  source: SourceKind;
  confidence: Confidence;
}

/**
 * Block.payload for type "figure". The rendered crop is the ground truth for a figure exactly as it is for an equation, and is required-and-nullable for the same reason.
 */
export interface FigurePayload {
  /** The figure number as printed, e.g. "2". A string for the same reason as equation_number. */
  figure_number?: string;
  /**
   * Free-form sub-classification of the figure, e.g. "diagram", "plot", "photo", "schematic". Open on purpose: it is a hint for the UI, not a contract.
   */
  figure_kind?: string;
  /**
   * Whether the figure CONTAINS VECTOR DRAWING OPERATIONS. REQUIRED because this is precisely the property the previous extractor was blind to: it called page.get_images() only, so every ResNet figure — all vector — was invisible and 0 of 4 figures were extracted (findings.md B3).
   *
   * Deliberately NOT synchronised with Block.source. `source` names the DOMINANT extraction path; `is_vector` names a property of the figure's content. A matplotlib plot with an embedded raster inside vector axes is common and has an honest answer for both (source: pdf_raster or pdf_vector by dominance, is_vector: true), which a consistency rule between them would have made unrepresentable.
   */
  is_vector: boolean;
  /**
   * The rendered source region, or NULL if it has not been produced yet. REQUIRED-AND-NULLABLE, mirroring Page.image, because parsing is a durable multi-step job: detecting the region and rendering the crop are different steps, and between them the region exists but the raster does not. A non-nullable image would leave an adapter three moves — invent a URI, drop the region, or emit it as "unknown" — all of which destroy the fact that was correctly extracted. Semantic rule 36 requires it non-null when Paper.status is "complete", which is where ADR-001's "always retained" actually bites.
   */
  image: ImageRef | null;
  /**
   * The caption block for this figure. Must reference a block of type "caption" (semantic validator). Denormalised inverse of the caption_of relation, which remains authoritative.
   */
  caption_block?: BlockId;
  /** Sub-panels, when the figure has them. Omitted when there are none. */
  panels?: [FigurePanel, ...FigurePanel[]];
  /** Text found inside the figure. Omitted when there is none. */
  detected_labels?: [DetectedLabel, ...DetectedLabel[]];
  /** Blocks that refer to this figure. Denormalised convenience; relations are authoritative. */
  referenced_by?: [BlockId, ...BlockId[]];
}

/**
 * One cell of a table's grid. Every cell is ALSO a block (of type table_cell) so it can be highlighted and cited like anything else; this entry adds the grid coordinates a block cannot carry.
 */
export interface TableCell {
  /** The table_cell block for this cell. */
  cell_id: BlockId;
  /** 0-based row index of the cell's top-left corner. */
  r: number;
  /** 0-based column index of the cell's top-left corner. */
  c: number;
  /** Rows spanned. Absent means 1. */
  rowspan?: number;
  /** Columns spanned. Absent means 1. */
  colspan?: number;
  /** The cell's region. */
  polygon: Polygon;
  /**
   * The cell's text. Denormalised from the cell block for cheap grid rendering; must equal that block's text (semantic validator).
   */
  text?: string;
  /** Whether this cell is a header cell. Absent means false. */
  is_header?: boolean;
}

/**
 * The logical grid recovered from a table, alongside (never instead of) the geometry of its cells.
 */
export interface TableGrid {
  /** Number of logical rows. */
  rows: number;
  /** Number of logical columns. */
  cols: number;
  /** Every cell, in row-major order. */
  cells: TableCell[];
}

/**
 * Block.payload for type "table". The grid is required; the HTML serialisation is a convenience for rendering and for feeding a model, never the canonical form.
 */
export interface TablePayload {
  /** The table number as printed, e.g. "1". */
  table_number?: string;
  /**
   * The caption block for this table. Must reference a block of type "caption" (semantic validator).
   */
  caption_block?: BlockId;
  grid: TableGrid;
  /**
   * An HTML serialisation of the grid, for rendering and for LLM input. DERIVED: it must be the library's deterministic serialisation of `grid` (semantic rule 32b), not an independent rendering. A derived field nobody checks is a second representation that drifts, which is the failure this rewrite exists to remove.
   */
  html?: string;
}

/**
 * A recursive constraint: no object ANYWHERE in this value's subtree may declare model authorship. Applied to Block.payload for block types this schema does not know, which is the one place in PaperIR where an open object shape is required for forward compatibility.
 *
 * Without it, `blocks[i].payload` was the single object in the file with no "additionalProperties": false, and a complete Derivation — or a bare {"generated_by": "gpt-4"} — fitted inside it whole, one level below the block that rejects exactly those fields. That falsified the field-closure property the whole design rests on.
 *
 * This blocks the SHAPE of a declared derivation, not prose. A payload string containing model output is still expressible — see the schema-level description on undeclarable-vs-undetectable.
 *
 * TypeScript cannot express "no object anywhere in this subtree carries key X", so this
 * constraint has no type — it is the runtime guard `assertModelFree()` in ./zod.js
 * (DESIGN.md §6).
 */
export type ModelFreeSubtree = unknown;

/**
 * Block.payload for any block type this schema version does not know. OPEN IN SHAPE — that is the forward-compatibility requirement: a block type added in 1.1.0 must be able to carry its own data without a major bump — but CLOSED against authorship declarations at any depth (see $defs/ModelFreeSubtree) and restricted to identifier-shaped keys.
 */
export type OpaquePayload = { readonly [key: string]: unknown };

/**
 * The addressable unit of a document: a region of a page with geometry, identity, provenance and uncertainty. Everything downstream — highlights, citations, retrieval, narration, canvas nodes — anchors to a block.
 *
 * NOTE ON SHAPE (deliberate deviation from ADR-001's JSONC sketches): specialised fields for equations, figures and tables live in the nested "payload" object rather than being hoisted onto the block. With "additionalProperties": false, hoisting would force this base definition to enumerate every specialised field of every type and would break cleanly for unknown types. The nested payload also maps 1:1 onto the blocks.payload column in the physical model. See DESIGN.md §4 D1.
 *
 * REQUIRED SET: only what every block must have — identity, type, page, geometry, flow, order, source, confidence, provenance. In particular "text" is OPTIONAL, so an "unknown" block with geometry and no text is no harder to express than a classified one. That is the point: a parser that cannot classify a region must be able to emit it rather than drop it.
 *
 * NESTING: a block whose parent_id names a NON-HEADING block (see $defs/KnownHeadingBlockType) is NESTED — it ranks by `order` inside its container, has no `doc_order`, and is not listed in Page.flows. A block whose parent_id names a heading is SECTION content and stays top-level.
 */
export interface BlockBase {
  block_id: BlockId;
  /**
   * 0-based index of the page this block sits on. Must match a Page.index, and that page's block_ids must contain this block (semantic validator).
   */
  page_index: number;
  /**
   * REQUIRED on every block, including "unknown" ones. Geometry is never discarded: this is the single fact whose absence blocks every downstream feature (findings.md §A — the live pipeline produced 99,210 characters and zero addressable objects).
   */
  polygon: Polygon;
  /**
   * Axis-aligned extent of "polygon", stored for cheap indexing and hit-testing. Must EQUAL the polygon's extent; JSON Schema cannot express that relationship, so it is enforced by the semantic validator and a test.
   */
  bbox: BBox;
  flow: Flow;
  /**
   * Rank of this block among its SIBLINGS in reading order. Dense and unique within (page_index, flow, container) — where `container` is the block's nesting parent (a non-heading parent_id), or the page's top level when it has none (semantic validator rule 14). Ranking within the container rather than within the page is what lets a table's 342 cells be ordered without consuming 342 slots of the page's body order.
   */
  order: number;
  /**
   * Rank within the whole BODY flow, across pages — the sequence a continuous reader or an audiobook follows. Present on EXACTLY the top-level blocks whose flow is "body"; absent for captions, footnotes, furniture (which have their own flows) and for nested blocks such as table cells and list items (which are read as part of their container). Unique and dense across the document (semantic validator rule 15).
   */
  doc_order?: number;
  /**
   * Structural parent: the heading block that owns this paragraph (SECTION containment), or the container block that owns this cell/row/list item (NESTING — see $defs/KnownHeadingBlockType). Absent when the block is a root. Must agree with the parent_of relations (semantic validator rule 19).
   */
  parent_id?: BlockId;
  /**
   * Structural children, in order. Omitted entirely when there are none — an empty array is not a valid encoding, so "no children" has exactly one representation and re-parses stay byte-identical.
   */
  child_ids?: [BlockId, ...BlockId[]];
  /**
   * Previous SIBLING — the block sharing this block's parent_id and flow, one rank lower. Absent for the first sibling. Siblings only: a parent is never its child's prev/next, and a child is never its parent's next. (ADR-001's "left-child/right-sibling" phrasing is ambiguous here; this schema resolves it as sibling-only, with child_ids carrying descent.)
   */
  prev_id?: BlockId;
  /**
   * Next SIBLING in this block's flow, sharing the same parent_id. Absent for the last sibling. Must be mutually consistent with that block's prev_id (semantic validator rule 18). Siblings only — see prev_id.
   */
  next_id?: BlockId;
  /**
   * The block's text, exactly as obtained from the source named in "source", with any APPLIED repairs already present (every offset in this schema — Span.start/end, Repair.at — indexes this string). OPTIONAL: figures, unknown regions and many blocks legitimately have none, and requiring it would penalise exactly the unclassified regions this schema insists on keeping.
   *
   * This string is SOURCE. It is never composed, summarised, translated or completed by a model. Any change to it must be recorded as an entry in "repairs", and any model-proposed change must sit there unapplied. Consumers must read it through the library's resolvedText(block, {applyProposed}) helper rather than reimplementing repair application — see DESIGN.md §4 D4.
   */
  text?: string;
  /**
   * Case-, whitespace- and ligature-normalised form of "text", for search and for content-hash derivation. A derived index, never displayed.
   */
  text_normalised?: string;
  /**
   * Digest of the normalised text, e.g. "blake2s:3f9a...". Anchoring tier 2: when a block id changes across a parser upgrade, an anchor can still find its block by content. Semantic rule 37 requires it (and text_normalised) whenever text is present and source is "pdf_text_layer" — tier-2 anchoring cannot be optional on exactly the blocks anchors land on.
   */
  content_hash?: AlgoPrefixedHash;
  /**
   * Character-level geometry within "text", in ascending start order. Omitted when unavailable or when the block has no text.
   */
  spans?: [Span, ...Span[]];
  /**
   * REQUIRED on every block. See $defs/SourceKind: the enum is closed and contains no model or LLM value, which is what makes AI-authored text in a source field unrepresentable rather than merely discouraged.
   */
  source: SourceKind;
  /** Confidence in this block's extraction and classification. */
  confidence: Confidence;
  provenance: Provenance;
  /**
   * Every modification to source text, recorded rather than applied invisibly. Omitted when there are none.
   */
  repairs?: [Repair, ...Repair[]];
  /**
   * Competing readings from other parsers, with the rule that chose between them. Omitted unless parsers actually disagreed.
   */
  alternatives?: [Alternative, ...Alternative[]];
}

/**
 * The block's payload is selected by `type` (schema `allOf`/`if`/`then`). The final member is
 * the open branch: any other type — including one this version has never seen — carries at
 * most an OpaquePayload. TypeScript cannot subtract the known literals from `string`, so the
 * open member structurally overlaps the closed ones; the VALIDATOR is authoritative, and it
 * is generated from the same branches (see ./zod.js `BlockSchema`).
 */
export type Block =
  | (BlockBase & { type: "equation" | "inline_equation"; payload: EquationPayload })
  | (BlockBase & { type: "figure"; payload: FigurePayload })
  | (BlockBase & { type: "table"; payload: TablePayload })
  | (BlockBase & { type: string; payload?: OpaquePayload });

/**
 * A typed, directed, confidence-scored edge between two blocks. Relations are first-class rather than implied by array order, so hierarchy, captioning, citation and cross-page continuation can each be measured and repaired independently.
 *
 * Identity is the tuple (type, from, to) — matching the physical model's primary key — so a relation has no id of its own and cannot be duplicated.
 */
export interface Relation {
  /**
   * The relation type. ANY IDENTIFIER-SHAPED STRING VALIDATES (^[a-z][a-z0-9_]{0,63}$), for the same forward-compatibility reason as Block.type: adding a relation type is a minor bump and consumers must tolerate unknown ones. The known vocabulary is in $defs/KnownRelationType, for codegen and documentation only. A consumer that does not understand a relation type must preserve it and ignore it, never drop it.
   */
  type: RelationType;
  /** Source endpoint. Must resolve to a block in this document (semantic validator). */
  from: BlockId;
  /** Target endpoint. Must resolve to a block in this document (semantic validator). */
  to: BlockId;
  /**
   * How sure we are that this edge holds. Scored because relations like continues_on_next_page are inferred, and an inferred edge that cannot be doubted cannot be improved.
   */
  confidence: Confidence;
  /**
   * How this edge was derived, e.g. "geometric+numbering", "pdf-outline", "font-cluster". A free string describing the METHOD — note this is deliberately not the Provenance object used by Block, because a relation is produced by a rule rather than by a parsing stage.
   */
  provenance: string;
}

/**
 * One node of the document outline: a materialised view over heading blocks and parent_of relations.
 *
 * A Section has NO title field. Its title IS the text of its heading block, by construction, which makes an LLM-invented section title unrepresentable — the exact failure recorded in findings.md C3, where the "semantic outline" was one entry per PDF page named by the model. For the same reason a Section has no id of its own: it is identified by its heading block.
 *
 * FRONT MATTER IS SECTION-LESS, deliberately: title, authors, affiliations and the abstract precede the first heading and belong to no Section. Consumers of get_parent_section must handle null rather than discovering it at runtime.
 */
export interface Section {
  /**
   * The heading block that opens this section. This is the section's identity, and its text is the section's title. Must resolve to a block whose type is a HEADING TYPE — "heading" or "title" (semantic rule 21); a paper's title block legitimately opens the document's outermost section.
   */
  heading_block_id: BlockId;
  /**
   * Nesting depth, 1 for a top-level section. Must be consistent with parent_heading_block_id (semantic validator).
   */
  level: number;
  /** The heading block of the enclosing section. Absent for a top-level section. */
  parent_heading_block_id?: BlockId;
  /**
   * The blocks belonging to this section, EXCLUDING heading_block_id itself and excluding blocks belonging to nested sections. Ordered by doc_order where present, otherwise by (page_index, order) — which is how captions and footnotes, having no doc_order, still get a defined position in the section they sit in. May be empty for a heading with no content beneath it. No duplicates (semantic rule 38).
   */
  block_ids: BlockId[];
}

/**
 * One bibliography entry, parsed into fields. A materialised view over a reference_entry block.
 *
 * The verbatim text of the entry is NOT copied here: it lives in exactly one place, the reference_entry block, and duplicating it would create a second representation that drifts.
 *
 * EVERY FIELD BELOW IS EXTRACTED FROM THAT BLOCK'S TEXT — never fetched from an external service and never composed. A citation enriched from Crossref or Semantic Scholar is NOT a PaperIR fact, because it has no region of this PDF behind it. Semantic rule 35 enforces this by requiring every non-null scalar here to appear in the normalised text of reference_entry_block_id: one substring check per field, exactly checkable precisely because the verbatim entry is deliberately kept in one place. This is the schema's most likely real-world leak — bibliographic enrichment is a normal, well-intentioned feature that a future epic will want — so the rule is not optional.
 */
export interface Reference {
  /**
   * The reference_entry block this was parsed from. Identity of the reference; its text is the verbatim entry.
   */
  reference_entry_block_id: BlockId;
  /** Cited work's title, as printed in the entry. */
  title?: string;
  /** Cited authors, as printed. Omitted when none could be parsed. */
  authors?: [string, ...string[]];
  /** Publication year, as printed. */
  year?: number;
  /** Venue, as printed. */
  venue?: string;
  /** DOI, as printed in the entry. */
  doi?: string;
  /** arXiv identifier, as printed in the entry. */
  arxiv_id?: string;
  /** URL, as printed in the entry. */
  url?: string;
  /** Confidence in the field parse of this entry. */
  confidence: Confidence;
}

/**
 * Document-level uncertainty rollup, so the UI can route a reader to the weak pages and so a partial parse is actionable rather than merely incomplete. `overall` and each entry of `by_page` are REQUIRED-AND-NULLABLE: null means "no calibrated estimate exists", which is the honest value for a failed parse and for a page still queued for repair. Writing 0 there would be a fabricated measurement in the field the UI uses to decide whether to trust the document. Semantic rule 13b requires them non-null when status is "complete".
 */
export interface DocumentConfidence {
  /**
   * Aggregate confidence for the whole document, or null when no calibrated estimate exists (failed or still-incomplete parse).
   */
  overall: Confidence | null;
  /**
   * One entry per page, indexed by page index; null for a page with no calibrated estimate. Length must equal Paper.pages length (semantic validator rule 13).
   */
  by_page: (Confidence | null)[];
  /** Page indices worth surfacing for review, weakest first. */
  weakest_pages: number[];
  /** Whether a human or a repair pass should look at this document before it is trusted. */
  needs_review: boolean;
}

/**
 * The root object: ONE PARSE GENERATION of one PDF. Immutable once written — a re-parse produces a new generation alongside the old one (ADR-001 §Versioning and migration), it never mutates this one. The pair (paper_id, generation) is this document's identity and is the storage key in packages/db; anchors are migrated from generation N to N+1 and the new generation is promoted only at ≥99% re-anchor success, which is what makes promotion reversible.
 */
export interface Paper {
  /**
   * Semver of the IR contract this document conforms to. This schema file validates any 1.x document: a minor bump only adds block/relation types (which are open vocabularies) or optional fields, so 1.1.0 documents are deliberately accepted here. A 2.x document must NOT validate against this file — major means geometry semantics, id derivation or field removal changed, and requires a migration plus a full re-anchor pass.
   */
  ir_version: string;
  paper_id: PaperId;
  /**
   * SHA-256 of the PDF bytes. This is the content dedup key the product currently lacks (findings.md D5: two byte-identical PDFs stored twice), and it is an input to content-derived block ids, which is what ties an id to a specific document.
   */
  source_hash: Sha256Hash;
  /**
   * Which parse generation of this paper this document is. 1 for the first parse; a re-parse writes generation N+1 ALONGSIDE generation N rather than replacing it. Required because ADR-001's rollback plan is generation-based: without it two generations of the same PDF are unstorable (papers.source_hash would collide) and content-derived block ids — which are IDENTICAL for unchanged blocks across generations, that being their whole purpose — collide outright. Storage keys on (paper_id, generation); blocks on (paper_id, generation, block_id). WHICH generation is currently promoted is deliberately NOT recorded here: this document is immutable, and promotion is mutable state owned by packages/db.
   */
  generation: number;
  /**
   * The only coordinate space PaperIR admits: PDF user space (points), origin TOP-LEFT, normalised exactly once at parse time from the PDF's native bottom-left origin, with rotation, CropBox/MediaBox and user_unit already applied. Held as a const so that a document which has not been normalised is unrepresentable and the geometry commitment is machine-checkable rather than a comment. Viewport pixels and DOM-relative fractions are never stored — that is precisely the mistake that made existing highlights unrecoverable (findings.md, read/page.tsx:228).
   */
  coordinate_space: "pdf_user_space_topleft";
  parser: ParserInfo;
  status: PaperStatus;
  /**
   * Human-readable explanation when status is "partial" or "failed", e.g. "pages 12-14 low confidence, vision repair queued". Null otherwise. Required-and-nullable rather than optional so that "nothing to report" is stated once, in exactly one encoding.
   */
  partial_reason: string | null;
  metadata: Metadata;
  /** Every page of the PDF, in index order. May be empty only for a failed parse. */
  pages: Page[];
  /**
   * A FLAT array of every block in the document. Hierarchy is expressed by relations and by parent_id/child_ids, never by nesting — nesting would make a block's address positional, and positional addresses are exactly why Docling's self_ref (#/texts/47) fails the re-parse requirement. Nested content (table cells, list items) is in this array too, as ordinary blocks with a parent_id naming their container — so a cell can be highlighted and cited like anything else without being spliced into the body reading order.
   */
  blocks: Block[];
  /**
   * Typed, first-class, confidence-scored edges between blocks. Relations are explicit rather than implied by array order so that, for example, cross-page paragraph joining (continues_on_next_page) can be measured and repaired independently.
   */
  relations: Relation[];
  /**
   * A materialised view over blocks + parent_of relations, for outline rendering and structure-aware retrieval. Derived, never authoritative: if it disagrees with the blocks, the blocks win and the view is rebuilt.
   */
  sections: Section[];
  /**
   * A materialised view over the reference_entry blocks: the bibliography, parsed into fields. Derived, never authoritative.
   */
  references: Reference[];
  confidence: DocumentConfidence;
}

/**
 * The known block-type vocabulary from ADR-001, identical to the benchmark's gold vocabulary so that parser output and gold data compare directly.
 *
 * THIS DEFINITION IS NOT REFERENCED BY Block.type AND IS NOT A VALIDATION CONSTRAINT. It exists so codegen can emit a KnownBlockType union and an isKnownBlockType() guard, and so a human reading the schema knows what to expect. Block.type is any string: a v1 consumer MUST tolerate a type it has never seen (ADR-001 §Versioning: adding a block type is a MINOR bump, which requires that unknown types validate).
 *
 * "unknown" is mandatory and load-bearing. A parser that cannot classify a region emits "unknown" WITH GEOMETRY INTACT rather than dropping the region (PDF-to-Tree's connect_orphans discipline); the UI surfaces it as "unstructured region". Nothing in this schema makes an unknown block harder to express than a classified one — in particular, text is optional on every block.
 */
export const KNOWN_BLOCK_TYPES = [
  "title",
  "author",
  "affiliation",
  "abstract",
  "heading",
  "paragraph",
  "list",
  "list_item",
  "equation",
  "inline_equation",
  "figure",
  "diagram",
  "plot",
  "table",
  "table_row",
  "table_cell",
  "algorithm",
  "code",
  "caption",
  "footnote",
  "citation",
  "reference_entry",
  "header",
  "footer",
  "page_number",
  "margin_note",
  "annotation",
  "unknown",
] as const;

export type KnownBlockType = (typeof KNOWN_BLOCK_TYPES)[number];

export function isKnownBlockType(value: string): value is KnownBlockType {
  return (KNOWN_BLOCK_TYPES as readonly string[]).includes(value);
}

/**
 * The OPEN type: any identifier-shaped string validates, and a v1 consumer MUST tolerate a
 * type it has never seen (DESIGN.md D2). `(string & {})` keeps editor autocompletion on the
 * known values without narrowing the type to them.
 */
export type BlockType = KnownBlockType | (string & {});

/**
 * The block types that open a SECTION. NOT REFERENCED BY ANYTHING and not a validation constraint — it is the vocabulary the semantic validator and the reading-order rules key on, and codegen emits as an isHeadingBlockType() guard.
 *
 * It defines the single distinction the reading order depends on:
 * • SECTION CONTAINMENT — parent_id names a block of one of these types. The child is TOP-LEVEL: it keeps its doc_order and appears in Page.flows. A paragraph under a heading is this case.
 * • NESTING — parent_id names ANY OTHER type (table, table_row, list, figure, paragraph, or a type this version has never heard of). The child is NESTED: it ranks by `order` inside its parent, carries NO doc_order, and does NOT appear in Page.flows. A table cell, a list item and an inline_equation inside a paragraph are all this case.
 *
 * Stated as the complement of a two-value list rather than as a list of containers so that an UNKNOWN parent type nests by default — the safe direction, since splicing the children of an unrecognised container into the body stream is the damaging error.
 *
 * The distinction is load-bearing and measured: Docling emits 342 cells for one ResNet table (findings.md §H2). Without it those 342 blocks occupy 342 consecutive doc_order slots between two paragraphs, and doc_order is defined as "the sequence a continuous reader or an audiobook follows" — so Guided view and TTS would read the table cell by cell and get_adjacent_blocks on the preceding paragraph would return cells. Likewise an inline_equation inside a paragraph must not become a doc_order slot: that is the prose shredding of findings.md B1.
 */
export const KNOWN_HEADING_BLOCK_TYPES = [
  "title",
  "heading",
] as const;

export type KnownHeadingBlockType = (typeof KNOWN_HEADING_BLOCK_TYPES)[number];

export function isKnownHeadingBlockType(value: string): value is KnownHeadingBlockType {
  return (KNOWN_HEADING_BLOCK_TYPES as readonly string[]).includes(value);
}

/**
 * The known relation vocabulary from ADR-001. As with KnownBlockType this is documentation and codegen input ONLY — Relation.type accepts any string.
 *
 * - parent_of: structural containment (section → paragraph).
 * - next_in_reading_order: explicit successor within a flow.
 * - caption_of: from a caption block TO the figure/table it captions.
 * - references: from a block that mentions a float ("see Figure 2") TO that float.
 * - defines: from a block that defines a symbol or term TO the block using it.
 * - explains: from prose TO the equation/figure it explains.
 * - result_of: from a result/table TO the method that produced it.
 * - footnote_of: from a footnote TO its anchor.
 * - continues_on_next_page: from the head of a split paragraph TO its tail. Cross-page paragraph joining is the defect readers notice most and that no mainstream parser advertises; making it an explicit, confidence-scored relation means it can be measured and repaired independently.
 * - continues_in_next_column: from the head of a paragraph split across columns ON THE SAME PAGE to its tail. Added because ADR-001 offers only continues_on_next_page, and a paragraph running from the foot of column A to the head of column B is the most common structure in the corpus (4 of 8 papers are two-column). Without it a parser must either merge the two halves into one block whose single-ring polygon spans the gutter — reintroducing exactly the highlight bleed Commitment 2 exists to prevent — or leave them unlinked, so Guided view, retrieval chunks and the audiobook all see half-sentences.
 * - visually_associated_with: proximity-based association with no stronger semantics available.
 * - cites: from a citation block TO the reference_entry it cites.
 */
export const KNOWN_RELATION_TYPES = [
  "parent_of",
  "next_in_reading_order",
  "caption_of",
  "references",
  "defines",
  "explains",
  "result_of",
  "footnote_of",
  "continues_on_next_page",
  "continues_in_next_column",
  "visually_associated_with",
  "cites",
] as const;

export type KnownRelationType = (typeof KNOWN_RELATION_TYPES)[number];

export function isKnownRelationType(value: string): value is KnownRelationType {
  return (KNOWN_RELATION_TYPES as readonly string[]).includes(value);
}

/**
 * The OPEN type: any identifier-shaped string validates, and a v1 consumer MUST tolerate a
 * type it has never seen (DESIGN.md D2). `(string & {})` keeps editor autocompletion on the
 * known values without narrowing the type to them.
 */
export type RelationType = KnownRelationType | (string & {});
