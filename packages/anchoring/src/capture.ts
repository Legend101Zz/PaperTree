/**
 * anchoring/capture — build a complete multi-selector anchor from a selection.
 *
 * EVERY SELECTOR IS WRITTEN AT CAPTURE TIME OR NOT AT ALL. This is the asymmetry that makes ADR-004
 * mandatory rather than advisory: a resolver can be improved after the fact, but a selector cannot
 * be BACKFILLED, because the document it would have described is the one that has already changed.
 * An anchor captured with a block id alone is permanently a 58 %-recoverable anchor.
 *
 * So `captureAnchor` never emits a partial record. If a target has no geometry (a Guided paragraph)
 * the ShapeSelector is legitimately absent; everything the document can support is present.
 */

import { unionOfLineRects, type BBox, type PageFrame, type Polygon } from '@papertree/document-ir';

import { pdfItemRangeToIrQuad, type AdvanceMeasure, type PdfTextItemGeometry } from './bridge.js';
import type { IndexedBlock, IndexedDocument } from './document.js';
import { quadsForRange } from './lineband.js';
import { normaliseForMatch, snapToWordBoundary, toCodePoints } from './quotenorm.js';
import type { Anchor, ProvenanceClass, Selector, SubTarget, TargetKind } from './types.js';

/**
 * Context window, in code points, either side of the quote.
 *
 * 64 and not Hypothesis's hard-coded 32. Their source comment concedes that logical boundaries
 * would be better; academic prose is dense in repeated phrasing ("we show that", "as shown in
 * Figure", "of the model"), so 32 characters is frequently non-discriminating in exactly the
 * documents this product is for. Snapped outward to a word boundary so the context is words.
 */
export const CONTEXT_CODE_POINTS = 64;

function isPaintableQuad(quad: BBox): boolean {
  return quad.every((v) => Number.isFinite(v)) && quad[2] > quad[0] && quad[3] > quad[1];
}

export interface CaptureInput {
  readonly doc: IndexedDocument;
  readonly blockId: string;
  /** Code-point offsets into the block's resolved text. Omit both for a whole-block target. */
  readonly startOffset?: number;
  readonly endOffset?: number;
  readonly targetKind: TargetKind;
  readonly provenanceClass?: ProvenanceClass;
  readonly subTarget?: SubTarget;
  readonly id: string;
  readonly at: string;
  readonly client: string;
  readonly mode?: 'source' | 'guided';
  /**
   * The selection's own glyph quads, IR space, measured by the caller from the text layer's pdf.js
   * ITEM GEOMETRY (`itemPieceQuads`, through `bridge.ts`) — never from DOM rects. When given (and
   * non-empty) the ShapeSelector stores these instead of `quadsForRange` over the IR spans.
   *
   * Why the reader passes them (S4): a live worker parse's span is usually a whole LINE, so
   * `quadsForRange` narrows a mid-line selection by a code-point ratio across ~90 characters and
   * lands points away from the glyphs; pdf.js items are words or short runs, so the same ratio is
   * wrong by less than a character. The Block/Position/Quote selectors still come from the IR.
   */
  readonly quads?: readonly BBox[];
}

export function captureAnchor(input: CaptureInput): Anchor {
  const { doc } = input;
  const block = doc.byId.get(input.blockId);
  if (block === undefined) {
    throw new Error(`captureAnchor: no block ${input.blockId} in this parse`);
  }

  const start = input.startOffset ?? 0;
  const end = input.endOffset ?? block.textCodePoints.length;
  const selectors: Selector[] = [];

  // ── T1 ──
  selectors.push({
    type: 'BlockSelector',
    blockId: block.id,
    blockTextHash: block.contentHash,
    ...(input.startOffset === undefined ? {} : { startOffset: start }),
    ...(input.endOffset === undefined ? {} : { endOffset: end }),
  });

  // ── page ──
  const page = doc.pages.find((p) => p.index === block.pageIndex);
  selectors.push({
    type: 'PageSelector',
    index: block.pageIndex,
    ...(page?.label === undefined ? {} : { label: page.label }),
  });

  // ── T2 ── document-global offsets, a hint only
  const streamStart = block.streamStart + start;
  const streamEnd = block.streamStart + end;
  selectors.push({ type: 'TextPositionSelector', start: streamStart, end: streamEnd });

  // ── T3 ── the durable one
  const stream = doc.streamCodePoints;
  const exactPoints = stream.slice(streamStart, streamEnd);
  if (exactPoints.length > 0) {
    const prefixFrom = snapToWordBoundary(
      stream,
      Math.max(0, streamStart - CONTEXT_CODE_POINTS),
      -1,
    );
    const suffixTo = snapToWordBoundary(
      stream,
      Math.min(stream.length, streamEnd + CONTEXT_CODE_POINTS),
      1,
    );
    const exact = String.fromCodePoint(...exactPoints);
    const prefix = String.fromCodePoint(...stream.slice(prefixFrom, streamStart));
    const suffix = String.fromCodePoint(...stream.slice(streamEnd, suffixTo));
    selectors.push({
      type: 'TextQuoteSelector',
      exact,
      prefix,
      suffix,
      exactNormalised: normaliseForMatch(exact).text,
      prefixNormalised: normaliseForMatch(prefix).text,
      suffixNormalised: normaliseForMatch(suffix).text,
    });
  }

  // ── T4 ── geometry, in IR space
  const measured = (input.quads ?? []).filter(isPaintableQuad);
  const geometry =
    measured.length > 0 && input.subTarget === undefined
      ? {
          quads: measured.map((q): BBox => [q[0], q[1], q[2], q[3]]),
          polygons: unionOfLineRects(measured),
        }
      : geometryFor(block, start, end, input.subTarget);
  if (geometry !== null && page !== undefined) {
    selectors.push({
      type: 'ShapeSelector',
      pageIndex: block.pageIndex,
      quads: geometry.quads,
      polygons: geometry.polygons,
      pageWidth: page.width,
      pageHeight: page.height,
      // The page's own /Rotate is ALREADY applied to every stored coordinate; this records it for
      // auditability. A consumer that applies it again double-rotates every highlight.
      rotation: (page.rotation as 0 | 90 | 180 | 270) ?? 0,
      // RECORDED here, APPLIED only at viewport time (`pdfToViewport`). The two are not in tension:
      // IR space is default user space, and the viewport is IR space x zoom x userUnit.
      userUnit: page.user_unit ?? 1,
      cropBox: (page.crop_box as unknown as BBox) ?? [0, 0, page.width, page.height],
    });
  }

  // ── T5 ── section path
  const section = sectionContaining(doc, block.id);
  if (section !== null) {
    const heading = doc.byId.get(section.heading_block_id);
    const indexInSection = Math.max(0, section.block_ids.indexOf(block.id));
    selectors.push({
      type: 'SectionPathSelector',
      path: sectionPath(doc, section),
      headingText: heading?.text ?? '',
      paraIndexInSection: indexInSection,
      charOffsetInPara: start,
    });
  }

  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id: input.id,
    doc: {
      paperId: doc.paperId,
      pdfSha256: doc.sourceHash,
      parserVersion: doc.parserVersion,
      textStreamId: doc.textStreamId,
    },
    targetKind: input.targetKind,
    provenanceClass: input.provenanceClass ?? 'source',
    ...(input.subTarget === undefined ? {} : { subTarget: input.subTarget }),
    selectors,
    created: { mode: input.mode ?? 'source', at: input.at, client: input.client },
  };
}

/**
 * The paintable geometry for a target.
 *
 * A whole-block target uses the block's own POLYGON, which was checked visually at 6× and is snug.
 * A sub-range uses the spans, through `quadsForRange`, which clamps the line bands — span boxes are
 * the extractor's font boxes and 22 of them in `resnet` alone are ~7.3 pt too tall.
 *
 * A `subTarget` with a normalised rect (part of an equation, a region inside a figure) projects
 * that rect onto the block's bbox. That is what makes "part of equation (2)" survive a re-parse:
 * the fraction is relative to the block, so it re-projects onto a re-parsed block of a different
 * size, and it needs no LaTeX to exist.
 */
function geometryFor(
  block: IndexedBlock,
  start: number,
  end: number,
  subTarget: SubTarget | undefined,
): { quads: BBox[]; polygons: Polygon[] } | null {
  const rect = subTarget?.normalisedRect;
  if (rect !== undefined) {
    const [x0, y0, x1, y1] = block.bbox;
    const w = x1 - x0;
    const h = y1 - y0;
    const quad: BBox = [x0 + w * rect[0], y0 + h * rect[1], x0 + w * rect[2], y0 + h * rect[3]];
    return { quads: [quad], polygons: [bboxRing(quad)] };
  }

  const wholeBlock = start <= 0 && end >= block.textCodePoints.length;
  if (wholeBlock || block.spans.length === 0) {
    if (block.polygon.length >= 3) {
      return { quads: [block.bbox], polygons: [block.polygon] };
    }
    if (block.bbox[2] > block.bbox[0]) {
      return { quads: [block.bbox], polygons: [bboxRing(block.bbox)] };
    }
    return null;
  }

  // Span offsets are UTF-16 offsets into `block.text` as the fixture stores them. They coincide with
  // code-point offsets on all three fixtures (measured: zero astral code points in any `text`
  // field), but the two are not the same thing in general and this package counts code points
  // everywhere, so the conversion is explicit rather than assumed.
  const utf16Start = codePointToUtf16(block.text, start);
  const utf16End = codePointToUtf16(block.text, end);
  const result = quadsForRange(block.spans, utf16Start, utf16End);
  return result.quads.length > 0 ? result : null;
}

function bboxRing(bbox: BBox): Polygon {
  return [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ];
}

function codePointToUtf16(text: string, codePointOffset: number): number {
  let seen = 0;
  let index = 0;
  for (const char of text) {
    if (seen >= codePointOffset) return index;
    index += char.length;
    seen += 1;
  }
  return index;
}

function sectionContaining(
  doc: IndexedDocument,
  blockId: string,
): {
  heading_block_id: string;
  level: number;
  block_ids: readonly string[];
  parent_heading_block_id?: string;
} | null {
  for (const section of doc.sections) {
    if (section.block_ids.includes(blockId) || section.heading_block_id === blockId) {
      return section;
    }
  }
  return null;
}

/**
 * The section's path, walked up through `parent_heading_block_id`.
 *
 * The elements are HEADING TEXTS and not numbers, because the IR stores neither a number nor a
 * path — `Section` is `{heading_block_id, level, block_ids}`. Front matter belongs to NO section in
 * all three fixtures (24 blocks in `attention`, 43 in `neural-odes`, 13 in `resnet`), so this
 * legitimately returns nothing for a title or an author block, and T5 is simply unavailable there.
 */
function sectionPath(
  doc: IndexedDocument,
  section: { heading_block_id: string; parent_heading_block_id?: string },
): string[] {
  const path: string[] = [];
  let current: typeof section | undefined = section;
  const guard = new Set<string>();
  while (current !== undefined && !guard.has(current.heading_block_id)) {
    guard.add(current.heading_block_id);
    const heading = doc.byId.get(current.heading_block_id);
    path.unshift(heading?.text.trim() ?? current.heading_block_id);
    const parentId: string | undefined = current.parent_heading_block_id;
    if (parentId === undefined) break;
    current = doc.sections.find((s) => s.heading_block_id === parentId);
  }
  return path;
}

// ─── the pdf.js path: text-layer items the IR does not stamp ─────────────────────────────────────

/**
 * The `doc.textStreamId` of a capture made from pdf.js item geometry (contracts.md §6):
 * `pdfjs@<version>/page-text`. The version is pdf.js's own (`pdfjs.version`), because two pdf.js
 * releases are not required to read a page's text identically.
 */
export function pageTextStreamId(pdfjsVersion: string): string {
  return `pdfjs@${pdfjsVersion}/page-text`;
}

/** One page's text as pdf.js reads it, and where each item starts in it (code points). */
export interface PageText {
  readonly text: string;
  readonly itemStarts: readonly number[];
}

/**
 * The page text: every item's `str` in content-stream order, with a newline after an item that
 * ends a line (`hasEOL`). It is the stream a page-text quote's prefix and suffix are cut from — the
 * PAGE's own words, which is what the contract asks for ("a quote from the page's own text") and
 * what a T3 search in the IR stream then matches against.
 */
export function pageTextOf(
  items: readonly (PdfTextItemGeometry & { readonly hasEOL?: boolean })[],
): PageText {
  let text = '';
  let cursor = 0;
  const itemStarts: number[] = [];
  for (const item of items) {
    itemStarts.push(cursor);
    text += item.str;
    cursor += toCodePoints(item.str).length;
    if (item.hasEOL === true) {
      text += '\n';
      cursor += 1;
    }
  }
  return { text, itemStarts };
}

/** A selection endpoint on the pdf.js path: an item, and a code-point offset inside its `str`. */
export interface PageTextEndpoint {
  readonly item: number;
  readonly offset: number;
}

export interface PageTextCaptureInput {
  readonly doc: IndexedDocument;
  readonly pageIndex: number;
  /** `frameForPdfPage(page)` for the page the items are on. */
  readonly frame: PageFrame;
  /** `getTextContent()` items with a defined `str`, in content order (`alignedItems`). */
  readonly items: readonly (PdfTextItemGeometry & { readonly hasEOL?: boolean })[];
  readonly start: PageTextEndpoint;
  /** Exclusive. */
  readonly end: PageTextEndpoint;
  /** `pageTextStreamId(pdfjs.version)`. */
  readonly textStreamId: string;
  readonly id: string;
  readonly at: string;
  readonly client: string;
  readonly mode?: 'source' | 'guided';
  readonly provenanceClass?: ProvenanceClass;
  /** The text layer's font advance, for the fraction inside an item (`bridge.ts` `AdvanceMeasure`). */
  readonly measure?: AdvanceMeasure;
}

/** Items closer than this many line heights on one line are one run of words: one quad. */
const WORD_GAP_LINE_HEIGHTS = 1.5;

function sameLineBox(a: BBox, b: BBox): boolean {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const shorter = Math.min(a[3] - a[1], b[3] - b[1]);
  return shorter > 0 && overlap > 0.5 * shorter;
}

/** A run of characters inside one pdf.js item: code points `[from, to)` of item `item`'s `str`. */
export interface ItemPiece {
  readonly item: number;
  readonly from: number;
  readonly to: number;
}

/**
 * The quads for a set of item pieces: one per run of items, joined along a line while the gap
 * between them is a word space. A table row's cells, a column gutter, a figure's scattered labels
 * all have gaps wider than that and stay separate quads — painting the gap would paint text that
 * was not selected. Whitespace-only pieces carry no glyph and contribute nothing.
 *
 * Exported for the reader's IR-stamped path too, which measures its ShapeSelector from the same
 * item geometry (`CaptureInput.quads`).
 */
export function itemPieceQuads(
  frame: PageFrame,
  items: readonly PdfTextItemGeometry[],
  pieces: readonly ItemPiece[],
  measure?: AdvanceMeasure,
): BBox[] {
  const boxes: BBox[] = [];
  for (const piece of pieces) {
    const item = items[piece.item];
    if (item === undefined || item.str.trim() === '') continue;
    const quad = pdfItemRangeToIrQuad(frame, item, piece.from, piece.to, measure);
    if (quad !== null && quad[2] > quad[0] && quad[3] > quad[1]) boxes.push(quad);
  }
  const merged: BBox[] = [];
  for (const box of boxes) {
    const last = merged[merged.length - 1];
    if (last !== undefined && sameLineBox(last, box)) {
      const lineHeight = Math.min(last[3] - last[1], box[3] - box[1]);
      const gap = box[0] - last[2];
      if (gap >= -lineHeight && gap <= WORD_GAP_LINE_HEIGHTS * lineHeight) {
        merged[merged.length - 1] = [
          Math.min(last[0], box[0]),
          Math.min(last[1], box[1]),
          Math.max(last[2], box[2]),
          Math.max(last[3], box[3]),
        ];
        continue;
      }
    }
    merged.push(box);
  }
  return merged;
}

/** Every item piece between two page-text endpoints (the end exclusive), in content order. */
export function piecesBetween(
  items: readonly PdfTextItemGeometry[],
  start: PageTextEndpoint,
  end: PageTextEndpoint,
): ItemPiece[] {
  const pieces: ItemPiece[] = [];
  for (let i = Math.max(0, start.item); i <= Math.min(items.length - 1, end.item); i += 1) {
    const item = items[i];
    if (item === undefined) continue;
    const length = toCodePoints(item.str).length;
    const from = i === start.item ? start.offset : 0;
    const to = i === end.item ? end.offset : length;
    if (to > from) pieces.push({ item: i, from, to });
  }
  return pieces;
}

function pageTextQuads(input: PageTextCaptureInput): BBox[] {
  return itemPieceQuads(
    input.frame,
    input.items,
    piecesBetween(input.items, input.start, input.end),
    input.measure,
  );
}

function areaOf(bbox: BBox): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

/**
 * `table_cell` or `figure_region` when the captured region sits inside a table-cell or figure block
 * BY GEOMETRY (contracts.md §6), `text` otherwise. The deepest containing block decides, because
 * blocks nest: a cell is inside its row inside its table.
 */
function targetKindByGeometry(doc: IndexedDocument, pageIndex: number, extent: BBox): TargetKind {
  const cx = (extent[0] + extent[2]) / 2;
  const cy = (extent[1] + extent[3]) / 2;
  const depthOf = (block: IndexedBlock): number => {
    let depth = 0;
    const seen = new Set<string>();
    for (let parent = block.parentId; parent !== null && !seen.has(parent); depth += 1) {
      seen.add(parent);
      parent = doc.byId.get(parent)?.parentId ?? null;
    }
    return depth;
  };
  let best: { block: IndexedBlock; depth: number; area: number } | null = null;
  for (const block of doc.byPage.get(pageIndex) ?? []) {
    const [x0, y0, x1, y1] = block.bbox;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
    const candidate = { block, depth: depthOf(block), area: areaOf(block.bbox) };
    // The DEEPEST containing block decides, and area only breaks a tie: blocks nest (a cell in
    // its row in its table), but their boxes need not — on ResNet's live parse a cell's box is a
    // hair larger than its own row's, and "smallest box" answered with the row.
    if (
      best === null ||
      candidate.depth > best.depth ||
      (candidate.depth === best.depth && candidate.area < best.area)
    ) {
      best = candidate;
    }
  }
  if (best === null) return 'text';
  if (best.block.type === 'table_cell') return 'table_cell';
  if (best.block.type === 'figure') return 'figure_region';
  return 'text';
}

/**
 * An anchor for a selection the IR could not stamp — a table cell, a figure label, rotated text —
 * captured from pdf.js item geometry (ADR-002 §3.3, contracts.md §6).
 *
 * WHAT IT CARRIES: `PageSelector`, a `TextQuoteSelector` cut from the page's own text, and a
 * `ShapeSelector` whose quads come from the items' matrices. NO `BlockSelector` and NO
 * `TextPositionSelector`: both are offsets into the IR's text stream, and this selection has none —
 * inventing them from a guess at which block the item belongs to is precisely `locateByText`'s
 * first-occurrence defect, removed in S4. The ladder links this anchor at T3 (the quote) or T4 (the
 * geometry), and Source paints the stored quads regardless.
 *
 * Returns `null` when the range selects no visible glyph (only whitespace items).
 */
export function capturePageTextAnchor(input: PageTextCaptureInput): Anchor | null {
  const { doc, pageIndex, items } = input;
  const quads = pageTextQuads(input);
  if (quads.length === 0) return null;

  const pageText = pageTextOf(items);
  const stream = toCodePoints(pageText.text);
  const startAt = (pageText.itemStarts[input.start.item] ?? 0) + input.start.offset;
  const endAt = (pageText.itemStarts[input.end.item] ?? 0) + input.end.offset;
  const exactPoints = stream.slice(startAt, endAt);
  const exact = String.fromCodePoint(...exactPoints);

  const prefixFrom = snapToWordBoundary(stream, Math.max(0, startAt - CONTEXT_CODE_POINTS), -1);
  const suffixTo = snapToWordBoundary(
    stream,
    Math.min(stream.length, endAt + CONTEXT_CODE_POINTS),
    1,
  );
  const prefix = String.fromCodePoint(...stream.slice(prefixFrom, startAt));
  const suffix = String.fromCodePoint(...stream.slice(endAt, suffixTo));

  const extent: BBox = [
    Math.min(...quads.map((q) => q[0])),
    Math.min(...quads.map((q) => q[1])),
    Math.max(...quads.map((q) => q[2])),
    Math.max(...quads.map((q) => q[3])),
  ];
  const page = doc.pages.find((p) => p.index === pageIndex);
  const width = page?.width ?? input.frame.width;
  const height = page?.height ?? input.frame.height;

  const selectors: Selector[] = [
    {
      type: 'PageSelector',
      index: pageIndex,
      ...(page?.label === undefined ? {} : { label: page.label }),
    },
    {
      type: 'TextQuoteSelector',
      exact,
      prefix,
      suffix,
      exactNormalised: normaliseForMatch(exact).text,
      prefixNormalised: normaliseForMatch(prefix).text,
      suffixNormalised: normaliseForMatch(suffix).text,
    },
    {
      type: 'ShapeSelector',
      pageIndex,
      quads,
      polygons: unionOfLineRects(quads),
      pageWidth: width,
      pageHeight: height,
      rotation: (page?.rotation ?? input.frame.rotation) as 0 | 90 | 180 | 270,
      userUnit: page?.user_unit ?? input.frame.userUnit,
      cropBox: (page?.crop_box as unknown as BBox | undefined) ?? [0, 0, width, height],
    },
  ];

  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id: input.id,
    doc: {
      paperId: doc.paperId,
      pdfSha256: doc.sourceHash,
      parserVersion: doc.parserVersion,
      textStreamId: input.textStreamId,
    },
    targetKind: targetKindByGeometry(doc, pageIndex, extent),
    provenanceClass: input.provenanceClass ?? 'source',
    selectors,
    created: { mode: input.mode ?? 'source', at: input.at, client: input.client },
  };
}
