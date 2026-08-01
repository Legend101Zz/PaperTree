/**
 * reader/stampTextLayer — pdf.js's text-layer divs, labelled with the IR block they belong to.
 *
 * THE GAP THIS CLOSES. `useSelectionCapture`'s header declares a contract: every text-layer item
 * carries `data-block-id` and `data-cp-start`, and `PdfPage` owns them. `PdfPage` never wrote them.
 * Measured in Chrome on `attention-is-all-you-need`: 415 rendered spans, 0 with either attribute.
 * The hook was therefore reduced to its own documented fallback — `locateByText`, which "picks the
 * FIRST block on the page containing the string", so every phrase occurring twice on a page
 * ("of the model", "we show that") would have anchored to the wrong one. Issue #58.
 *
 * WHY THE MAPPING HAS TO BE COMPUTED AND CANNOT BE READ OFF. pdf.js and PyMuPDF segment the same
 * page differently, because they are answering different questions. PyMuPDF's spans, as they reach
 * the IR, are LINE-level — `attention`'s first body paragraph is four spans of 94, 99, 92 and 100
 * characters, each bbox running the full column width. pdf.js emits one item per text-showing
 * operator, which is usually a word or a short run. There are 469 items against 62 spans on the
 * same fixture. No index, no id and no offset survives that; only the glyphs do.
 *
 * SO: MATCH ON GEOMETRY, THEN ALIGN ON TEXT.
 *
 *   1. Each item's advance box → IR space, via `frameForPdfPage`/`pdfRectToIr` in
 *      `@papertree/anchoring`. Never via the DOM. The div's `style.left` would be readable here and
 *      is deliberately not read: it is CSS pixels at the current zoom, and a mapping derived from it
 *      would be a mapping that changes when the user zooms, which is the v1 defect wearing a hat.
 *   2. The block is the one whose span band contains the item's centre. Centre, not overlap area,
 *      because a superscript or an inline formula legitimately pokes outside its line band and an
 *      overlap rule would hand it to whichever neighbour it pokes into.
 *   3. Within a block, walk its text with a RUNNING CURSOR and find each item's string at or after
 *      the cursor. This is what makes segmentation differences irrelevant: as long as the characters
 *      agree, the offsets are exact regardless of where either side chose to cut.
 *
 * The cursor is per block and monotonic. `indexOf(needle, cursor)` rather than a plain `indexOf` is
 * the whole reason a paragraph containing "the" forty times still stamps correctly.
 *
 * MEASURED COVERAGE, all three fixtures, every page — reproduced by `test/stamp.spec.ts`:
 *
 *     attention-is-all-you-need   469 items (332 textual)   465 matched 99.1%   327 offset 98.5%
 *     resnet-cvpr-2col            754 items (567 textual)   673 matched 89.3%   488 offset 86.1%
 *     neural-odes-mathheavy       892 items (656 textual)   820 matched 91.9%   577 offset 88.0%
 *
 * The offset percentage is OF THE TEXTUAL ITEMS, not of all of them — see `StampResult.textual`.
 * A third of pdf.js's stream is whitespace-only items marking inter-word gaps; they get no offset
 * because there is no offset for them to have, and counting them as misses would understate the
 * mapping by thirty points.
 *
 * The remaining shortfall is not noise and is not a bug to chase: it is display equations, figure
 * labels and rotated margin text, whose glyphs pdf.js emits and whose text the IR either holds in a
 * block with different characters (an equation's Unicode reconstruction) or does not hold at all.
 * An item that cannot be placed is LEFT UNSTAMPED, and the hook's fallback handles a selection that
 * touches one. Stamping it with a guess would be worse than leaving it: a wrong `data-block-id` is
 * silently wrong where an absent one is visibly approximate.
 */

import { frameForPdfPage, pdfRectToIr, type IndexedBlock } from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

/** Stamped onto every item this module places. Re-exported by `useSelectionCapture` as the reader. */
export const BLOCK_ID_ATTR = 'data-block-id';
export const CP_START_ATTR = 'data-cp-start';

/**
 * One pdf.js text item, reduced to what the mapping needs.
 *
 * `transform` is the item's text matrix in RAW PDF USER SPACE — `[a, b, c, d, e, f]`, with `e`/`f`
 * the origin, bottom-left, y up. `width`/`height` are the advance box in the same space. Taking them
 * from the item rather than from the div is the point: they are the typesetter's numbers, not the
 * browser's. See `itemBoxInIr` for why "viewport space" is the wrong guess and what it costs.
 */
export interface TextItemLike {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width?: number;
  readonly height?: number;
}

export interface StampArgs {
  /** `TextLayer.textDivs`, in render order. */
  readonly divs: readonly HTMLElement[];
  /** The items those divs were built from — same order, same length. See `alignedItems`. */
  readonly items: readonly TextItemLike[];
  /** `PDFPageProxy.view` and `.rotate`, plus the IR's `Page.user_unit`. */
  readonly page: { readonly view: BBox; readonly rotate: number; readonly userUnit?: number };
  /** Every IR block on this page that carries text. Order is irrelevant. */
  readonly blocks: readonly IndexedBlock[];
}

export interface StampResult {
  readonly items: number;
  /**
   * Items with a non-whitespace string — the only ones an offset can mean anything for.
   *
   * pdf.js emits whitespace-only items for inter-word and inter-line gaps, and they are a third of
   * the stream. Reporting `offset / items` counts every one of them as a miss and understates the
   * mapping by ~30 points; `offset / textual` is the number that answers "can a selection endpoint
   * here be placed exactly?"
   */
  readonly textual: number;
  readonly matched: number;
  readonly offset: number;
}

/**
 * Whitespace-collapsed, for matching only.
 *
 * The IR keeps a paragraph's newlines (`Block.text` is the unrepaired reading, deviation D4) and
 * pdf.js emits none, so a raw `indexOf` fails at every line break. Collapsing BOTH sides makes the
 * comparison line-agnostic; the offsets are then mapped back through `collapsedToRaw`, so nothing
 * downstream ever sees the collapsed form.
 */
function collapse(value: string): string {
  return value.replace(/\s+/gu, ' ');
}

/**
 * Collapsed-string index → index into the original string's CODE POINTS.
 *
 * Built once per block. `Anchor.offsetUnit` is `'unicode'` and every offset in
 * `@papertree/anchoring` counts code points, so this counts code points too — `Array.from`, not
 * `.length`. On the three fixtures the two coincide (zero astral code points measured in any `text`
 * field); they diverge the moment a paper contains an emoji or a 𝕄, and a mapping that only worked
 * on the fixtures would be a mapping that fails on the first real upload.
 */
function collapsedToRaw(raw: string): { collapsed: string; toRawCp: number[] } {
  const chars = Array.from(raw);
  const out: string[] = [];
  const toRawCp: number[] = [];
  let pendingSpace = false;

  for (let cp = 0; cp < chars.length; cp += 1) {
    const char = chars[cp] as string;
    if (/\s/u.test(char)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out.push(' ');
      toRawCp.push(cp);
      pendingSpace = false;
    }
    out.push(char);
    toRawCp.push(cp);
  }

  // One past the end, so a match ending at the final character has somewhere to point.
  toRawCp.push(chars.length);
  return { collapsed: out.join(''), toRawCp };
}

/**
 * The item's advance box in IR points.
 *
 * `item.transform` IS ALREADY RAW PDF USER SPACE — this is the trap, and getting it wrong is silent.
 * `convertToPdfPoint` looks like the right call and is not: it maps VIEWPORT coordinates back to PDF
 * ones, so applying it to a transform that never left PDF space runs the inverse of a transform that
 * was never applied. pdf.js's own text layer is the proof: `#appendText` computes
 * `Util.transform(this.#transform, geom.transform)` with `#transform = [1, 0, 0, -1, -pageX,
 * pageY + pageHeight]`, i.e. it composes the PDF→CSS flip ONTO `geom.transform`, which it could not
 * do if `geom.transform` were already in viewport space.
 *
 * Measured, on `attention-is-all-you-need`: with the spurious `convertToPdfPoint`, 35.8% of items
 * matched a block and 3.4% got an offset. Without it, 99.1% and 98.5%. Both versions typecheck,
 * neither throws, and the wrong one silently degrades every anchor to the text fallback — which is
 * exactly the failure mode this module was written to remove.
 */
function itemBoxInIr(item: TextItemLike, frame: ReturnType<typeof frameForPdfPage>): BBox | null {
  const originX = item.transform[4];
  const originY = item.transform[5];
  if (typeof originX !== 'number' || typeof originY !== 'number') return null;

  return pdfRectToIr(frame, [
    originX,
    originY,
    originX + (item.width ?? 0),
    originY + (item.height ?? 0),
  ]);
}

/**
 * The block whose span band contains the point, smallest band first.
 *
 * Smallest wins because bands nest: a `table_cell`'s band sits inside its `table_row`'s, and the
 * cell is the more specific — and more useful — answer. A one-point tolerance absorbs the rounding
 * between PyMuPDF's rect arithmetic and pdf.js's matrix arithmetic; it is far below the ~10pt line
 * pitch, so it cannot reach into a neighbouring line.
 */
const BAND_TOLERANCE_PT = 1;

function blockAt(blocks: readonly IndexedBlock[], x: number, y: number): IndexedBlock | null {
  let best: IndexedBlock | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const block of blocks) {
    for (const span of block.spans) {
      const [x0, y0, x1, y1] = span.bbox;
      if (
        x < x0 - BAND_TOLERANCE_PT ||
        x > x1 + BAND_TOLERANCE_PT ||
        y < y0 - BAND_TOLERANCE_PT ||
        y > y1 + BAND_TOLERANCE_PT
      ) {
        continue;
      }
      const area = (x1 - x0) * (y1 - y0);
      if (area < bestArea) {
        bestArea = area;
        best = block;
      }
    }
  }

  return best;
}

/**
 * Stamp the divs. Returns what it managed to place, so a caller can log or assert on coverage.
 *
 * Idempotent: re-running on the same divs rewrites the same values, which matters because a zoom
 * change rebuilds the text layer and re-stamps it.
 */
export function stampTextLayer(args: StampArgs): StampResult {
  const { divs, items, page, blocks } = args;
  const frame = frameForPdfPage(page);
  const withText = blocks.filter((block) => block.text.length > 0);

  // Pass 1: item → block, keeping render order within each block. Render order IS reading order for
  // the alignment below, and it is pdf.js's order, not ours to re-derive.
  const perBlock = new Map<string, { block: IndexedBlock; entries: { div: HTMLElement; str: string }[] }>();
  let matched = 0;
  let textual = 0;

  const count = Math.min(divs.length, items.length);
  for (let index = 0; index < count; index += 1) {
    const div = divs[index] as HTMLElement;
    const item = items[index] as TextItemLike;

    div.removeAttribute(BLOCK_ID_ATTR);
    div.removeAttribute(CP_START_ATTR);

    if (collapse(item.str).trim() !== '') textual += 1;

    const box = itemBoxInIr(item, frame);
    if (box === null) continue;

    const block = blockAt(withText, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    if (block === null) continue;

    div.setAttribute(BLOCK_ID_ATTR, block.id);
    matched += 1;

    let bucket = perBlock.get(block.id);
    if (bucket === undefined) {
      bucket = { block, entries: [] };
      perBlock.set(block.id, bucket);
    }
    bucket.entries.push({ div, str: item.str });
  }

  // Pass 2: the running cursor, per block.
  let offset = 0;
  for (const { block, entries } of perBlock.values()) {
    const { collapsed, toRawCp } = collapsedToRaw(block.text);
    let cursor = 0;

    for (const { div, str } of entries) {
      const needle = collapse(str).trim();
      if (needle === '') {
        // pdf.js emits whitespace-only items for inter-word gaps. They have no offset of their own
        // and must not move the cursor; a selection endpoint inside one resolves from its neighbour.
        continue;
      }

      const at = collapsed.indexOf(needle, cursor);
      if (at === -1) continue;

      const rawCp = toRawCp[at];
      if (rawCp === undefined) continue;

      div.setAttribute(CP_START_ATTR, String(rawCp));
      cursor = at + needle.length;
      offset += 1;
    }
  }

  return { items: count, textual, matched, offset };
}

/**
 * The items that correspond 1:1 with `TextLayer.textDivs`.
 *
 * pdf.js pushes one div per item whose `str` is defined, skipping the marked-content structural
 * items entirely (`text_layer.mjs` `#processItems`). Filtering the same way is what keeps the two
 * arrays index-aligned; zipping the raw `content.items` against `textDivs` would drift by one at
 * every `beginMarkedContent` and silently mis-stamp the entire remainder of the page.
 */
export function alignedItems(items: readonly { str?: string }[]): TextItemLike[] {
  return items.filter((item): item is TextItemLike => typeof item.str === 'string');
}
