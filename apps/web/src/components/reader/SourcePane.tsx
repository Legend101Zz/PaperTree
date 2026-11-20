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
 * eats a drag; the click is hit-tested here, against the same stored quads, in IR space, and a press
 * counts as a click by `isHighlightClick` (#176: a hand's few pixels of jitter are not a drag).
 *
 * THE SELECTION TOOLBAR goes where `placeToolbar` says (#203): in the page margin beside the
 * selection, or docked across the top or bottom of the column, never over the selected lines.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { pageTextStreamId, type Anchor, type IndexedDocument } from '@papertree/anchoring';

import { useHighlightClick, useImageSelection, useSelectionToolbar } from '@/features/reader';
import { MAX_ANCHORS_PER_HIGHLIGHT } from '@/lib/api/highlights';

import { type DocumentHandle, type DocumentRef } from './documentHandle';
import { figureMats, type MatRegion } from './figureRegions';
import { FLASH_SCROLL_MS, prefersReducedMotion } from './flash';
import { HighlightOverlay, type FlashPaint } from './HighlightOverlay';
import { PdfErrorState } from './PdfErrorState';
import { usePdfDocument } from './PdfDocumentProvider';
import { pageTextSourceOf } from './pageTextSource';
import type { TextLayerInfo } from './PdfPage';
import { paintItemsOf } from './paintItems';
import { stampTextLayer } from './stampTextLayer';
import { tooLongSentence, type ReaderHighlight } from './useHighlights';
import { useSelectionActions, type NoteAt } from './useSelectionActions';
import { useTextDragToBoard } from './useTextDragToBoard';
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

import type { BBox } from '@papertree/document-ir';

import type { HighlightColor } from '@/lib/api/types';

export interface SourcePaneProps {
  /** The indexed parse, or null while the paper is still being read (Source still renders). */
  readonly doc: IndexedDocument | null;
  readonly zoom: number;
  /** The reader's highlights, resolved against `doc`. Painted from their stored quads. */
  readonly highlights: readonly ReaderHighlight[];
  /**
   * Highlight was pressed on a selection: persist these anchors (one highlight, N anchors), in the
   * colour pressed.
   */
  readonly onCreateHighlight: (capture: SelectionCapture, color?: HighlightColor) => void;
  /**
   * The menu's Note: a highlight with its card open on the note field. Drawn only when given.
   */
  readonly onCreateNote?: (capture: SelectionCapture, at: NoteAt | null) => void;
  /**
   * A picked picture's highlight (v0.3 #348): the same highlight over anchors that need no words.
   * Without it a picture cannot be picked (the image menu would have nothing to keep it with).
   */
  readonly onCreateAnchors?: (anchors: readonly Anchor[], color?: HighlightColor) => void;
  /** A picked picture's Note: the highlight over its region, with its card open on the note. */
  readonly onNoteAnchors?: (anchors: readonly Anchor[], at: NoteAt | null) => void;
  /** The menu's Board beside: open the board next to the paper, on the card just sent (#344). */
  readonly onOpenBoard?: (cardId: string | null) => void;
  /**
   * The 0-based pages on screen, as the reader scrolls (the split view's faint amber edge on the
   * cards whose passage is on the page being read).
   */
  readonly onVisiblePages?: (pages: readonly number[]) => void;
  /** The board is beside the paper (#344): the selection menu always docks. */
  readonly boardBeside?: boolean;
  /** Why Highlight is unavailable right now, or null. */
  readonly highlightUnavailableReason: string | null;
  /** A painted highlight was clicked (or Enter was pressed on it). */
  readonly onActivateHighlight: (
    highlightId: string,
    at: {
      readonly clientX: number;
      readonly clientY: number;
      readonly top?: number;
      readonly bottom?: number;
    } | null,
  ) => void;
  readonly activeHighlightId: string | null;
  /** `focusAnchor`'s 1.2 s flash, when it is on a page. */
  readonly flash: FlashPaint | null;
  /** Below 640 px the toolbar is a bottom bar instead of floating over the page. */
  readonly narrow: boolean;
  /**
   * A bottom sheet (the Contents panel on a phone) is open over the pane: the selection bar waits
   * under it rather than sitting on top of the sheet's last rows. The selection itself is kept.
   */
  readonly sheetOpen?: boolean;
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
  /** Said when an action fails (Send to board). */
  readonly onNotice?: (message: string) => void;
}

/** The pane without a way to keep a picture's highlight never picks one, so this is never called. */
const NOTHING = (): void => undefined;

export { paintItemsOf };

export function SourcePane(props: SourcePaneProps) {
  const { doc, onCreateHighlight, onSelectionChange, onActivateHighlight } = props;
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
      pages.current.set(info.pageIndex, pageTextSourceOf(info, userUnit));
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
  // The figure boxes per page, for the dark and sepia page's mats. Built once per document: a new
  // array on every render would redraw every mat each time.
  const figuresByPage = useMemo(() => {
    const byPage = new Map<number, readonly MatRegion[]>();
    for (const [pageIndex, blocks] of doc?.byPage ?? []) byPage.set(pageIndex, figureMats(blocks));
    return byPage;
  }, [doc]);

  // One highlight holds at most 64 anchors (contracts.md §2.4): a longer selection says so in the
  // bar, before anything is sent — the reviewer's 3-page drag was a raw 422 (s4-review.md F2).
  const targetCount = selection?.targets.length ?? 0;
  const unavailable =
    props.highlightUnavailableReason ??
    (targetCount > MAX_ANCHORS_PER_HIGHLIGHT ? tooLongSentence(targetCount) : undefined);

  // A picked picture (a float, or an area): while it is picked it is the selection the menu acts on,
  // and the words' own Enter and Escape keys stand down, though the words stay for "figure + text".
  const pageMeta = pdf.pageMeta;
  const image = useImageSelection({
    doc: props.onCreateAnchors === undefined ? null : doc,
    root,
    zoom: props.zoom,
    pageOf: (pageIndex) => {
      const meta = pageMeta?.get(pageIndex);
      return meta === undefined
        ? null
        : { width: meta.width, height: meta.height, userUnit: meta.userUnit };
    },
    textSelection: selection,
    captureText: () => capture('text'),
    clearText: clear,
    items,
    boardBeside: props.boardBeside === true,
    currentPage: () => listRef.current?.getVisiblePages().current ?? -1,
    onCreateAnchors: props.onCreateAnchors ?? NOTHING,
    ...(props.onNoteAnchors === undefined ? {} : { onNoteAnchors: props.onNoteAnchors }),
    ...(props.onOpenBoard === undefined ? {} : { onOpenBoard: props.onOpenBoard }),
    ...(props.onNotice === undefined ? {} : { onNotice: props.onNotice }),
    highlightDisabledReason: unavailable,
  });

  const selectionActions = useSelectionActions({
    selection: image.active ? null : selection,
    capture,
    clear,
    root,
    onCreateHighlight,
    ...(props.onCreateNote === undefined ? {} : { onCreateNote: props.onCreateNote }),
    ...(props.onOpenBoard === undefined ? {} : { onOpenBoard: props.onOpenBoard }),
    ...(props.onNotice === undefined ? {} : { onNotice: props.onNotice }),
    highlightDisabledReason: unavailable,
  });

  // The pages on screen are the board beside's business only (the faint amber edge): with no board
  // beside, the page list is not asked, and the callback is one stable function, not a new closure
  // per render (the list republishes its visible pages whenever the callback changes).
  const reportPages = props.onVisiblePages;
  const besideOpen = props.boardBeside === true;
  const onVisibleChange = useCallback(
    (visible: { readonly pages: readonly number[] }): void => reportPages?.(visible.pages),
    [reportPages],
  );
  const visibleChange = besideOpen && reportPages !== undefined ? onVisibleChange : undefined;

  // A selection dragged out of the page is a passage in the air: the board beside (the split view,
  // #344) shows where it would land and takes it at the drop. Only when there is a board to take it.
  useTextDragToBoard(root, capture, props.onOpenBoard !== undefined);

  // A settled selection is painted by the overlay as one band per line (#346), on at most two pages
  // (what the capture measures); the native highlight goes transparent meanwhile. Anything else keeps
  // the native wash, which is the fallback where custom paint cannot run.
  const livePaint =
    selection !== null &&
    selection.endPageIndex - selection.pageIndex <= 1 &&
    (selection.irQuads.length > 0 || selection.endQuads.length > 0);
  useEffect(() => {
    if (root === null || !livePaint) return undefined;
    root.setAttribute('data-pt-selpaint', '');
    return () => root.removeAttribute('data-pt-selpaint');
  }, [root, livePaint]);
  const selectionOn = (pageIndex: number): readonly BBox[] | null => {
    if (!livePaint || selection === null) return null;
    if (pageIndex === selection.endPageIndex) return selection.endQuads;
    return pageIndex === selection.pageIndex ? selection.irQuads : null;
  };

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
      scrollToRect(pageIndex, bbox, bottomInset) {
        // A timed tween, not `smooth` (which has no duration): the flash waits exactly this long
        // for the passage to arrive, and does not wait at all when it is already in view.
        const scrolled = listRef.current?.scrollToBlock(pageIndex, bbox, {
          ifNeeded: true,
          durationMs: FLASH_SCROLL_MS,
          ...(bottomInset === undefined ? {} : { bottomInset }),
        });
        return scrolled === true && !prefersReducedMotion() ? FLASH_SCROLL_MS : 0;
      },
    }),
    [doc],
  );

  // A click (not a drag) on highlighted text opens that highlight (#176, `useHighlightClick`).
  useHighlightClick({
    root,
    items,
    zoom: props.zoom,
    userUnitOf: (pageIndex) => pageMeta?.get(pageIndex)?.userUnit ?? 1,
    onActivate: onActivateHighlight,
  });

  const toolbar = useSelectionToolbar({
    selection: image.geometry ?? selection,
    doc,
    narrow: props.narrow,
    sheetOpen: props.sheetOpen === true,
    dockOnly: props.boardBeside === true,
    actions: image.actions ?? selectionActions,
  });

  if (pdf.error !== null && pdf.error !== undefined) {
    return <PdfErrorState errorKind={pdf.errorKind} reload={pdf.reload} />;
  }

  const ready = pdf.pdf !== null && pdf.pdf !== undefined && (pdf.numPages ?? 0) > 0;

  return (
    <div className="relative h-full">
      {ready ? null : (
        <div
          className="pt-skeleton absolute inset-0 overflow-hidden"
          role="status"
          aria-live="polite"
        >
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
        figureRegionsOf={(pageIndex) => figuresByPage.get(pageIndex)}
        onViewportResize={props.onViewportResize}
        {...(visibleChange === undefined ? {} : { onVisibleChange: visibleChange })}
        initialPosition={props.initialPosition}
        onPositionChange={props.onPositionChange}
        renderOverlay={(pageIndex, meta) => (
          <>
            <HighlightOverlay
              pageIndex={pageIndex}
              pageWidth={meta.width}
              pageHeight={meta.height}
              userUnit={meta.userUnit}
              zoom={props.zoom}
              items={items}
              activeHighlightId={props.activeHighlightId}
              flash={props.flash}
              selection={selectionOn(pageIndex)}
              onActivate={(highlightId) => onActivateHighlight(highlightId, null)}
            />
            {image.layer(pageIndex, meta.userUnit)}
          </>
        )}
        renderFloating={(geometry) => <>{toolbar.floating(geometry)}</>}
      />
      {toolbar.dock}
      {toolbar.sheet}
    </div>
  );
}
