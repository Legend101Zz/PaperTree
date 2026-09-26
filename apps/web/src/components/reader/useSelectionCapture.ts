'use client';

/**
 * reader/useSelectionCapture — a DOM text selection becomes one or more Anchor v1 records.
 *
 * THE ONE RULE, because this is the exact line the v1 app crossed:
 *
 *   Range/Selection tell us WHICH characters the user picked. They never tell us WHERE those
 *   characters are. `getClientRects()` is not called here, and must never be: it returns viewport
 *   pixels that depend on the zoom, the window, the device pixel ratio and the scroll position at
 *   the instant of the call. The geometry comes from pdf.js ITEM GEOMETRY — each text item's own
 *   matrix and advance width, in PDF space, through `bridge.ts` (`itemPieceQuads`) — and from
 *   nowhere else.
 *
 * TWO PATHS, chosen per selection (contracts.md §6, ADR-002 §3.3):
 *
 *   IR-STAMPED. Both endpoints fall in text-layer items `stampTextLayer` placed in an IR block
 *   (`data-block-id` + `data-cp-start`). The selection becomes code-point ranges in those blocks,
 *   one anchor PER BLOCK (a selection across a paragraph break is two targets, and dropping the
 *   second silently is the failure this epic exists to remove), each with Block, Page,
 *   TextPosition, TextQuote, Shape and SectionPath selectors and the IR text stream id. The
 *   ShapeSelector's quads are measured from the items the selection covers in that block
 *   (`CaptureInput.quads`), because a live parse's span is a whole line and `quadsForRange`'s
 *   code-point interpolation across it lands points away from the glyphs.
 *
 *   PAGE TEXT. An endpoint falls in an item the IR does not stamp — a table cell, a figure label,
 *   rotated text (ADR-002 §3.3: table cells 2–5 % stamped, figure text 0 %). The selection becomes
 *   item ranges on each page and `capturePageTextAnchor` writes Page + TextQuote (from the page's
 *   own text) + Shape selectors under `pdfjs@<version>/page-text`, with NO Block or Position
 *   selector: those are IR offsets this path does not have.
 *
 * WHAT IS GONE: `locateByText`. It searched the page's blocks for the selected string and took the
 * FIRST block containing it, so "of the model" anchored to its first occurrence on the page. A
 * selection the IR cannot place is now captured from the glyphs the user actually selected.
 *
 * THE TEXT-LAYER CONTRACT. `PdfPage` writes `data-item-index` on every div (its index into the
 * page's `getTextContent()` items), `stampTextLayer` adds `data-block-id` / `data-cp-start` where it
 * can, and `.papertree-page` carries `data-page-index`. The page's items and frame reach this hook
 * through `pageText(pageIndex)`, a registry `SourcePane` fills from `onTextLayer`.
 *
 * iOS. There is no reliable mouseup: a selection is a long-press followed by dragging two handles,
 * and the handle drag emits `selectionchange` only. So the hook listens to `selectionchange` with a
 * short debounce AND to `pointerup`, which cancels the pending debounce and reconciles immediately.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  captureAnchor,
  capturePageTextAnchor,
  itemPieceQuads,
  piecesBetween,
  type Anchor,
  type IndexedDocument,
  type ItemPiece,
  type PageTextEndpoint,
  type PdfTextItemGeometry,
  type ProvenanceClass,
  type TargetKind,
} from '@papertree/anchoring';
import { unionOfLineRects, type BBox, type PageFrame, type Polygon } from '@papertree/document-ir';

import { ITEM_INDEX_ATTR } from './PdfPage';

/** Stamped by `stampTextLayer` on the items it places in an IR block. */
export const BLOCK_ID_ATTR = 'data-block-id';
export const CP_START_ATTR = 'data-cp-start';
export const PAGE_INDEX_ATTR = 'data-page-index';

/**
 * Long enough that an iOS handle drag settles, short enough that a mouse selection feels immediate.
 * `pointerup` short-circuits it for every pointer device that has one.
 */
export const DEFAULT_SELECTION_DEBOUNCE_MS = 180;

/** One page's text as pdf.js read it, and the frame that maps its PDF space to IR space. */
export interface PageTextSource {
  readonly frame: PageFrame;
  readonly items: readonly (PdfTextItemGeometry & { readonly hasEOL?: boolean })[];
}

export interface BlockRange {
  readonly blockId: string;
  /** CODE-POINT offsets into the block's resolved text — `Anchor.offsetUnit` is `'unicode'`. */
  readonly start: number;
  readonly end: number;
}

export interface PageTextRange {
  readonly pageIndex: number;
  readonly start: PageTextEndpoint;
  /** Exclusive. */
  readonly end: PageTextEndpoint;
}

export interface PendingSelection {
  readonly text: string;
  /** The page the selection STARTS on — where the toolbar goes. */
  readonly pageIndex: number;
  /**
   * Which capture path(s) this selection takes. `mixed`: prose the IR stamped AND text it did not
   * (a paragraph dragged into a figure's labels) — one highlight, anchors of both kinds.
   */
  readonly kind: 'ir' | 'page-text' | 'mixed';
  /** IR path: one range per block the browser selected, in the order it selected them. */
  readonly ranges: readonly BlockRange[];
  readonly blockIds: readonly string[];
  /** IR path: the measured quads per block (item geometry). */
  readonly quadsByBlock: ReadonlyMap<string, readonly BBox[]>;
  /** Page-text path: each run of selected items the IR did not stamp. */
  readonly pageTextRanges: readonly PageTextRange[];
  /** The selection's geometry on `pageIndex`, IR space. Position the toolbar from THIS. */
  readonly irExtent: BBox | null;
  readonly irPolygons: readonly Polygon[];
}

export interface SelectionCapture {
  /** The anchor for the first target. The one a single-block selection produces. */
  readonly anchor: Anchor;
  /** One anchor per block (IR path) or per page (page-text path), in reading order. */
  readonly anchors: readonly Anchor[];
  readonly selection: PendingSelection;
}

export interface UseSelectionCaptureOptions {
  /** Null while the IR is still loading; the hook is inert until it arrives. */
  readonly doc: IndexedDocument | null;
  /** The element the text layer lives in. Selections outside it are ignored. */
  readonly root: HTMLElement | null;
  readonly client: string;
  /** The page registry `SourcePane` fills from `onTextLayer`. */
  readonly pageText?: (pageIndex: number) => PageTextSource | null;
  /** `pageTextStreamId(pdfjs.version)`. `null` (pdf.js not loaded yet) disables the page-text path. */
  readonly pageTextStreamId?: string | null;
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

// ─── DOM endpoints → item endpoints ─────────────────────────────────────────────────────────────

function countCodePoints(text: string): number {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}

function closestElement(node: Node | null): Element | null {
  if (node === null) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

/** A selection endpoint, resolved to a text-layer item and a code-point offset inside its text. */
interface ItemEndpoint {
  readonly page: HTMLElement;
  readonly pageIndex: number;
  readonly element: HTMLElement;
  readonly item: number;
  readonly offset: number;
}

function itemIndexOf(element: Element): number | null {
  const raw = element.getAttribute(ITEM_INDEX_ATTR);
  if (raw === null || raw === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function pageOf(element: Element): { page: HTMLElement; pageIndex: number } | null {
  const page = element.closest(`.papertree-page[${PAGE_INDEX_ATTR}]`);
  if (!(page instanceof HTMLElement)) return null;
  const value = Number.parseInt(page.getAttribute(PAGE_INDEX_ATTR) ?? '', 10);
  return Number.isInteger(value) && value >= 0 ? { page, pageIndex: value } : null;
}

function endpointIn(element: HTMLElement, container: Node, offset: number): ItemEndpoint | null {
  const item = itemIndexOf(element);
  const where = pageOf(element);
  if (item === null || where === null) return null;
  const prefix = element.ownerDocument.createRange();
  prefix.setStart(element, 0);
  try {
    prefix.setEnd(container, offset);
  } catch {
    return { ...where, element, item, offset: 0 };
  }
  const length = countCodePoints(element.textContent ?? '');
  return { ...where, element, item, offset: Math.min(length, countCodePoints(prefix.toString())) };
}

/**
 * Where the browser put one end of the selection, as an item endpoint.
 *
 * Usually the container is a text node inside an item's span. A drag that ends in the gap past a
 * line puts it on an ELEMENT instead (the text layer div, with a child index), so the nearest item
 * on the right side of that point is used: the first one at or after it for a start, the last one
 * at or before it for an end.
 */
function toItemEndpoint(
  root: HTMLElement,
  container: Node,
  offset: number,
  edge: 'start' | 'end',
): ItemEndpoint | null {
  const direct = closestElement(container)?.closest(`[${ITEM_INDEX_ATTR}]`);
  if (direct instanceof HTMLElement) return endpointIn(direct, container, offset);

  const point = root.ownerDocument.createRange();
  try {
    point.setStart(container, offset);
  } catch {
    return null;
  }
  point.collapse(true);
  const items = root.querySelectorAll<HTMLElement>(`.papertree-text-layer [${ITEM_INDEX_ATTR}]`);
  if (edge === 'start') {
    for (let i = 0; i < items.length; i += 1) {
      const element = items[i] as HTMLElement;
      if (point.comparePoint(element, 0) >= 0) {
        const at = endpointIn(element, element, 0);
        if (at !== null) return { ...at, offset: 0 };
      }
    }
    return null;
  }
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const element = items[i] as HTMLElement;
    if (point.comparePoint(element, element.childNodes.length) <= 0) {
      const at = endpointIn(element, element, element.childNodes.length);
      if (at !== null) return { ...at, offset: countCodePoints(element.textContent ?? '') };
    }
  }
  return null;
}

// ─── selected items → IR block ranges ───────────────────────────────────────────────────────────

function stampOf(element: Element): { blockId: string; cpStart: number } | null {
  const blockId = element.getAttribute(BLOCK_ID_ATTR);
  const cpStart = Number.parseInt(element.getAttribute(CP_START_ATTR) ?? '', 10);
  if (blockId === null || blockId === '' || !Number.isInteger(cpStart)) return null;
  return { blockId, cpStart };
}

function itemElements(page: HTMLElement): Map<number, HTMLElement> {
  const out = new Map<number, HTMLElement>();
  page.querySelectorAll<HTMLElement>(`[${ITEM_INDEX_ATTR}]`).forEach((element) => {
    const index = itemIndexOf(element);
    if (index !== null) out.set(index, element);
  });
  return out;
}

/**
 * An offset inside an item → an offset inside its IR block. `data-cp-start` is where the item's
 * text begins in the block AFTER its leading whitespace (the stamp matches trimmed text), so the
 * item's own leading spaces are taken off first.
 */
function blockOffset(text: string, cpStart: number, offsetInItem: number): number {
  const leading = countCodePoints(text) - countCodePoints(text.replace(/^\s+/u, ''));
  return cpStart + Math.max(0, offsetInItem - leading);
}

/**
 * THE SELECTION IS WHAT THE BROWSER SELECTED. Walk the selected items (content order, which is the
 * order the browser selects in) and give each one to its IR block, or — when the IR did not stamp
 * it — to a page-text run. Whitespace-only items select no glyph and belong to neither.
 *
 * It used to take the two endpoints' blocks and every block BETWEEN them in the parse's reading
 * order. On YOLO's live parse the title is read after the introduction, so a drag across the
 * abstract painted the title too — text the reader never selected.
 */
function partition(
  doc: IndexedDocument,
  pages: readonly PagePieces[],
): { ranges: BlockRange[]; runs: PageTextRange[] } {
  const ranges: BlockRange[] = [];
  const byBlock = new Map<string, { start: number; end: number; order: number }>();
  const runs: PageTextRange[] = [];
  for (const page of pages) {
    const elements = page.page === null ? new Map<number, HTMLElement>() : itemElements(page.page);
    let run: { first: ItemPiece; last: ItemPiece } | null = null;
    const closeRun = (): void => {
      if (run === null) return;
      runs.push({
        pageIndex: page.pageIndex,
        start: { item: run.first.item, offset: run.first.from },
        end: { item: run.last.item, offset: run.last.to },
      });
      run = null;
    };
    for (const piece of page.pieces) {
      const element = elements.get(piece.item);
      const text = element?.textContent ?? page.source.items[piece.item]?.str ?? '';
      if (text.trim() === '') continue;
      const stamp = element === undefined ? null : stampOf(element);
      const block = stamp === null ? undefined : doc.byId.get(stamp.blockId);
      if (stamp === null || block === undefined) {
        run = run === null ? { first: piece, last: piece } : { first: run.first, last: piece };
        continue;
      }
      closeRun();
      const length = block.textCodePoints.length;
      const from = Math.min(length, blockOffset(text, stamp.cpStart, piece.from));
      const to = Math.min(length, blockOffset(text, stamp.cpStart, piece.to));
      const seen = byBlock.get(block.id);
      if (seen === undefined) byBlock.set(block.id, { start: from, end: to, order: byBlock.size });
      else byBlock.set(block.id, { start: Math.min(seen.start, from), end: Math.max(seen.end, to), order: seen.order });
    }
    closeRun();
  }
  Array.from(byBlock.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .forEach(([blockId, range]) => {
      if (range.end > range.start) ranges.push({ blockId, start: range.start, end: range.end });
    });
  return { ranges, runs };
}

// ─── pieces per page ────────────────────────────────────────────────────────────────────────────

interface PagePieces {
  readonly pageIndex: number;
  readonly page: HTMLElement | null;
  readonly source: PageTextSource;
  readonly start: PageTextEndpoint;
  readonly end: PageTextEndpoint;
  readonly pieces: readonly ItemPiece[];
}

function piecesPerPage(
  root: HTMLElement,
  start: ItemEndpoint,
  end: ItemEndpoint,
  pageText: (pageIndex: number) => PageTextSource | null,
): PagePieces[] | null {
  const [first, last] =
    start.pageIndex <= end.pageIndex ? [start, end] : [end, start];
  const out: PagePieces[] = [];
  for (let pageIndex = first.pageIndex; pageIndex <= last.pageIndex; pageIndex += 1) {
    const source = pageText(pageIndex);
    if (source === null || source.items.length === 0) return null;
    const lastItem = source.items.length - 1;
    const s: PageTextEndpoint =
      pageIndex === first.pageIndex ? { item: first.item, offset: first.offset } : { item: 0, offset: 0 };
    const e: PageTextEndpoint =
      pageIndex === last.pageIndex
        ? { item: last.item, offset: last.offset }
        : { item: lastItem, offset: countCodePoints(source.items[lastItem]?.str ?? '') };
    // Within one page a backwards drag hands back the endpoints in DOM order already; guard anyway.
    const [a, b] =
      s.item < e.item || (s.item === e.item && s.offset <= e.offset) ? [s, e] : [e, s];
    const page =
      root.querySelector<HTMLElement>(`.papertree-page[${PAGE_INDEX_ATTR}="${String(pageIndex)}"]`) ??
      null;
    out.push({ pageIndex, page, source, start: a, end: b, pieces: piecesBetween(source.items, a, b) });
  }
  return out;
}

/**
 * The IR block each selected piece belongs to: the item's own stamp, or — for an item the IR did
 * not stamp inside a stamped run (an inline symbol, a space) — the nearest stamped item before it.
 */
function quadsPerBlock(pages: readonly PagePieces[]): Map<string, BBox[]> {
  const out = new Map<string, BBox[]>();
  for (const page of pages) {
    const elements = page.page === null ? new Map<number, HTMLElement>() : itemElements(page.page);
    const byBlock = new Map<string, ItemPiece[]>();
    let current: string | null = null;
    for (const piece of page.pieces) {
      const element = elements.get(piece.item);
      const stamp = element === undefined ? null : element.getAttribute(BLOCK_ID_ATTR);
      if (stamp !== null && stamp !== '') current = stamp;
      if (current === null) continue;
      const bucket = byBlock.get(current);
      if (bucket === undefined) byBlock.set(current, [piece]);
      else bucket.push(piece);
    }
    byBlock.forEach((pieces, blockId) => {
      const quads = itemPieceQuads(page.source.frame, page.source.items, pieces);
      out.set(blockId, [...(out.get(blockId) ?? []), ...quads]);
    });
  }
  return out;
}

function extent(quads: readonly BBox[]): BBox | null {
  if (quads.length === 0) return null;
  return [
    Math.min(...quads.map((q) => q[0])),
    Math.min(...quads.map((q) => q[1])),
    Math.max(...quads.map((q) => q[2])),
    Math.max(...quads.map((q) => q[3])),
  ];
}

// ─── the hook ───────────────────────────────────────────────────────────────────────────────────

function defaultAnchorId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Non-secure contexts (plain http on a LAN device) have no `randomUUID`. A v4-shaped id from
  // `getRandomValues`, so the server's id rule (a UUID or a prefixed id) still holds.
  const bytes = new Uint8Array(16);
  cryptoObj?.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A stable signature, so an unchanged selection does not re-render on every `selectionchange`. */
function signatureOf(selection: PendingSelection | null): string {
  if (selection === null) return '';
  const ir = selection.ranges.map((r) => `${r.blockId}:${String(r.start)}-${String(r.end)}`).join('|');
  return `${ir}#` + selection.pageTextRanges
    .map(
      (r) =>
        `p${String(r.pageIndex)}:${String(r.start.item)}.${String(r.start.offset)}-` +
        `${String(r.end.item)}.${String(r.end.offset)}`,
    )
    .join('|');
}

export function useSelectionCapture(options: UseSelectionCaptureOptions): UseSelectionCaptureResult {
  const {
    doc,
    root,
    client,
    pageText,
    pageTextStreamId = null,
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
  const pageTextRef = useRef(pageText);
  pageTextRef.current = pageText;
  const streamRef = useRef(pageTextStreamId);
  streamRef.current = pageTextStreamId;

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

    const start = toItemEndpoint(container, range.startContainer, range.startOffset, 'start');
    const end = toItemEndpoint(container, range.endContainer, range.endOffset, 'end');
    if (start === null || end === null) return null;

    const lookup = pageTextRef.current ?? (() => null);
    const pages = piecesPerPage(container, start, end, lookup);
    if (pages === null) return null;

    const { ranges, runs } = partition(indexed, pages);
    // A run the IR did not stamp needs pdf.js's version for its text stream id; until pdf.js has
    // loaded there is nothing honest to capture it under, so it is left out rather than guessed.
    const pageTextRuns = streamRef.current === null ? [] : runs;
    if (ranges.length === 0 && pageTextRuns.length === 0) return null;

    const quadsByBlock = quadsPerBlock(pages);
    const firstPageIndex = pages[0]?.pageIndex ?? start.pageIndex;
    const firstPage = pages[0];
    const onFirstPage: BBox[] = [];
    for (const range of ranges) {
      if (indexed.byId.get(range.blockId)?.pageIndex === firstPageIndex) {
        onFirstPage.push(...(quadsByBlock.get(range.blockId) ?? []));
      }
    }
    if (firstPage !== undefined) {
      for (const run of pageTextRuns) {
        if (run.pageIndex !== firstPageIndex) continue;
        onFirstPage.push(
          ...itemPieceQuads(firstPage.source.frame, firstPage.source.items, piecesBetween(firstPage.source.items, run.start, run.end)),
        );
      }
    }
    return {
      text,
      pageIndex: firstPageIndex,
      kind: pageTextRuns.length === 0 ? 'ir' : ranges.length === 0 ? 'page-text' : 'mixed',
      ranges,
      blockIds: ranges.map((r) => r.blockId),
      quadsByBlock,
      pageTextRanges: pageTextRuns,
      irExtent: extent(onFirstPage),
      irPolygons: unionOfLineRects(onFirstPage),
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
    // Every pointer device that HAS an up event: reconcile at once. Registered on the document
    // because a drag frequently ends outside the page element.
    const onPointerUp = (): void => schedule(0);

    document.addEventListener('selectionchange', onSelectionChangeEvent);
    document.addEventListener('pointerup', onPointerUp);
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

      const anchors: Anchor[] = pending.ranges.map((range) =>
        captureAnchor({
          doc: indexed,
          blockId: range.blockId,
          startOffset: range.start,
          endOffset: range.end,
          // A table cell is a table-cell target whichever path captured it (contracts.md §6).
          targetKind: indexed.byId.get(range.blockId)?.type === 'table_cell' ? 'table_cell' : targetKind,
          provenanceClass,
          id: newAnchorId(),
          at,
          client,
          mode,
          quads: pending.quadsByBlock.get(range.blockId) ?? [],
        }),
      );
      const stream = streamRef.current;
      const lookup = pageTextRef.current;
      if (pending.pageTextRanges.length > 0 && stream !== null && lookup !== undefined) {
        for (const range of pending.pageTextRanges) {
          const source = lookup(range.pageIndex);
          if (source === null) continue;
          const anchor = capturePageTextAnchor({
            doc: indexed,
            pageIndex: range.pageIndex,
            frame: source.frame,
            items: source.items,
            start: range.start,
            end: range.end,
            textStreamId: stream,
            id: newAnchorId(),
            at,
            client,
            mode,
            provenanceClass,
          });
          if (anchor !== null) anchors.push(anchor);
        }
      }

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
