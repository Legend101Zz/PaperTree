'use client';

/**
 * The reader workspace — the composition layer for Source / Guided / Split.
 *
 * THE ORGANISING RULE (IA §18.2): **one document, one navigator, one inspector, one transport.**
 * The paper is the only permanent object on screen; everything else is summoned, does its job and
 * leaves.
 *
 * WHAT S4 CHANGED HERE, each one a defect the baseline walk reproduced (journey-baseline §B):
 *
 *   ONE PDF PER SESSION. `PdfDocumentProvider` used to live inside `SourcePane`, so a mode switch
 *   unmounted it and the remount re-opened an `ArrayBuffer` pdf.js had already transferred to its
 *   worker: an uploaded paper went blank after Source → Guided → Source. The provider is now mounted
 *   HERE, above every mode, and opens a copy of the bytes (`getDocumentCalls()` counts the opens).
 *
 *   HIGHLIGHTS PERSIST (#138). `useHighlights` owns them: GET on open, POST per selection with all
 *   its anchors, PATCH colour/note, DELETE, PUT resolutions. Source paints each one's STORED quads;
 *   an anchor painted nowhere goes to the unanchored tray with its reason.
 *
 *   THE READING POSITION IS KEPT (#132): `{v, mode, zoomMode, page, yPt, blockId}` per paper under
 *   `papertree/reader/<paper_id>` (contracts.md §5), in try/catch because it is a convenience. A
 *   zoom keeps the top line (`VirtualPageList`), a mode switch keeps the block, a reload keeps both.
 *
 *   `focusAnchor` IS REAL (contracts.md §5/§6): resolve, scroll the passage into view if it is not,
 *   and run the citation flash (`reader/flash`). The explain panel's markers and trace (#202) and
 *   the canvas's "open source" (S7) call it.
 *
 * WHERE THE PIECES LIVE: this file only composes. The saved place, the loads, the position, the
 * flash/scroll, the highlight actions and the board-beside wiring are hooks in `features/reader` and
 * `features/split`; the regions are `features/reader/components`.
 *
 *   DESIGNED STATES: opening, still being read (Source works from the PDF alone, and the reader
 *   retries on its own), not in your library, unreachable, a PDF pdf.js cannot open.
 */

import { useCallback, useMemo, useState } from 'react';

import type { PendingSelection } from '@/components/reader/useSelectionCapture';
import { useHighlights } from '@/components/reader/useHighlights';
import { PdfDocumentProvider } from '@/components/reader/PdfDocumentProvider';
import { ReaderToast } from '@/components/reader/ReaderToast';
import { resolveZoom, type ZoomMode } from '@/components/reader/ZoomControl';
import { HighlightUndoToast } from '@/features/highlights';
import {
  defaultZoomMode,
  readSavedReaderState,
  useFocusAnchor,
  useFocusFromUrl,
  useHighlightActions,
  useMediaQuery,
  usePaperSource,
  useReadingPosition,
  type ReadingMode,
} from '@/features/reader';
import { HighlightCardSlot } from '@/features/reader/components/HighlightCardSlot';
import { ReaderActionsMount } from '@/features/reader/components/ReaderActionsMount';
import { ReaderState } from '@/features/reader/components/ReaderState';
import { ReaderWorkspaceView } from '@/features/reader/components/ReaderWorkspaceView';
import { useBoardBesideWiring } from '@/features/split';
import { paperRefKey, readerStorageKey, type PaperRef } from '@/lib/paperSource';

export interface ReaderWorkspaceProps {
  /** A fixture slug or a real `paper_id`, already resolved by the route. */
  readonly paper: PaperRef;
}

export function ReaderWorkspace({ paper: given }: ReaderWorkspaceProps) {
  const paperKey = paperRefKey(given);
  // The route builds a new `PaperRef` every render; the paper is its KEY. Keying the loads on the
  // object would refetch the PDF on every render and re-open it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paper = useMemo(() => given, [paperKey]);
  const storageKey = readerStorageKey(paper);
  const [saved] = useState(() =>
    typeof window === 'undefined' ? null : readSavedReaderState(storageKey),
  );

  const { pdfSource, pdfFailure, doc, docFailure, retryDoc, retryPdf } = usePaperSource(paper);

  const [requestedMode, setMode] = useState<ReadingMode>(saved?.mode ?? 'source');
  const [zoomMode, setZoomMode] = useState<ZoomMode>(() => saved?.zoomMode ?? defaultZoomMode());
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [followBlockId, setFollowBlockId] = useState<string | null>(null);
  // Guided's page for the header's "p. 2 of 15" (#203): the page of its top paragraph, kept in step
  // by Source. Source and Split show the page filling most of the view (`PageCounter`); before
  // either reports, the saved place, or the first page.
  const [topPage, setTopPage] = useState<number>(saved?.page ?? 0);
  const narrow = useMediaQuery('(max-width: 639px)');

  const { beside, visiblePages, onVisiblePages, onOpenBoard } = useBoardBesideWiring(paper);

  // Guided and Split need the parse; until it is here the reader stays in Source. With the board
  // beside, the reader's own Split (Source | Guided) steps aside: the word is the board's.
  const mode: ReadingMode =
    doc === null || (beside.open && requestedMode === 'split') ? 'source' : requestedMode;

  const highlights = useHighlights({ paper, doc, onNotice: setNotice });
  const { documentRef, requestScroll, focusAnchor, flash, guidedFlash } = useFocusAnchor(doc, mode);
  const position = useReadingPosition({
    paper,
    doc,
    storageKey,
    saved,
    mode,
    requestedMode,
    zoomMode,
    requestScroll,
    onTopPage: setTopPage,
    onFollowBlock: setFollowBlockId,
  });

  /** "Show source" — the return path every derived surface owes (IA §18.6). */
  const showSource = useCallback(
    (blockIds: readonly string[]) => {
      const first = blockIds[0];
      if (first === undefined) return;
      setMode((current) => (current === 'guided' ? (narrow ? 'source' : 'split') : current));
      requestScroll({ kind: 'block', blockId: first });
    },
    [requestScroll, narrow],
  );

  const jumpToPage = useCallback(
    (pageIndex: number) => {
      setMode((current) => (current === 'guided' ? 'source' : current));
      requestScroll({ kind: 'page', pageIndex });
    },
    [requestScroll],
  );

  const focusHighlight = useCallback(
    (highlightId: string) => {
      const target = highlights.highlights.find((h) => h.highlightId === highlightId);
      const first = target?.anchors[0];
      if (first === undefined) return;
      if (narrow) setNavigatorOpen(false);
      focusAnchor(first.anchor);
    },
    [highlights.highlights, focusAnchor, narrow],
  );

  useFocusFromUrl(paper, doc !== null, focusAnchor, jumpToPage);

  const actions = useHighlightActions(highlights);

  const zoom =
    doc === null && viewport.width === 0
      ? 1
      : resolveZoom(zoomMode, {
          pageWidth: doc?.pages[0]?.width ?? 612,
          pageHeight: doc?.pages[0]?.height ?? 792,
          userUnit: doc?.pages[0]?.user_unit ?? 1,
          containerWidth: viewport.width,
          containerHeight: viewport.height,
        });

  // ── the states before there is anything to read ──
  if (docFailure?.kind === 'not_found' || pdfFailure?.kind === 'not_found') {
    return (
      <ReaderState
        title="This paper is not in your library"
        body="It may have been deleted, or the link is for another account."
        action={
          <a className="pt-btn pt-btn--primary" href="/dashboard">
            Back to your library
          </a>
        }
      />
    );
  }
  if (docFailure?.kind === 'not_parsed' && (pdfFailure !== null || pdfSource === null)) {
    return (
      <ReaderState
        title="Still reading this paper"
        body="PaperTree is working through the PDF. The reader opens it here on its own as soon as it is ready."
        busy
        action={
          <a className="pt-btn pt-btn--outline" href="/dashboard">
            Back to your library
          </a>
        }
      />
    );
  }
  const unreachable =
    docFailure?.kind === 'unreachable' && (pdfFailure !== null || pdfSource === null);
  const hardError = docFailure?.kind === 'error' && (pdfFailure !== null || pdfSource === null);
  if (unreachable || hardError) {
    return (
      <ReaderState
        title={unreachable ? 'PaperTree is not reachable' : 'This paper could not be opened'}
        body={
          unreachable
            ? 'The reader could not reach the PaperTree service. Check the connection, then try again.'
            : docFailure?.kind === 'error' && !docFailure.retryable
              ? 'PaperTree could not prepare this paper for reading. Go back to your library and open it again; if it keeps happening, upload the PDF again.'
              : 'PaperTree had a problem opening this paper. Try again in a moment.'
        }
        action={
          docFailure?.kind === 'error' && !docFailure.retryable ? (
            <a className="pt-btn pt-btn--primary" href="/dashboard">
              Back to your library
            </a>
          ) : (
            <button
              type="button"
              className="pt-btn pt-btn--primary"
              onClick={() => {
                retryDoc();
                retryPdf();
              }}
            >
              Try again
            </button>
          )
        }
      />
    );
  }

  return (
    <PdfDocumentProvider src={pdfSource}>
      <ReaderActionsMount
        paper={paper}
        onFocusAnchor={focusAnchor}
        beside={beside}
        visiblePages={visiblePages}
        onNotice={setNotice}
      >
        <ReaderWorkspaceView
          doc={doc}
          paper={paper}
          page={topPage}
          mode={mode}
          onModeChange={setMode}
          zoom={zoom}
          zoomMode={zoomMode}
          onZoomChange={setZoomMode}
          onViewportResize={setViewport}
          navigatorOpen={navigatorOpen}
          onNavigatorToggle={() => setNavigatorOpen((open) => !open)}
          highlights={highlights}
          onCreateHighlight={actions.onCreateHighlight}
          onCreateNote={actions.onCreateNote}
          onCreateAnchors={actions.onCreateAnchors}
          onNoteAnchors={actions.onNoteAnchors}
          onOpenBoard={onOpenBoard}
          onVisiblePages={onVisiblePages}
          beside={beside}
          onActivateHighlight={actions.onActivateHighlight}
          activeHighlightId={actions.card?.highlightId ?? null}
          flash={flash}
          guidedFlash={guidedFlash}
          followBlockId={followBlockId}
          onShowSource={showSource}
          documentRef={documentRef}
          pdfFailure={pdfFailure}
          onRetryPdf={retryPdf}
          stillReading={docFailure?.kind === 'not_parsed'}
          onJumpToPage={jumpToPage}
          selection={selection}
          onSelectionChange={setSelection}
          initialPosition={position.initialPosition}
          initialBlockId={position.initialBlockId}
          onSourcePosition={position.onSourcePosition}
          onGuidedTop={position.onGuidedTop}
          onFocusHighlight={focusHighlight}
          narrow={narrow}
          onNotice={setNotice}
        />
        {actions.card === null ? null : (
          <HighlightCardSlot
            highlights={highlights}
            card={actions.card}
            onClose={actions.closeCard}
            onColor={actions.rememberColor}
          />
        )}
        <ReaderToast message={notice} onDismiss={() => setNotice(null)} />
        <HighlightUndoToast highlights={highlights} />
      </ReaderActionsMount>
    </PdfDocumentProvider>
  );
}
