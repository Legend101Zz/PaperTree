'use client';

/**
 * reader/SourcePane — the paper itself, and the only surface a highlight is born on.
 *
 * THREE THINGS MEET HERE: the IR (blocks and offsets), the text layer (glyphs), and the anchor
 * writer. `onTextLayer` stamps each page's divs with IR blocks and files the page's pdf.js items in
 * a registry the capture hook reads; the hook turns a DOM selection into Anchors; the toolbar hands
 * them to the workspace, which persists them (`useHighlights`) and passes them back to be painted.
 *
 * PAINT IS THE STORED QUADS (`sourcePaint`, contracts.md §6). This pane never paints a block
 * polygon for a user highlight: it paints what the anchor stored, and the ladder's geometry only
 * for a record that stored none. An anchor that can be painted nowhere is the tray's, not this
 * pane's — `unplacedOf` is the same test, so nothing falls between the two.
 *
 * NOT DEPENDENT ON THE IR FOR THE PDF. `doc` may be null (the paper is still being read, /ir is 409):
 * the pages render from pdf.js alone, selectable, and Highlight says why it is not available yet.
 *
 * A CLICK ON HIGHLIGHTED TEXT opens that highlight. The overlay is `pointer-events: none` so it never
 * eats a drag; the click is hit-tested here, against the same stored quads, in IR space.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  frameForPdfPage,
  pageTextStreamId,
  sourcePaint,
  type Anchor,
  type IndexedDocument,
  type Resolution,
} from '@papertree/anchoring';

import { MAX_ANCHORS_PER_HIGHLIGHT } from '@/lib/api/highlights';

import { useReaderActions } from './actions';
import { type DocumentHandle, type DocumentRef } from './documentHandle';
import { HighlightOverlay, hitsItem, type FlashPaint, type PaintItem } from './HighlightOverlay';
import { usePdfDocument } from './PdfDocumentProvider';
import { displayQuote } from './quote';
import type { TextLayerInfo } from './PdfPage';
import { SelectionToolbar } from './SelectionToolbar';
import { stampTextLayer } from './stampTextLayer';
import { tooLongSentence, type ReaderHighlight } from './useHighlights';
import {
  useSelectionCapture,
  type PageTextSource,
  type PendingSelection,
  type SelectionCapture,
} from './useSelectionCapture';
import {
  VirtualPageList,
  type ReadingPosition,
  type VirtualPageListHandle,
} from './VirtualPageList';

export interface SourcePaneProps {
  /** The indexed parse, or null while the paper is still being read (Source still renders). */
  readonly doc: IndexedDocument | null;
  readonly zoom: number;
  /** The reader's highlights, resolved against `doc`. Painted from their stored quads. */
  readonly highlights: readonly ReaderHighlight[];
  /** Highlight was pressed on a selection: persist these anchors (one highlight, N anchors). */
  readonly onCreateHighlight: (capture: SelectionCapture) => void;
  /** Why Highlight is unavailable right now, or null. */
  readonly highlightUnavailableReason: string | null;
  /** A painted highlight was clicked (or Enter was pressed on it). */
  readonly onActivateHighlight: (
    highlightId: string,
    at: { readonly clientX: number; readonly clientY: number; readonly top?: number; readonly bottom?: number } | null,
  ) => void;
  readonly activeHighlightId: string | null;
  /** `focusAnchor`'s 1.2 s flash, when it is on a page. */
  readonly flash: FlashPaint | null;
  /** Below 640 px the toolbar is a bottom bar instead of floating over the page. */
  readonly narrow: boolean;
  /**
   * Forwarded from the scroller so the shell can re-resolve a fit-zoom mode. REQUIRED: optional,
   * the shell once never supplied it and "fit width" clamped to 25 % with no error anywhere.
   */
  readonly onViewportResize: (size: { readonly width: number; readonly height: number }) => void;
  /**
   * The live text selection, reported upward — #77's D6.
   *
   * REQUIRED, deliberately: an optional prop would let the shell silently not supply this, and the
   * Inspector would explain the paper's title whatever was selected.
   */
  readonly onSelectionChange: (selection: PendingSelection | null) => void;
  /** Populated while this pane is mounted, nulled when it unmounts — #64. REQUIRED. */
  readonly documentRef: DocumentRef;
  /** Where to open (contracts.md §5's `{page, yPt}`), applied once when the pages are known. */
  readonly initialPosition: ReadingPosition | null;
  readonly onPositionChange: (position: ReadingPosition) => void;
  /** Said when an action fails (Send to canvas). */
  readonly onNotice?: (message: string) => void;
}

function quoteOf(anchor: Anchor): string {
  return displayQuote([anchor]) || 'highlight';
}

/** Every anchor's Source paint, or its absence. The tray lists exactly the absences. */
export function paintItemsOf(
  doc: IndexedDocument | null,
  highlights: readonly ReaderHighlight[],
): { readonly items: PaintItem[]; readonly unplaced: { anchor: Anchor; resolution: Resolution; highlightId: string }[] } {
  const items: PaintItem[] = [];
  const unplaced: { anchor: Anchor; resolution: Resolution; highlightId: string }[] = [];
  if (doc === null) return { items, unplaced };
  for (const highlight of highlights) {
    for (const { anchor, resolution } of highlight.anchors) {
      const paint = sourcePaint(anchor, doc, resolution);
      if (paint === null) {
        unplaced.push({ anchor, resolution, highlightId: highlight.highlightId });
        continue;
      }
      items.push({
        key: anchor.id,
        highlightId: highlight.highlightId,
        color: highlight.color,
        pageIndex: paint.pageIndex,
        polygons: paint.polygons,
        quads: paint.quads,
        approximate: paint.approximate,
        label: quoteOf(anchor),
        saving: highlight.status === 'saving' || highlight.status === 'unsaved',
      });
    }
  }
  return { items, unplaced };
}

export function SourcePane(props: SourcePaneProps) {
  const { doc, onCreateHighlight, onSelectionChange, onActivateHighlight } = props;
  const actions = useReaderActions();
  const pdf = usePdfDocument();
  const listRef = useRef<VirtualPageListHandle | null>(null);
  // State, not a ref: the hook must re-bind when the scroller mounts.
  const [root, setRoot] = useState<HTMLElement | null>(null);

  /** Each rendered page's pdf.js items, for the capture hook's item geometry. */
  const pages = useRef(new Map<number, PageTextSource>());
  const pageText = useCallback((pageIndex: number) => pages.current.get(pageIndex) ?? null, []);
  const stream = typeof pdf.pdfjsVersion === 'string' ? pageTextStreamId(pdf.pdfjsVersion) : null;

  const { selection, capture, clear } = useSelectionCapture({
    doc,
    root,
    client: 'papertree-web/reader',
    mode: 'source',
    provenanceClass: 'source',
    pageText,
    pageTextStreamId: stream,
  });

  useEffect(() => {
    onSelectionChange(selection);
  }, [selection, onSelectionChange]);

  /**
   * Stamp the text layer and file the page's items as each page renders. Re-runs on every rebuild
   * (every zoom step): the divs are new objects each time, and `stampTextLayer` is idempotent.
   */
  const onTextLayer = useCallback(
    (info: TextLayerInfo) => {
      const userUnit = doc?.pages.find((p) => p.index === info.pageIndex)?.user_unit ?? 1;
      pages.current.set(info.pageIndex, {
        frame: frameForPdfPage({ view: info.page.view, rotate: info.page.rotate, userUnit }),
        items: info.items.map((item) => {
          const style = item.fontName === undefined ? undefined : info.styles[item.fontName];
          return {
            str: item.str,
            transform: item.transform,
            width: item.width,
            height: item.height,
            ...(item.hasEOL === undefined ? {} : { hasEOL: item.hasEOL }),
            ...(style?.ascent === undefined ? {} : { ascent: style.ascent }),
            ...(style?.descent === undefined ? {} : { descent: style.descent }),
          };
        }),
      });
      const blocks = doc?.byPage.get(info.pageIndex) ?? [];
      if (blocks.length === 0) return;
      stampTextLayer({
        divs: info.divs,
        items: info.items,
        page: { view: info.page.view, rotate: info.page.rotate, userUnit },
        blocks,
      });
    },
    [doc],
  );

  const { items } = useMemo(() => paintItemsOf(doc, props.highlights), [doc, props.highlights]);

  // One highlight holds at most 64 anchors (contracts.md §2.4): a longer selection says so in the
  // bar, before anything is sent — the reviewer's 3-page drag was a raw 422 (s4-review.md F2).
  const targetCount = selection?.targets.length ?? 0;
  const unavailable =
    props.highlightUnavailableReason ??
    (targetCount > MAX_ANCHORS_PER_HIGHLIGHT ? tooLongSentence(targetCount) : undefined);

  const onHighlight = useCallback(() => {
    const captured = capture('text');
    if (captured === null) return;
    onCreateHighlight(captured);
    clear();
  }, [capture, clear, onCreateHighlight]);

  const onAsk = useCallback(() => {
    const captured = capture('text');
    if (captured === null) return;
    actions.openExplain({ anchor: captured.anchor, quote: captured.selection.text });
    clear();
  }, [actions, capture, clear]);

  const onNotice = props.onNotice;
  const onSendToCanvas = useCallback(() => {
    const captured = capture('text');
    if (captured === null) return;
    clear();
    actions.sendToCanvas({ kind: 'excerpt', anchor: captured.anchor }).catch(() => {
      onNotice?.("Couldn't send this passage to the canvas. Try again.");
    });
  }, [actions, capture, clear, onNotice]);

  const onCopy = useCallback(() => {
    const text = selection?.text ?? '';
    if (text === '') return;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    clear();
  }, [selection, clear]);

  const documentHandle = useMemo<DocumentHandle>(
    () => ({
      scrollToBlock(blockId) {
        const block = doc?.byId.get(blockId);
        // A stale id resolves to nothing: block ids are content-derived (AGENTS.md §4).
        if (block === undefined) return;
        listRef.current?.scrollToBlock(block.pageIndex, block.bbox, { behavior: 'smooth' });
      },
      scrollToPage(pageIndex) {
        listRef.current?.scrollToPage(pageIndex, { behavior: 'smooth' });
      },
      scrollToRect(pageIndex, bbox) {
        // Instant, not smooth: `focusAnchor` flashes the passage for 1.2 s, and a smooth scroll
        // spends most of that travelling — the flash would play before the passage is on screen.
        listRef.current?.scrollToBlock(pageIndex, bbox, { behavior: 'auto' });
      },
    }),
    [doc],
  );

  // A click (not a drag) on highlighted text opens that highlight. Hit-tested in IR space against
  // the stored quads; the page's own box is the only thing read from the DOM, and only to turn a
  // pointer's client position into a position on the page.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const zoomRef = useRef(props.zoom);
  zoomRef.current = props.zoom;
  useEffect(() => {
    if (root === null) return undefined;
    const onClick = (event: MouseEvent): void => {
      const selected = window.getSelection();
      if (selected !== null && !selected.isCollapsed && selected.toString().trim() !== '') return;
      const target = event.target instanceof Element ? event.target : null;
      const page = target?.closest('.papertree-page[data-page-index]');
      if (!(page instanceof HTMLElement)) return;
      const pageIndex = Number(page.getAttribute('data-page-index'));
      const userUnit = pdf.pageMeta?.get(pageIndex)?.userUnit ?? 1;
      const scale = zoomRef.current * userUnit;
      if (!(scale > 0)) return;
      const rect = page.getBoundingClientRect();
      const x = (event.clientX - rect.left) / scale;
      const y = (event.clientY - rect.top) / scale;
      const hit = [...itemsRef.current]
        .reverse()
        .find((item) => item.pageIndex === pageIndex && hitsItem(item, x, y));
      if (hit === undefined) return;
      // The passage's own top and bottom on screen, so its card opens beside it, not over it.
      const quads = itemsRef.current
        .filter((item) => item.highlightId === hit.highlightId && item.pageIndex === pageIndex)
        .flatMap((item) => item.quads);
      const top = rect.top + Math.min(...quads.map((q) => q[1])) * scale;
      const bottom = rect.top + Math.max(...quads.map((q) => q[3])) * scale;
      onActivateHighlight(hit.highlightId, { clientX: event.clientX, clientY: event.clientY, top, bottom });
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [root, onActivateHighlight, pdf.pageMeta]);

  const toolbarProps = {
    onHighlight,
    onAsk,
    onSendToCanvas,
    onCopy,
    ...(unavailable === undefined ? {} : { highlightDisabledReason: unavailable }),
  };

  if (pdf.error !== null && pdf.error !== undefined) {
    return (
      <div className="pt-state" role="alert">
        <h2 className="pt-state__title">This PDF could not be opened</h2>
        <p className="pt-state__body">
          The file reached the reader but pdf.js could not read it{pdf.error.message ? ` (${pdf.error.message})` : ''}.
          Trying again usually fixes a connection that dropped part-way.
        </p>
        <button type="button" className="pt-btn pt-btn--outline" onClick={pdf.reload}>
          Try again
        </button>
      </div>
    );
  }

  const ready = pdf.pdf !== null && pdf.pdf !== undefined && (pdf.numPages ?? 0) > 0;

  return (
    <div className="relative h-full">
      {ready ? null : (
        <div className="pt-skeleton absolute inset-0 overflow-hidden" role="status" aria-live="polite">
          <span className="pt-sr-only">Opening the PDF…</span>
          <div className="pt-skeleton__page" />
          <div className="pt-skeleton__page" />
        </div>
      )}
      <VirtualPageList
        ref={(handle) => {
          listRef.current = handle;
          // #64: the shell's seam terminates HERE. A ref callback runs during commit, before
          // effects, so the shell can flush a deferred scroll in an effect keyed on `mode`.
          props.documentRef.current = handle === null ? null : documentHandle;
          setRoot(handle?.getScrollElement() ?? null);
        }}
        zoom={props.zoom}
        className="h-full"
        onTextLayer={onTextLayer}
        onViewportResize={props.onViewportResize}
        initialPosition={props.initialPosition}
        onPositionChange={props.onPositionChange}
        renderOverlay={(pageIndex, meta) => (
          <HighlightOverlay
            pageIndex={pageIndex}
            pageWidth={meta.width}
            pageHeight={meta.height}
            userUnit={meta.userUnit}
            zoom={props.zoom}
            items={items}
            activeHighlightId={props.activeHighlightId}
            flash={props.flash}
            onActivate={(highlightId) => onActivateHighlight(highlightId, null)}
          />
        )}
        renderFloating={(geometry) => {
          if (props.narrow || selection === null || selection.irExtent === null) return null;
          const box = geometry.pageBox(selection.pageIndex);
          if (box === null) return null;
          const scale = geometry.irScale(selection.pageIndex);
          const [x0, y0, x1, y1] = selection.irExtent;
          return (
            <SelectionToolbar
              placement={{
                kind: 'float',
                extent: {
                  left: box.left + x0 * scale,
                  top: box.top + y0 * scale,
                  right: box.left + x1 * scale,
                  bottom: box.top + y1 * scale,
                },
                boundsWidth: geometry.contentWidth,
              }}
              {...toolbarProps}
            />
          );
        }}
      />
      {props.narrow && selection !== null ? (
        <SelectionToolbar placement={{ kind: 'sheet' }} {...toolbarProps} />
      ) : null}
    </div>
  );
}
