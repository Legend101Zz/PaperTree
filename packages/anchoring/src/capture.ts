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

import type { BBox, Polygon } from '@papertree/document-ir';

import type { IndexedBlock, IndexedDocument } from './document.js';
import { quadsForRange } from './lineband.js';
import { normaliseForMatch, snapToWordBoundary } from './quotenorm.js';
import type {
  Anchor,
  ProvenanceClass,
  Selector,
  SubTarget,
  TargetKind,
} from './types.js';

/**
 * Context window, in code points, either side of the quote.
 *
 * 64 and not Hypothesis's hard-coded 32. Their source comment concedes that logical boundaries
 * would be better; academic prose is dense in repeated phrasing ("we show that", "as shown in
 * Figure", "of the model"), so 32 characters is frequently non-discriminating in exactly the
 * documents this product is for. Snapped outward to a word boundary so the context is words.
 */
export const CONTEXT_CODE_POINTS = 64;

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
    const prefixFrom = snapToWordBoundary(stream, Math.max(0, streamStart - CONTEXT_CODE_POINTS), -1);
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
  const geometry = geometryFor(block, start, end, input.subTarget);
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
): { heading_block_id: string; level: number; block_ids: readonly string[]; parent_heading_block_id?: string } | null {
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
