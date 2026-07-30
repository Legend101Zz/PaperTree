/**
 * anchoring/document — the indexed view of a `Paper` that the resolver queries.
 *
 * Built once per (paper, parse) and reused, because every tier needs a different index over the
 * same document and rebuilding them per anchor is what makes re-anchoring a page of highlights
 * quadratic.
 *
 * THE TEXT STREAM. T2's offsets are into a document-global concatenation, so the concatenation has
 * to be defined rather than assumed. It is: every block carrying text, in `doc_order`, joined by a
 * single U+000A. Nested blocks (a `table_cell`, an `inline_equation`) ARE included — they carry
 * text a user can select — and they carry their parent's flow but are deliberately absent from the
 * page's ordered flow list (D14 / rule 42), so `Page.flows` is the wrong thing to walk. `doc_order`
 * is the right thing, and it is the only total order the IR defines.
 *
 * `Block.text` IS READ THROUGH `resolvedText`, NEVER DIRECTLY. `Block.text` keeps the UNREPAIRED
 * reading permanently by design (D4), so every consumer that wants the repaired reading has to
 * combine `text` with `repairs`, and DESIGN.md forbids each epic writing that loop itself. The
 * fixtures carry no repairs at all, so this costs nothing today and is exactly the kind of promise
 * that is cheap now and expensive to retrofit.
 */

import {
  bboxToPolygon,
  polygonExtent,
  resolvedText,
  type BBox,
  type BlockId,
  type Polygon,
} from '@papertree/document-ir';

import { normaliseForMatch, toCodePoints, type NormalisedQuote } from './quotenorm.js';

/** Structurally what this module needs from a `Block`. A real `Block` satisfies it. */
export interface IndexedBlockSource {
  readonly block_id: string;
  readonly type: string;
  readonly page_index: number;
  readonly polygon?: readonly (readonly number[])[];
  readonly bbox?: readonly number[];
  readonly text?: string;
  readonly text_normalised?: string;
  readonly content_hash?: string;
  readonly doc_order?: number;
  readonly parent_id?: string | null;
  readonly spans?: readonly {
    readonly start: number;
    readonly end: number;
    readonly bbox: readonly number[];
    readonly font?: string;
    readonly size?: number;
  }[];
  readonly repairs?: readonly {
    readonly kind: string;
    readonly applied: boolean;
    readonly at?: number;
    readonly from: string;
    readonly to: string;
  }[];
  readonly payload?: Record<string, unknown>;
}

export interface IndexedPageSource {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly user_unit: number;
  readonly crop_box: readonly number[];
  readonly label?: string;
}

/**
 * A `Section` AS THE FIXTURES ACTUALLY SHAPE IT — verified against all three at HEAD.
 *
 * There is no `section_id`, no `title` and no `path`. The display title must be read from
 * `blocks[heading_block_id].text`, and `parent_heading_block_id` is present only when `level > 1`
 * (`neural-odes` has none at all, because all three of its sections are level 1). Modelling a
 * `title` field here and reading it would produce an outline of empty strings against every
 * fixture — the outline is F2.4's whole point, so this is worth getting from the data rather than
 * from the anchor-schema prose, which describes a different shape.
 */
export interface IndexedSectionSource {
  readonly heading_block_id: string;
  readonly level: number;
  readonly block_ids: readonly string[];
  readonly parent_heading_block_id?: string;
}

export interface PageFlows {
  readonly body?: readonly string[];
  readonly caption?: readonly string[];
  readonly footnote?: readonly string[];
  readonly header?: readonly string[];
  readonly footer?: readonly string[];
  readonly margin?: readonly string[];
}

/**
 * A `Relation` as the fixtures shape it.
 *
 * NOTE `provenance` is a STRING here while `Block.provenance` is an OBJECT `{parser, stage}`. Same
 * field name, two different types — `jq '.relations[].provenance.parser'` errors on it.
 */
export interface IndexedRelationSource {
  readonly type: string;
  readonly from_block_id: string;
  readonly to_block_id: string;
  readonly confidence?: number;
  readonly provenance?: string;
}

export interface PaperSource {
  readonly paper_id: string;
  readonly source_hash: string;
  readonly parser?: { readonly name?: string; readonly version?: string } | null;
  readonly pages: readonly (IndexedPageSource & { readonly flows?: PageFlows })[];
  readonly blocks: readonly IndexedBlockSource[];
  readonly relations?: readonly IndexedRelationSource[];
  readonly sections?: readonly IndexedSectionSource[];
}

/**
 * The order flows are concatenated in when building the document text stream.
 *
 * Body first, then the floats in the order a reader meets them. `header` is empty on all 10 fixture
 * pages, so its position here is untested and is a choice rather than a measurement.
 */
const FLOW_ORDER = ['body', 'caption', 'footnote', 'header', 'footer', 'margin'] as const;

export interface IndexedBlock {
  readonly id: BlockId;
  readonly type: string;
  readonly pageIndex: number;
  /** `resolvedText(block).text` — the sanctioned reading, never `block.text` directly. */
  readonly text: string;
  readonly textCodePoints: readonly number[];
  readonly contentHash: string;
  readonly polygon: Polygon;
  readonly bbox: BBox;
  /**
   * Position in the document's reading order — the index this module ASSIGNED, not `Block.doc_order`.
   * `doc_order` is absent on every nested and non-body block (64 of the set's 199), so it cannot
   * order the stream; see `readingOrder`.
   */
  readonly readingIndex: number;
  readonly parentId: string | null;
  readonly spans: readonly {
    readonly start: number;
    readonly end: number;
    readonly bbox: BBox;
    readonly size?: number;
  }[];
  /** Half-open range in the document-global code-point stream. */
  readonly streamStart: number;
  readonly streamEnd: number;
  readonly payload: Record<string, unknown> | undefined;
}

export interface IndexedDocument {
  readonly paperId: string;
  readonly sourceHash: string;
  readonly parserVersion: string;
  /** Identifies WHICH extraction produced the offsets. Two runs of one library can differ. */
  readonly textStreamId: string;
  readonly pages: readonly IndexedPageSource[];
  readonly blocks: readonly IndexedBlock[];
  readonly byId: ReadonlyMap<string, IndexedBlock>;
  readonly byPage: ReadonlyMap<number, readonly IndexedBlock[]>;
  readonly byContentHash: ReadonlyMap<string, readonly IndexedBlock[]>;
  readonly sections: readonly IndexedSectionSource[];
  readonly relations: readonly IndexedRelationSource[];
  /**
   * `from_block_id` -> the block it continues into, for `continues_in_next_column` and
   * `continues_on_next_page`.
   *
   * Exposed because a CONTINUED PARAGRAPH IS ONE PARAGRAPH, and a reflowed reading that treats the
   * fragments as separate paragraphs is wrong in a way the reader can see: `resnet`'s
   * `blk_4hiq3kzukt6azk4x` ends with the characters `high-` and the word finishes in the next
   * block, so rendering them apart produces "high- way networks". De-hyphenation is a
   * document-level operation wherever a paragraph is continued, not a block-level one.
   */
  readonly continuedBy: ReadonlyMap<string, string>;
  /** The document-global stream, raw (un-normalised), as code points. T2 indexes into this. */
  readonly streamCodePoints: readonly number[];
  /** The same stream normalised for matching, with the map back to raw offsets. T3 searches this. */
  readonly normalisedStream: NormalisedQuote;
  readonly normalisedStreamCodePoints: readonly number[];
  /** Normalised-stream offset → page index, for ordering the T3 search by distance from the hint. */
  pageAtNormalisedOffset(offset: number): number | null;
  blockAtStreamOffset(offset: number): IndexedBlock | null;
}

const BLOCK_SEPARATOR = '\n';

/**
 * Every block, in reading order — INCLUDING the ones `doc_order` cannot order.
 *
 * SORTING BY `doc_order` IS WRONG, and quietly so. The field exists only on `flow === "body"`,
 * non-nested blocks: **14 of 57 blocks in `attention`, 39 of 81 in `neural-odes` and 11 of 61 in
 * `resnet` do not carry it at all** — every caption, footnote, page number, margin note, and every
 * `table_row`, `table_cell` and `inline_equation`. A `sort((a, b) => (a.doc_order ?? 0) - …)`
 * collapses all 64 of them to position 0 in arbitrary order, which scrambles the document text
 * stream that T2's offsets index into. `neural-odes` is nearly half nested blocks, so this is not
 * an edge case.
 *
 * SORTING BY GEOMETRY IS ALSO WRONG. `resnet`'s reading order is left column top-to-bottom then
 * right column, and `neural-odes` pages 0 and 1 put their float on opposite sides — a y-then-x sort
 * gets both wrong. The IR carries the answer and it must be trusted over the page.
 *
 * So the order is built from the structure the IR actually provides:
 *
 *   1. pages in index order;
 *   2. within a page, `Page.flows` in `FLOW_ORDER`, each flow in its listed order;
 *   3. immediately after each block, its descendants — nested blocks carry their parent's flow but
 *      are deliberately absent from the flow list (D14 / rule 42), and a `table_cell` belongs next
 *      to its row, not at the end of the document;
 *   4. anything still unreached, appended per page in `(y0, x0)` order, so a block that no flow
 *      lists is included rather than silently dropped.
 *
 * Step 4 is the honest part: it never fires on these three fixtures (all 199 blocks are reached by
 * steps 2–3), but a parser that omits a block from its flows would otherwise lose it from the text
 * stream entirely, and losing text is how anchors silently stop resolving.
 */
function readingOrder(paper: PaperSource): IndexedBlockSource[] {
  const byId = new Map<string, IndexedBlockSource>();
  for (const block of paper.blocks) byId.set(block.block_id, block);

  const childrenOf = new Map<string, IndexedBlockSource[]>();
  for (const block of paper.blocks) {
    const parent = block.parent_id;
    if (parent === undefined || parent === null) continue;
    const bucket = childrenOf.get(parent);
    if (bucket === undefined) childrenOf.set(parent, [block]);
    else bucket.push(block);
  }
  for (const [parent, bucket] of childrenOf) {
    childrenOf.set(
      parent,
      bucket.toSorted(
        (a, b) => topOf(a) - topOf(b) || leftOf(a) - leftOf(b) || a.block_id.localeCompare(b.block_id),
      ),
    );
  }

  const out: IndexedBlockSource[] = [];
  const seen = new Set<string>();

  const emit = (block: IndexedBlockSource): void => {
    if (seen.has(block.block_id)) return;
    seen.add(block.block_id);
    out.push(block);
    for (const child of childrenOf.get(block.block_id) ?? []) emit(child);
  };

  for (const page of paper.pages.toSorted((a, b) => a.index - b.index)) {
    const flows = page.flows ?? {};
    for (const name of FLOW_ORDER) {
      for (const id of flows[name] ?? []) {
        const block = byId.get(id);
        if (block !== undefined) emit(block);
      }
    }
    const stragglers = paper.blocks
      .filter((b) => b.page_index === page.index && !seen.has(b.block_id))
      .toSorted(
        (a, b) => topOf(a) - topOf(b) || leftOf(a) - leftOf(b) || a.block_id.localeCompare(b.block_id),
      );
    for (const block of stragglers) emit(block);
  }

  // A block whose `page_index` names no page at all. Cannot happen in a schema-valid document
  // (rule G4 ties them together), but dropping it would be a silent loss, so it goes last.
  for (const block of paper.blocks) emit(block);

  return out;
}

function topOf(block: IndexedBlockSource): number {
  return block.bbox?.[1] ?? 0;
}

function leftOf(block: IndexedBlockSource): number {
  return block.bbox?.[0] ?? 0;
}

function asPolygon(block: IndexedBlockSource): Polygon {
  if (block.polygon !== undefined && block.polygon.length >= 3) {
    return block.polygon.map((p) => [p[0] as number, p[1] as number] as [number, number]);
  }
  if (block.bbox !== undefined && block.bbox.length === 4) {
    return bboxToPolygon(block.bbox as unknown as BBox);
  }
  return [];
}

/**
 * Build the index.
 *
 * `textStreamId` is a caller obligation and not a default, because the whole point of the field is
 * to record a choice the extractor made that the document itself does not reveal — pdf.js has a
 * `disableNormalization` flag, so ONE library and ONE PDF yield two different text streams. An
 * anchor whose offsets came from one and is resolved against the other is silently wrong at T2, and
 * T2 is the tier that looks authoritative because it is cheap.
 */
export function indexDocument(paper: PaperSource, textStreamId: string): IndexedDocument {
  const ordered = readingOrder(paper);

  const blocks: IndexedBlock[] = [];
  let stream = '';
  let cursor = 0;
  let readingIndex = 0;

  for (const source of ordered) {
    // D4: the ONE sanctioned reader. Never `source.text`.
    const resolved = resolvedText(source);
    const text = resolved.text;
    const points = toCodePoints(text);
    const polygon = asPolygon(source);
    const bbox: BBox =
      source.bbox !== undefined && source.bbox.length === 4
        ? (source.bbox as unknown as BBox)
        : polygon.length > 0
          ? polygonExtent(polygon)
          : [0, 0, 0, 0];

    // THE SHIPPED HASH, NEVER A RECOMPUTED ONE — for two independent reasons.
    //
    // Correctness: `normaliseText` is deliberately NOT idempotent, so `contentHash(text)` and
    // `contentHash(text_normalised)` disagree on any text whose normalised form is not itself
    // normalisation-stable — a ligature or a full-fold expansion immediately before a combining
    // mark, which is routine in extracted PDF text. Recomputing invites comparing unlike with
    // unlike, and tier 2 is precisely the comparison that must not be wrong.
    //
    // Portability: `contentHash` lives in `identity.ts`, which imports `node:crypto` at module
    // scope. This package runs in the browser and in a Web Worker. Comparing two strings the IR
    // already carries needs no hash function at all, so it does not import one.
    //
    // A block with no text (figure, table, unknown — 8, 5 and 8 of them across the three fixtures)
    // has no `content_hash`, and the empty string here is not a sentinel that might collide: it is
    // read only by an equality test against a captured hash, and an anchor over a figure carries no
    // text hash to test. Those anchors resolve at T4 on geometry, which is the correct tier for them.
    const contentHash = source.content_hash ?? '';

    blocks.push({
      id: source.block_id as BlockId,
      type: source.type,
      pageIndex: source.page_index,
      text,
      textCodePoints: points,
      contentHash,
      polygon,
      bbox,
      readingIndex: readingIndex++,
      parentId: source.parent_id ?? null,
      spans: (source.spans ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        bbox: s.bbox as unknown as BBox,
        ...(s.size === undefined ? {} : { size: s.size }),
      })),
      streamStart: cursor,
      streamEnd: cursor + points.length,
      payload: source.payload,
    });

    stream += text + BLOCK_SEPARATOR;
    cursor += points.length + 1;
  }

  const byId = new Map<string, IndexedBlock>();
  const byPage = new Map<number, IndexedBlock[]>();
  const byContentHash = new Map<string, IndexedBlock[]>();
  for (const block of blocks) {
    byId.set(block.id, block);
    const page = byPage.get(block.pageIndex);
    if (page === undefined) byPage.set(block.pageIndex, [block]);
    else page.push(block);
    const hash = byContentHash.get(block.contentHash);
    if (hash === undefined) byContentHash.set(block.contentHash, [block]);
    else hash.push(block);
  }

  const relations = paper.relations ?? [];
  const continuedBy = new Map<string, string>();
  for (const relation of relations) {
    if (
      relation.type === 'continues_in_next_column' ||
      relation.type === 'continues_on_next_page'
    ) {
      continuedBy.set(relation.from_block_id, relation.to_block_id);
    }
  }

  const streamCodePoints = toCodePoints(stream);
  const normalisedStream = normaliseForMatch(stream);
  const normalisedStreamCodePoints = toCodePoints(normalisedStream.text);

  // Sorted stream starts, so offset → block is a binary search rather than a scan. With 199 blocks
  // the scan would be fine; with a 55-page paper's several thousand it is not, and `reparse.spec`
  // resolves thousands of anchors against the same document.
  const starts = blocks.map((b) => b.streamStart);
  const blockAtStreamOffset = (offset: number): IndexedBlock | null => {
    if (blocks.length === 0) return null;
    let lo = 0;
    let hi = blocks.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((starts[mid] as number) <= offset) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return null;
    const block = blocks[found] as IndexedBlock;
    return offset < block.streamEnd ? block : block;
  };

  const pageAtNormalisedOffset = (offset: number): number | null => {
    const raw = normalisedStream.rawOffsetAt[Math.max(0, Math.min(offset, normalisedStreamCodePoints.length))];
    if (raw === undefined) return null;
    const block = blockAtStreamOffset(raw);
    return block === null ? null : block.pageIndex;
  };

  return {
    paperId: paper.paper_id,
    sourceHash: paper.source_hash,
    parserVersion: paper.parser?.version ?? 'unknown',
    textStreamId,
    pages: paper.pages,
    blocks,
    byId,
    byPage,
    byContentHash,
    sections: paper.sections ?? [],
    relations,
    continuedBy,
    streamCodePoints,
    normalisedStream,
    normalisedStreamCodePoints,
    pageAtNormalisedOffset,
    blockAtStreamOffset,
  };
}
