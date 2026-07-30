'use client';

/**
 * reader/useSelectionCapture — a DOM text selection becomes an ADR-004 anchor.
 *
 * THE ONE RULE, because this is the exact line the v1 app crossed:
 *
 *   Range/Selection tell us WHICH characters the user picked. They never tell us WHERE those
 *   characters are. `getClientRects()` is not called here, and must never be: it returns viewport
 *   pixels that depend on the zoom, the window width, the device pixel ratio and the scroll
 *   position at the instant of the call, and storing any of that is why every v1 highlight is
 *   unrecoverable. The geometry comes from `quadsForRange(block.spans, …)` — the IR's own span
 *   boxes, in IR points — and from nowhere else.
 *
 * So the hook does exactly two things: it turns DOM endpoints into CODE-POINT OFFSETS into an IR
 * block's resolved text, and it hands those offsets to `captureAnchor`, which writes all six
 * selectors at once. Everything geometric downstream of that is the anchoring package's.
 *
 * THE TEXT-LAYER CONTRACT. pdf.js's text layer is a pile of absolutely-positioned <span>s that know
 * nothing about PaperIR. The page component that builds it must stamp each item with:
 *
 *   data-block-id   the IR block the item's glyphs belong to           (REQUIRED for the exact path)
 *   data-cp-start   code-point offset into that block's resolved text  (REQUIRED for the exact path)
 *                   at which THIS item's text begins
 *   data-span-index index into `IndexedBlock.spans`                    (optional; used when
 *                   `data-cp-start` is absent, since `span.start` is a UTF-16 offset we can convert)
 *   data-page-index the page, on any ancestor                          (optional; scopes the fallback)
 *
 * `PdfPage` owns those attributes; the constants below are the shared names so the two files cannot
 * drift apart silently. WHEN THEY ARE ABSENT the hook still works, via `locateByText`: it normalises
 * the selected string and searches the candidate blocks' normalised text for it. THAT PATH IS A
 * LIMITATION, not a design — it picks the FIRST block on the page containing the string, so a phrase
 * that occurs twice on one page ("of the model", "we show that") anchors to the first occurrence.
 * The exact path has no such failure mode. `viaFallback` on the returned selection says which ran,
 * so a caller can warn rather than guess.
 *
 * iOS. There is no reliable mouseup: a selection is a long-press followed by dragging two handles,
 * and the handle drag emits `selectionchange` only. So the hook listens to `selectionchange` with a
 * short debounce (the handles fire it continuously) AND to `pointerup`, which cancels the pending
 * debounce and reconciles immediately. Neither alone is sufficient — `pointerup` alone misses every
 * handle adjustment, and `selectionchange` alone adds the debounce delay to every mouse selection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  captureAnchor,
  extentOf,
  indexOfCodePoints,
  normaliseForMatch,
  quadsForRange,
  toCodePoints,
  type Anchor,
  type IndexedBlock,
  type IndexedDocument,
  type ProvenanceClass,
  type TargetKind,
} from '@papertree/anchoring';
import type { BBox, Polygon } from '@papertree/document-ir';

/** Stamped by `PdfPage` on every text-layer item. Imported there rather than re-typed. */
export const BLOCK_ID_ATTR = 'data-block-id';
export const CP_START_ATTR = 'data-cp-start';
export const SPAN_INDEX_ATTR = 'data-span-index';
export const PAGE_INDEX_ATTR = 'data-page-index';

/**
 * Long enough that an iOS handle drag settles, short enough that a mouse selection feels immediate.
 * `pointerup` short-circuits it for every pointer device that has one, so this delay is only ever
 * paid on the touch path where the user is still holding a handle.
 */
export const DEFAULT_SELECTION_DEBOUNCE_MS = 180;

export interface BlockRange {
  readonly blockId: string;
  /** CODE-POINT offsets into the block's resolved text — `Anchor.offsetUnit` is `'unicode'`. */
  readonly start: number;
  readonly end: number;
}

export interface PendingSelection {
  readonly text: string;
  readonly pageIndex: number;
  readonly ranges: readonly BlockRange[];
  readonly blockIds: readonly string[];
  /**
   * The selection's paintable geometry, IR space. Position the toolbar from THIS and the zoom —
   * never from a DOM rect. Null only when the blocks carry no spans and no bbox.
   */
  readonly irExtent: BBox | null;
  readonly irPolygons: readonly Polygon[];
  /** True when the text-layer attributes were missing and `locateByText` guessed. See the header. */
  readonly viaFallback: boolean;
}

export interface SelectionCapture {
  /** The anchor for the block the selection STARTS in. The one a single-block selection produces. */
  readonly anchor: Anchor;
  /**
   * One anchor per block the selection touches. A selection crossing a paragraph boundary is
   * genuinely more than one target; returning only the first would drop the rest silently, which is
   * the failure mode this epic exists to remove.
   */
  readonly anchors: readonly Anchor[];
  readonly selection: PendingSelection;
}

export interface UseSelectionCaptureOptions {
  /** Null while the IR is still loading; the hook is inert until it arrives. */
  readonly doc: IndexedDocument | null;
  /** The element the text layer lives in. Selections outside it are ignored. */
  readonly root: HTMLElement | null;
  /** Scopes the fallback search. Omit when the root spans several pages. */
  readonly pageIndex?: number;
  readonly client: string;
  readonly newAnchorId?: () => string;
  readonly now?: () => string;
  readonly mode?: 'source' | 'guided';
  readonly provenanceClass?: ProvenanceClass;
  readonly debounceMs?: number;
  readonly onSelectionChange?: (selection: PendingSelection | null) => void;
}

export interface UseSelectionCaptureResult {
  readonly selection: PendingSelection | null;
  /** Build the anchors. Returns null when there is nothing selected. Never throws on a stale DOM. */
  readonly capture: (targetKind?: TargetKind) => SelectionCapture | null;
  /** Drop the pending selection AND collapse the DOM one, so the toolbar goes away with it. */
  readonly clear: () => void;
}

// ─── offsets ────────────────────────────────────────────────────────────────────────────────────

/**
 * Code-point offset → UTF-16 offset, and back.
 *
 * `Span.start` / `Span.end` are UTF-16 offsets into `Block.text`; `Anchor.offsetUnit` is `'unicode'`
 * and everything in `@papertree/anchoring` counts CODE POINTS. The two coincide on all three
 * fixtures (measured: zero astral code points in any `text` field) and diverge the moment a paper
 * contains an emoji, a 𝕄 or a rare CJK ideograph — so the conversion is explicit here for the same
 * reason `capture.ts` makes it explicit rather than assumed.
 */
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

function utf16ToCodePoint(text: string, utf16Offset: number): number {
  let seen = 0;
  let index = 0;
  for (const char of text) {
    if (index >= utf16Offset) return seen;
    index += char.length;
    seen += 1;
  }
  return seen;
}

function countCodePoints(text: string): number {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}

// ─── DOM → block offsets ────────────────────────────────────────────────────────────────────────

function closestElement(node: Node | null): HTMLElement | null {
  if (node === null) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as HTMLElement;
  return node.parentElement;
}

function closestWithAttr(node: Node | null, attr: string): HTMLElement | null {
  return closestElement(node)?.closest(`[${attr}]`) ?? null;
}

/**
 * One endpoint of the DOM range → a (block, code-point offset) pair.
 *
 * The offset is `data-cp-start` plus the code points of the item's own text that precede the
 * endpoint. That preceding text is read with a Range and `toString()` — a TEXT read, which is
 * legitimate and has nothing to do with geometry. `Range.toString()` and not `textContent.slice()`
 * because a text-layer item can contain more than one text node once a browser normalises it.
 */
function endpointToOffset(
  doc: IndexedDocument,
  container: Node,
  offset: number,
): { block: IndexedBlock; codePoint: number } | null {
  const item = closestWithAttr(container, BLOCK_ID_ATTR);
  if (item === null) return null;

  const blockId = item.getAttribute(BLOCK_ID_ATTR);
  if (blockId === null) return null;
  const block = doc.byId.get(blockId);
  if (block === undefined) return null;

  let base: number | null = null;
  const cpStart = item.getAttribute(CP_START_ATTR);
  if (cpStart !== null && cpStart !== '') {
    const parsed = Number.parseInt(cpStart, 10);
    if (Number.isFinite(parsed)) base = parsed;
  }
  if (base === null) {
    // `data-span-index` is the weaker of the two contracts: it locates the RUN, and the run's start
    // is a UTF-16 offset, so it needs the conversion above. Kept because a page component that
    // already knows which span it is rendering gets it for free.
    const spanIndex = item.getAttribute(SPAN_INDEX_ATTR);
    if (spanIndex !== null && spanIndex !== '') {
      const parsed = Number.parseInt(spanIndex, 10);
      const span = Number.isFinite(parsed) ? block.spans[parsed] : undefined;
      if (span !== undefined) base = utf16ToCodePoint(block.text, span.start);
    }
  }
  if (base === null) return null;

  const ownerDocument = item.ownerDocument;
  const prefix = ownerDocument.createRange();
  prefix.setStart(item, 0);
  try {
    prefix.setEnd(container, offset);
  } catch {
    // The endpoint is outside this item — the browser handed us a container the item does not own.
    // Falling back to the item's start is better than throwing away the whole selection.
    return { block, codePoint: Math.min(base, block.textCodePoints.length) };
  }
  const within = countCodePoints(prefix.toString());
  return { block, codePoint: Math.min(base + within, block.textCodePoints.length) };
}

/**
 * THE FALLBACK. Normalised-text search when the text layer carries no attributes.
 *
 * Documented as a limitation in the header and reported as `viaFallback` on the result: it returns
 * the FIRST block whose normalised text contains the normalised selection, so a phrase repeated on
 * one page anchors to its first occurrence. Matching is on `normaliseForMatch` output — the same
 * fold `block_id` and T3 use — so a selection that spans a line-break hyphen ("resid-\nual") still
 * finds "residual", which a raw `indexOf` would not.
 */
function locateByText(
  doc: IndexedDocument,
  pageIndex: number | null,
  selectionText: string,
): BlockRange | null {
  const needle = normaliseForMatch(selectionText).text;
  if (needle.length === 0) return null;
  const needlePoints = toCodePoints(needle);

  const candidates =
    pageIndex === null ? doc.blocks : (doc.byPage.get(pageIndex) ?? doc.blocks);

  for (const block of candidates) {
    // figure / table / unknown blocks have no text at all — 64 of the 199 fixture blocks. Guarding
    // rather than trusting `.length` on an absent field.
    if (block.text.length === 0) continue;
    const normalised = normaliseForMatch(block.text);
    const at = indexOfCodePoints(needlePoints, toCodePoints(normalised.text));
    if (at < 0) continue;
    const start = normalised.rawOffsetAt[at];
    const end = normalised.rawOffsetAt[at + needlePoints.length];
    if (start === undefined || end === undefined) continue;
    return { blockId: block.id, start, end };
  }
  return null;
}

// ─── geometry, from the IR only ─────────────────────────────────────────────────────────────────

/**
 * The IR-space polygons a set of block ranges covers.
 *
 * `quadsForRange` for a sub-range (it clamps the line bands, which the 29 over-tall spans in the
 * corpus need), the block's own polygon for a whole-block or span-less target. This is the SAME
 * function `captureAnchor` uses internally, so the preview the toolbar is positioned against and
 * the geometry the anchor stores cannot disagree.
 */
function geometryForRanges(doc: IndexedDocument, ranges: readonly BlockRange[]): Polygon[] {
  const polygons: Polygon[] = [];
  for (const range of ranges) {
    const block = doc.byId.get(range.blockId);
    if (block === undefined) continue;

    const wholeBlock = range.start <= 0 && range.end >= block.textCodePoints.length;
    if (wholeBlock || block.spans.length === 0) {
      if (block.polygon.length >= 3) polygons.push(block.polygon);
      continue;
    }

    const result = quadsForRange(
      block.spans,
      codePointToUtf16(block.text, range.start),
      codePointToUtf16(block.text, range.end),
    );
    for (const polygon of result.polygons) polygons.push(polygon);
  }
  return polygons;
}

// ─── the reading-order walk between two endpoints ───────────────────────────────────────────────

/**
 * Every block between two endpoints, in READING ORDER, each with its selected sub-range.
 *
 * `IndexedDocument.blocks` is already in reading order and `readingIndex` is the position in it —
 * built from `Page.flows` plus the parent/child walk, NOT from `doc_order`, which is absent on 64
 * of the corpus's 199 blocks and would collapse all of them to position 0.
 */
function rangesBetween(
  doc: IndexedDocument,
  from: { block: IndexedBlock; codePoint: number },
  to: { block: IndexedBlock; codePoint: number },
): BlockRange[] {
  // A backwards selection (dragged right-to-left) hands the endpoints back in DOM order, which is
  // reading order for the text layer — but a user can also select across a float, so order by the
  // IR's own index rather than trusting the DOM.
  const forwards = from.block.readingIndex <= to.block.readingIndex;
  const head = forwards ? from : to;
  const tail = forwards ? to : from;

  if (head.block.id === tail.block.id) {
    const start = Math.min(head.codePoint, tail.codePoint);
    const end = Math.max(head.codePoint, tail.codePoint);
    return start === end ? [] : [{ blockId: head.block.id, start, end }];
  }

  const ranges: BlockRange[] = [];
  for (const block of doc.blocks) {
    if (block.readingIndex < head.block.readingIndex) continue;
    if (block.readingIndex > tail.block.readingIndex) break;
    if (block.text.length === 0) continue;

    const start = block.id === head.block.id ? head.codePoint : 0;
    const end = block.id === tail.block.id ? tail.codePoint : block.textCodePoints.length;
    if (end > start) ranges.push({ blockId: block.id, start, end });
  }
  return ranges;
}

// ─── the hook ───────────────────────────────────────────────────────────────────────────────────

function defaultAnchorId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Non-secure contexts (plain http on a LAN device, which is how the iPad gets tested) have no
  // `randomUUID`. Collision risk is irrelevant here: ids are namespaced per document and local.
  return `anchor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A stable signature, so an unchanged selection does not re-render on every `selectionchange`. */
function signatureOf(selection: PendingSelection | null): string {
  if (selection === null) return '';
  return selection.ranges.map((r) => `${r.blockId}:${String(r.start)}-${String(r.end)}`).join('|');
}

export function useSelectionCapture(
  options: UseSelectionCaptureOptions,
): UseSelectionCaptureResult {
  const {
    doc,
    root,
    pageIndex,
    client,
    newAnchorId = defaultAnchorId,
    now = () => new Date().toISOString(),
    mode = 'source',
    provenanceClass = 'source',
    debounceMs = DEFAULT_SELECTION_DEBOUNCE_MS,
    onSelectionChange,
  } = options;

  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const signatureRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Held in refs so the listeners below can be registered ONCE. Re-subscribing `selectionchange` on
  // every render would drop events mid-drag on iOS, which is the platform this exists for.
  const docRef = useRef(doc);
  docRef.current = doc;
  const rootRef = useRef(root);
  rootRef.current = root;
  const notifyRef = useRef(onSelectionChange);
  notifyRef.current = onSelectionChange;
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;

  const read = useCallback((): PendingSelection | null => {
    const indexed = docRef.current;
    const container = rootRef.current;
    if (indexed === null || container === null) return null;
    if (typeof window === 'undefined') return null;

    const domSelection = window.getSelection();
    if (domSelection === null || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
      return null;
    }
    const range = domSelection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;

    const text = domSelection.toString();
    if (text.trim().length === 0) return null;

    const start = endpointToOffset(indexed, range.startContainer, range.startOffset);
    const end = endpointToOffset(indexed, range.endContainer, range.endOffset);

    let ranges: BlockRange[];
    let viaFallback: boolean;
    if (start !== null && end !== null) {
      ranges = rangesBetween(indexed, start, end);
      viaFallback = false;
    } else {
      const scope =
        pageIndexRef.current ??
        readPageIndexAttr(range.commonAncestorContainer) ??
        null;
      const located = locateByText(indexed, scope, text);
      if (located === null) return null;
      ranges = [located];
      viaFallback = true;
    }
    if (ranges.length === 0) return null;

    const first = ranges[0];
    if (first === undefined) return null;
    const firstBlock = indexed.byId.get(first.blockId);
    if (firstBlock === undefined) return null;

    const polygons = geometryForRanges(indexed, ranges);
    return {
      text,
      pageIndex: firstBlock.pageIndex,
      ranges,
      blockIds: ranges.map((r) => r.blockId),
      irExtent: extentOf(polygons),
      irPolygons: polygons,
      viaFallback,
    };
  }, []);

  const evaluate = useCallback(() => {
    const next = read();
    const signature = signatureOf(next);
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setSelection(next);
    notifyRef.current?.(next);
  }, [read]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const schedule = (delay: number): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        evaluate();
      }, delay);
    };

    // iOS: the handles fire this continuously through the drag, so it is debounced.
    const onSelectionChangeEvent = (): void => schedule(debounceMs);
    // Every pointer device that HAS an up event: reconcile at once and cancel the debounce, so a
    // mouse selection never waits out the delay. Registered on the document rather than the root
    // because a drag frequently ends outside the page element.
    const onPointerUp = (): void => schedule(0);

    document.addEventListener('selectionchange', onSelectionChangeEvent);
    document.addEventListener('pointerup', onPointerUp);
    // A cancelled touch (the system takes over the gesture, or a call arrives) leaves the selection
    // as it was; reconciling keeps the toolbar consistent with what is actually selected.
    document.addEventListener('pointercancel', onPointerUp);

    return () => {
      document.removeEventListener('selectionchange', onSelectionChangeEvent);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [debounceMs, evaluate]);

  const capture = useCallback(
    (targetKind: TargetKind = 'text'): SelectionCapture | null => {
      const indexed = docRef.current;
      const pending = read() ?? selection;
      if (indexed === null || pending === null) return null;

      const at = now();
      const anchors = pending.ranges.map((range) =>
        captureAnchor({
          doc: indexed,
          blockId: range.blockId,
          startOffset: range.start,
          endOffset: range.end,
          targetKind,
          provenanceClass,
          id: newAnchorId(),
          at,
          client,
          mode,
        }),
      );

      const primary = anchors[0];
      if (primary === undefined) return null;
      return { anchor: primary, anchors, selection: pending };
    },
    [client, mode, newAnchorId, now, provenanceClass, read, selection],
  );

  const clear = useCallback(() => {
    if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
    signatureRef.current = '';
    setSelection(null);
    notifyRef.current?.(null);
  }, []);

  return useMemo(() => ({ selection, capture, clear }), [selection, capture, clear]);
}

function readPageIndexAttr(node: Node): number | null {
  const element = closestWithAttr(node, PAGE_INDEX_ATTR);
  if (element === null) return null;
  const raw = element.getAttribute(PAGE_INDEX_ATTR);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
