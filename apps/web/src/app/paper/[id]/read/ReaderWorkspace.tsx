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
 *   `focusAnchor` IS REAL (contracts.md §5/§6): resolve, scroll the passage into view, flash it for
 *   1.2 s. The explain panel's citation chips (S6) and the canvas's "open source" (S7) call it.
 *
 *   DESIGNED STATES: opening, still being read (Source works from the PDF alone, and the reader
 *   retries on its own), not in your library, unreachable, a PDF pdf.js cannot open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  extentOf,
  resolveAnchor,
  sourcePaint,
  type Anchor,
  type IndexedDocument,
} from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

import {
  createFixtureAnswerSource,
  createLiveAnswerSource,
  Inspector,
} from '@/components/inspector';
import type { InspectorContext } from '@/components/inspector/types';
import { sendToCanvas } from '@/components/canvas/sendToCanvas';
import { ExplainPanel } from '@/components/explain';
import { useExplainActions } from '@/components/explain/useExplainActions';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import { GuidedView } from '@/components/reader/GuidedView';
import { HighlightCard } from '@/components/reader/HighlightCard';
import type { FlashPaint } from '@/components/reader/HighlightOverlay';
import { ModeSwitch } from '@/components/reader/ModeSwitch';
import { Navigator, type NavigatorHighlight } from '@/components/reader/Navigator';
import { PageThumbnail } from '@/components/reader/PageThumbnail';
import { PdfDocumentProvider, usePdfDocument } from '@/components/reader/PdfDocumentProvider';
import { ReaderToast } from '@/components/reader/ReaderToast';
import { paintItemsOf, SourcePane } from '@/components/reader/SourcePane';
import { SplitView } from '@/components/reader/SplitView';
import { UnanchoredTray } from '@/components/reader/UnanchoredTray';
import { useHighlights, type ReaderHighlight, type UseHighlights } from '@/components/reader/useHighlights';
import type { PendingSelection, SelectionCapture } from '@/components/reader/useSelectionCapture';
import { displayQuote } from '@/components/reader/quote';
import type { ReadingPosition } from '@/components/reader/VirtualPageList';
import { FIT_WIDTH, resolveZoom, ZoomControl, type ZoomMode } from '@/components/reader/ZoomControl';
import {
  applyScroll,
  type DocumentHandle,
  type DocumentRef,
  type PendingScroll,
} from '@/components/reader/documentHandle';
import { NetworkError } from '@/lib/api/client';
import { ApiError, type HighlightColor } from '@/lib/api/types';
import {
  loadDocument,
  paperRefKey,
  pdfSourceFor,
  readerStorageKey,
  type PaperRef,
} from '@/lib/paperSource';

export type ReadingMode = 'source' | 'guided' | 'split';

export interface ReaderWorkspaceProps {
  /** A fixture slug or a real `paper_id`, already resolved by the route. */
  readonly paper: PaperRef;
}

// ─── the saved reading state (contracts.md §5) ────────────────────────────────────────────────

interface SavedReaderState {
  readonly v: 1;
  readonly mode: ReadingMode;
  readonly zoomMode: ZoomMode;
  readonly page: number;
  readonly yPt: number;
  readonly blockId?: string;
}

function isZoomMode(value: unknown): value is ZoomMode {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'fit-width' || kind === 'fit-page') return true;
  const scale = (value as { scale?: unknown }).scale;
  return kind === 'scale' && typeof scale === 'number' && Number.isFinite(scale) && scale > 0;
}

export function readSavedReaderState(key: string): SavedReaderState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<SavedReaderState>;
    if (value.v !== 1) return null;
    if (value.mode !== 'source' && value.mode !== 'guided' && value.mode !== 'split') return null;
    if (!isZoomMode(value.zoomMode)) return null;
    if (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 0) return null;
    if (typeof value.yPt !== 'number' || !Number.isFinite(value.yPt) || value.yPt < 0) return null;
    return {
      v: 1,
      mode: value.mode,
      zoomMode: value.zoomMode,
      page: value.page,
      yPt: value.yPt,
      ...(typeof value.blockId === 'string' && value.blockId !== '' ? { blockId: value.blockId } : {}),
    };
  } catch {
    // Private mode, blocked storage, a corrupt entry: the paper opens at the top. Never a crash.
    return null;
  }
}

function writeSavedReaderState(key: string, state: SavedReaderState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the position is a convenience, not data.
  }
}

/** Phones and narrow windows open fit-width; wider screens at a comfortable 125 %. */
function defaultZoomMode(): ZoomMode {
  if (typeof window === 'undefined') return { kind: 'scale', scale: 1 };
  return window.innerWidth < 768 ? FIT_WIDTH : { kind: 'scale', scale: 1.25 };
}

/** The first block in reading order still visible at the top of `position` — the Guided link. */
export function topBlockAt(doc: IndexedDocument, position: ReadingPosition): string | undefined {
  const blocks = (doc.byPage.get(position.page) ?? [])
    .filter((block) => block.text.trim().length > 0 && block.bbox[3] > position.yPt + 2)
    .sort((a, b) => a.readingIndex - b.readingIndex);
  return blocks[0]?.id;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// ─── failures, as states a reader can act on ──────────────────────────────────────────────────

/**
 * Every failure is a state with a designed sentence. The server's `detail` and an exception's
 * `message` are developer text ("validation_failed", a stack's first line) and are never shown
 * (s4-review.md F7); `retryable` says whether "Try again" can help.
 */
type Failure =
  | { readonly kind: 'not_parsed' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'error'; readonly retryable: boolean };

function failureOf(error: unknown): Failure {
  if (error instanceof NetworkError) return { kind: 'unreachable' };
  if (error instanceof ApiError) {
    if (error.code === 'not_parsed' || error.status === 409) return { kind: 'not_parsed' };
    if (error.status === 404) return { kind: 'not_found' };
    return { kind: 'error', retryable: error.retryable || error.status >= 500 };
  }
  return { kind: 'error', retryable: true };
}

/** Where a highlight's card opens from: the click, and the passage's top and bottom, client px. */
type CardAt = { readonly clientX: number; readonly clientY: number; readonly top?: number; readonly bottom?: number };

/** While a paper is still being read, try again this often. */
const RETRY_MS = 4000;
const FLASH_MS = 1200;

export function ReaderWorkspace({ paper: given }: ReaderWorkspaceProps) {
  const paperKey = paperRefKey(given);
  // The route builds a new `PaperRef` every render; the paper is its KEY. Keying the loads on the
  // object would refetch the PDF on every render and re-open it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paper = useMemo(() => given, [paperKey]);
  const storageKey = readerStorageKey(paper);
  const [saved] = useState(() => (typeof window === 'undefined' ? null : readSavedReaderState(storageKey)));

  const [pdfSource, setPdfSource] = useState<string | ArrayBuffer | null>(null);
  const [pdfFailure, setPdfFailure] = useState<Failure | null>(null);
  const [doc, setDoc] = useState<IndexedDocument | null>(null);
  const [docFailure, setDocFailure] = useState<Failure | null>(null);
  const [docAttempt, setDocAttempt] = useState(0);
  const [pdfAttempt, setPdfAttempt] = useState(0);

  const [requestedMode, setMode] = useState<ReadingMode>(saved?.mode ?? 'source');
  const [zoomMode, setZoomMode] = useState<ZoomMode>(() => saved?.zoomMode ?? defaultZoomMode());
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [card, setCard] = useState<{ highlightId: string; at: CardAt | null } | null>(null);
  const [flash, setFlash] = useState<FlashPaint | null>(null);
  const [guidedFlash, setGuidedFlash] = useState<string | null>(null);
  const [followBlockId, setFollowBlockId] = useState<string | null>(null);
  const narrow = useMediaQuery('(max-width: 639px)');

  // Guided and Split need the parse; until it is here the reader stays in Source.
  const mode: ReadingMode = doc === null ? 'source' : requestedMode;

  // ── the document and the PDF, loaded independently ──
  useEffect(() => {
    let cancelled = false;
    loadDocument(paper).then(
      (indexed) => {
        if (cancelled) return;
        setDoc(indexed);
        setDocFailure(null);
      },
      (error: unknown) => {
        if (!cancelled) setDocFailure(failureOf(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [paper, docAttempt]);

  useEffect(() => {
    let cancelled = false;
    pdfSourceFor(paper).then(
      (source) => {
        if (cancelled) return;
        setPdfSource(source);
        setPdfFailure(null);
      },
      (error: unknown) => {
        if (!cancelled) setPdfFailure(failureOf(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [paper, pdfAttempt]);

  // Still being read: try again on our own, so the reader need not reload.
  useEffect(() => {
    const waiting = docFailure?.kind === 'not_parsed' || pdfFailure?.kind === 'not_parsed';
    if (!waiting) return undefined;
    const timer = setTimeout(() => {
      if (docFailure?.kind === 'not_parsed') setDocAttempt((n) => n + 1);
      if (pdfFailure?.kind === 'not_parsed') setPdfAttempt((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [docFailure, pdfFailure]);

  const highlights = useHighlights({ paper, doc, onNotice: setNotice });

  // ── the reading position ──
  const positionRef = useRef<SavedReaderState | null>(saved);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const zoomModeRef = useRef(zoomMode);
  zoomModeRef.current = zoomMode;

  const persist = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const at = positionRef.current;
      writeSavedReaderState(storageKey, {
        v: 1,
        mode: modeRef.current,
        zoomMode: zoomModeRef.current,
        page: at?.page ?? 0,
        yPt: at?.yPt ?? 0,
        ...(at?.blockId === undefined ? {} : { blockId: at.blockId }),
      });
    }, 250);
  }, [storageKey]);

  useEffect(() => {
    persist();
  }, [requestedMode, zoomMode, persist]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    },
    [],
  );

  const onSourcePosition = useCallback(
    (position: ReadingPosition) => {
      const blockId = doc === null ? undefined : topBlockAt(doc, position);
      positionRef.current = {
        v: 1,
        mode: modeRef.current,
        zoomMode: zoomModeRef.current,
        page: position.page,
        yPt: position.yPt,
        ...(blockId === undefined ? {} : { blockId }),
      };
      if (modeRef.current === 'split' && blockId !== undefined) setFollowBlockId(blockId);
      persist();
    },
    [doc, persist],
  );

  const documentRef = useRef<DocumentHandle | null>(null);
  const pendingScroll = useRef<PendingScroll | null>(null);

  const requestScroll = useCallback((request: PendingScroll) => {
    const handle = documentRef.current;
    if (handle === null) {
      pendingScroll.current = request;
      return;
    }
    applyScroll(handle, request);
  }, []);

  const onGuidedTop = useCallback(
    (blockId: string) => {
      const block = doc?.byId.get(blockId);
      if (block === undefined) return;
      positionRef.current = {
        v: 1,
        mode: modeRef.current,
        zoomMode: zoomModeRef.current,
        page: block.pageIndex,
        yPt: Math.max(0, block.bbox[1] - 12),
        blockId,
      };
      if (modeRef.current === 'split') requestScroll({ kind: 'rect', pageIndex: block.pageIndex, bbox: block.bbox });
      persist();
    },
    [doc, persist, requestScroll],
  );

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

  // Flush a scroll requested before a document pane existed (`mode` mounts and unmounts it).
  useEffect(() => {
    const request = pendingScroll.current;
    const handle = documentRef.current;
    if (request === null || handle === null) return;
    pendingScroll.current = null;
    applyScroll(handle, request);
  }, [mode]);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    [],
  );

  /**
   * `focusAnchor` (contracts.md §5/§6): resolve, scroll the passage into view, flash it 1.2 s.
   *
   * In Source and Split the passage is the anchor's Source paint — its stored quads for a user
   * highlight, the ladder's matched range for a citation. In Guided it is the paragraph that renders
   * it. An anchor painted nowhere still gets its page, and the tray says why.
   */
  const focusAnchor = useCallback(
    (anchor: Anchor, opts?: { flash?: boolean }) => {
      if (doc === null) return;
      const resolution = resolveAnchor(anchor, doc);
      const shouldFlash = opts?.flash !== false;
      if (modeRef.current === 'guided') {
        const blockId = resolution.blockIds[0];
        if (blockId !== undefined && shouldFlash) setGuidedFlash(`${blockId}`);
        if (flashTimer.current !== null) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setGuidedFlash(null), FLASH_MS + 100);
        return;
      }
      const paint = sourcePaint(anchor, doc, resolution);
      if (paint === null) {
        if (resolution.pageIndex !== null) requestScroll({ kind: 'page', pageIndex: resolution.pageIndex });
        return;
      }
      const extent: BBox | null = extentOf(paint.polygons);
      if (extent !== null) requestScroll({ kind: 'rect', pageIndex: paint.pageIndex, bbox: extent });
      if (!shouldFlash) return;
      setFlash({ key: `${anchor.id}:${String(Date.now())}`, pageIndex: paint.pageIndex, polygons: paint.polygons });
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS + 100);
    },
    [doc, requestScroll],
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

  /** The colour a new highlight gets: the last one the reader picked, amber at first. */
  const lastColor = useRef<HighlightColor>('amber');
  const onCreateHighlight = useCallback(
    (captured: SelectionCapture) => {
      void highlights.create(captured.anchors, lastColor.current);
    },
    [highlights],
  );

  const onActivateHighlight = useCallback(
    (highlightId: string, at: CardAt | null) => setCard({ highlightId, at }),
    [],
  );

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
  const unreachable = docFailure?.kind === 'unreachable' && (pdfFailure !== null || pdfSource === null);
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
                setDocAttempt((n) => n + 1);
                setPdfAttempt((n) => n + 1);
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
      <ReaderActionsMount paper={paper} onFocusAnchor={focusAnchor}>
        <ReaderWorkspaceView
          doc={doc}
          paper={paper}
          mode={mode}
          onModeChange={setMode}
          zoom={zoom}
          zoomMode={zoomMode}
          onZoomChange={setZoomMode}
          onViewportResize={setViewport}
          navigatorOpen={navigatorOpen}
          onNavigatorToggle={() => setNavigatorOpen((open) => !open)}
          highlights={highlights}
          onCreateHighlight={onCreateHighlight}
          onActivateHighlight={onActivateHighlight}
          activeHighlightId={card?.highlightId ?? null}
          flash={flash}
          guidedFlash={guidedFlash}
          followBlockId={followBlockId}
          onShowSource={showSource}
          documentRef={documentRef}
          pdfFailure={pdfFailure}
          onRetryPdf={() => setPdfAttempt((n) => n + 1)}
          stillReading={docFailure?.kind === 'not_parsed'}
          onJumpToPage={jumpToPage}
          selection={selection}
          onSelectionChange={setSelection}
          initialPosition={positionRef.current === null ? null : { page: positionRef.current.page, yPt: positionRef.current.yPt }}
          initialBlockId={positionRef.current?.blockId ?? null}
          onSourcePosition={onSourcePosition}
          onGuidedTop={onGuidedTop}
          onFocusHighlight={focusHighlight}
          narrow={narrow}
          onNotice={setNotice}
        />
        {card === null ? null : (
          <HighlightCardSlot
            highlights={highlights}
            card={card}
            onClose={() => setCard(null)}
            onColor={(color) => {
              lastColor.current = color;
            }}
          />
        )}
        <ReaderToast message={notice} onDismiss={() => setNotice(null)} />
      </ReaderActionsMount>
    </PdfDocumentProvider>
  );
}

function ReaderState({
  title,
  body,
  action,
  busy = false,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
  readonly busy?: boolean;
}) {
  return (
    <div className="pt-reader">
      <div className="pt-state" role={busy ? 'status' : 'alert'} aria-live="polite">
        <h1 className="pt-state__title">{title}</h1>
        <p className="pt-state__body">{body}</p>
        {action}
      </div>
    </div>
  );
}

function HighlightCardSlot({
  highlights,
  card,
  onClose,
  onColor,
}: {
  readonly highlights: UseHighlights;
  readonly card: { readonly highlightId: string; readonly at: CardAt | null };
  readonly onClose: () => void;
  readonly onColor: (color: HighlightColor) => void;
}) {
  const highlight = highlights.highlights.find((h) => h.highlightId === card.highlightId);
  if (highlight === undefined) return null;
  return (
    <HighlightCard
      key={highlight.highlightId}
      highlight={highlight}
      at={card.at}
      onColor={(color) => {
        onColor(color);
        void highlights.update(highlight.highlightId, { color });
      }}
      onNote={(note) => void highlights.update(highlight.highlightId, { note })}
      onDelete={() => {
        onClose();
        void highlights.remove(highlight.highlightId);
      }}
      onRetry={() => void highlights.retry(highlight.highlightId)}
      onClose={onClose}
    />
  );
}

/**
 * The `ReaderActions` mount (contracts.md §5) — S0's lines in this file.
 *
 * It decides which implementation fills each action; the callers (`SourcePane`'s toolbar, the
 * explain panel's chips in S6, the canvas in S7) reach them through `useReaderActions()`.
 * `openExplain` and `sendToCanvas` are owned by S6 and S7 and change behind these same lines.
 * `focusAnchor` is S4's: resolve → scroll → 1.2 s flash, implemented by the workspace above.
 *
 * A component of its own because the workspace returns early (loading, error) and hooks may not
 * follow an early return.
 */
function ReaderActionsMount({
  paper,
  onFocusAnchor,
  children,
}: {
  readonly paper: PaperRef;
  readonly onFocusAnchor: (anchor: Anchor, opts?: { flash?: boolean }) => void;
  readonly children: React.ReactNode;
}) {
  const paperId = paper.kind === 'api' ? paper.paperId : null;
  const explain = useExplainActions({ paperId });
  const { openExplain } = explain;
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain,
      sendToCanvas: (input) => sendToCanvas(paperId, input),
      focusAnchor: (anchor, opts) => onFocusAnchor(anchor, opts),
    }),
    [openExplain, paperId, onFocusAnchor],
  );

  return (
    <ReaderActionsProvider value={actions}>
      {children}
      <ExplainPanel controller={explain} />
    </ReaderActionsProvider>
  );
}

/**
 * The view half. A thin shell: every region is one component, and the shell knows nothing about
 * any of their internals.
 */
interface ViewProps {
  readonly doc: IndexedDocument | null;
  readonly paper: PaperRef;
  readonly mode: ReadingMode;
  readonly onModeChange: (mode: ReadingMode) => void;
  readonly zoom: number;
  readonly zoomMode: ZoomMode;
  readonly onZoomChange: (mode: ZoomMode) => void;
  readonly onViewportResize: (size: { readonly width: number; readonly height: number }) => void;
  readonly navigatorOpen: boolean;
  readonly onNavigatorToggle: () => void;
  readonly highlights: UseHighlights;
  readonly onCreateHighlight: (captured: SelectionCapture) => void;
  readonly onActivateHighlight: (highlightId: string, at: CardAt | null) => void;
  readonly activeHighlightId: string | null;
  readonly flash: FlashPaint | null;
  readonly guidedFlash: string | null;
  readonly followBlockId: string | null;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly documentRef: DocumentRef;
  readonly pdfFailure: Failure | null;
  readonly onRetryPdf: () => void;
  readonly stillReading: boolean;
  readonly onJumpToPage: (pageIndex: number) => void;
  /** The live text selection, or `null` when nothing is selected — #77's D6. */
  readonly selection: PendingSelection | null;
  readonly onSelectionChange: (selection: PendingSelection | null) => void;
  readonly initialPosition: ReadingPosition | null;
  readonly initialBlockId: string | null;
  readonly onSourcePosition: (position: ReadingPosition) => void;
  readonly onGuidedTop: (blockId: string) => void;
  readonly onFocusHighlight: (highlightId: string) => void;
  readonly narrow: boolean;
  readonly onNotice: (message: string) => void;
}

function quoteOfHighlight(highlight: ReaderHighlight): string {
  return displayQuote(highlight.anchors.map((a) => a.anchor));
}

function ReaderWorkspaceView(props: ViewProps) {
  const { doc, mode } = props;
  const paper = props.paper;

  /**
   * The Inspector's answer source (Epic 3; S6 replaces the Inspector with the explain panel).
   * An `api` paper can be asked about; a `fixture` paper exists on no server, so the fixture source
   * stays as the offline path.
   */
  const inspectorAnswerSource = useMemo(
    () =>
      doc === null
        ? null
        : paper.kind === 'api'
          ? createLiveAnswerSource({ doc })
          : createFixtureAnswerSource({
              doc,
              at: '1970-01-01T00:00:00.000Z',
              client: 'papertree-web/inspector',
            }),
    [doc, paper],
  );

  const title =
    doc?.blocks.find((block) => block.type === 'title')?.text.replace(/\n/g, ' ') ??
    (paper.kind === 'api' ? 'Opening the paper…' : paper.slug);

  /**
   * What the Inspector is asked ABOUT — #77's D6: the live selection, or the title when nothing is
   * selected. `blockIds` is filtered against `doc.byId`.
   */
  const inspectorContext = useMemo<InspectorContext | null>(() => {
    if (doc === null) return null;
    const selected = (props.selection?.blockIds ?? []).filter((id) => doc.byId.has(id));
    if (selected.length > 0) {
      return { kind: 'selection', blockIds: selected, quote: props.selection?.text ?? '' };
    }
    return { kind: 'selection', blockIds: [doc.blocks[0]?.id ?? ''], quote: title };
  }, [props.selection, doc, title]);

  const { items: painted, unplaced } = useMemo(
    () => paintItemsOf(doc, props.highlights.highlights),
    [doc, props.highlights.highlights],
  );

  /**
   * The Navigator says what the PAGE shows: "approximate" only when a highlight's paint is (a
   * ladder answer without stored quads), never because the ladder's LINK is approximate while the
   * stored quads paint it exactly — a figure label captured from pdf.js is linked by geometry (T4)
   * and painted to the glyph.
   */
  const navigatorHighlights = useMemo<NavigatorHighlight[]>(() => {
    const unplacedAnchors = new Set(unplaced.map((u) => u.anchor.id));
    return props.highlights.highlights.map((highlight) => {
      const first = highlight.anchors[0];
      const paints = painted.filter((item) => item.highlightId === highlight.highlightId);
      const pageIndex =
        first === undefined
          ? null
          : ((first.anchor.selectors.find((s) => s.type === 'PageSelector') as { index?: number } | undefined)
              ?.index ?? first.resolution.pageIndex);
      const nowhere = highlight.anchors.length > 0 && highlight.anchors.every((a) => unplacedAnchors.has(a.anchor.id));
      return {
        id: highlight.highlightId,
        blockIds: highlight.anchors.flatMap((a) => a.resolution.blockIds),
        quote: quoteOfHighlight(highlight) || 'Highlight',
        state: nowhere ? 'orphan' : paints.some((p) => p.approximate) ? 'approximate' : 'anchored',
        pageIndex: pageIndex ?? null,
        colour: highlight.color,
        note: highlight.note,
        status: highlight.status,
        unplaced: nowhere,
      };
    });
  }, [props.highlights.highlights, painted, unplaced]);

  return (
    <div className="pt-reader" data-reader-mode={mode}>
      <ReaderToolbarShell
        title={title}
        mode={mode}
        onModeChange={props.onModeChange}
        guidedAvailable={doc !== null}
        zoom={props.zoom}
        zoomMode={props.zoomMode}
        onZoomChange={props.onZoomChange}
        onNavigatorToggle={props.onNavigatorToggle}
        navigatorOpen={props.navigatorOpen}
        navigatorAvailable={doc !== null}
        highlightCount={props.highlights.highlights.length}
      />

      {props.stillReading ? (
        <p className="pt-banner" role="status">
          This paper is still being read. You can read the PDF now; highlights, Guided and Split
          arrive when it is ready.
        </p>
      ) : null}
      {props.highlights.load === 'error' && props.highlights.loadError !== null ? (
        <div className="pt-banner" role="alert">
          <span className="flex-1">{props.highlights.loadError}</span>
          <button type="button" className="pt-btn pt-btn--outline" onClick={props.highlights.reload}>
            Try again
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {props.navigatorOpen && doc !== null ? (
          <aside className="pt-drawer" aria-label="Contents">
            <NavigatorSlot
              doc={doc}
              highlights={navigatorHighlights}
              onShowSource={props.onShowSource}
              onJumpToPage={props.onJumpToPage}
              onSelectHighlight={props.onFocusHighlight}
              onEditHighlight={(id) => props.onActivateHighlight(id, null)}
              onClose={props.onNavigatorToggle}
            />
          </aside>
        ) : null}

        <main className="min-w-0 flex-1 overflow-hidden" aria-label="Document">
          <DocumentSlot {...props} />
        </main>

        {/* The Inspector slot, filled by EPIC 3 (F3.6); S6 replaces it with the explain panel.
            `paperId` is the real `paper_id` for an API paper — `paperRefKey` is a cache key. */}
        {doc === null || inspectorAnswerSource === null || inspectorContext === null ? null : (
          <aside
            className="hidden w-[380px] shrink-0 border-l border-[--pt-rule] bg-[--pt-panel-ground] xl:block"
            aria-label="Inspector"
            data-epic="3"
          >
            <Inspector
              context={inspectorContext}
              answerSource={inspectorAnswerSource}
              paperId={paper.kind === 'api' ? paper.paperId : paperRefKey(paper)}
              onNavigate={(citation) => {
                props.onShowSource(citation.resolution.blockIds);
              }}
              onShowSource={props.onShowSource}
            />
          </aside>
        )}
      </div>

      {doc === null || unplaced.length === 0 ? null : (
        <UnanchoredTray
          items={unplaced.map((item) => ({
            ...item,
            placedElsewhere: new Set(
              painted.filter((p) => p.highlightId === item.highlightId).map((p) => p.key),
            ).size,
          }))}
          sourceHash={doc.sourceHash}
          onJumpToPage={(pageIndex) => props.onJumpToPage(pageIndex)}
          onForget={(anchorId) => {
            const owner = unplaced.find((u) => u.anchor.id === anchorId);
            if (owner !== undefined) void props.highlights.remove(owner.highlightId);
          }}
        />
      )}
    </div>
  );
}

/**
 * The reader's one toolbar: back to the library, the Navigator, the paper's title, zoom, mode.
 * Below 640 px the controls take their own row, the mode switch first, all reachable by thumb.
 */
function ReaderToolbarShell({
  title,
  mode,
  onModeChange,
  guidedAvailable,
  zoom,
  zoomMode,
  onZoomChange,
  onNavigatorToggle,
  navigatorOpen,
  navigatorAvailable,
  highlightCount,
}: {
  title: string;
  mode: ReadingMode;
  onModeChange: (mode: ReadingMode) => void;
  guidedAvailable: boolean;
  zoom: number;
  zoomMode: ZoomMode;
  onZoomChange: (mode: ZoomMode) => void;
  onNavigatorToggle: () => void;
  navigatorOpen: boolean;
  navigatorAvailable: boolean;
  highlightCount: number;
}) {
  return (
    <header className="pt-reader__bar">
      <a className="pt-btn" href="/dashboard" aria-label="Back to your library">
        <span aria-hidden="true">←</span>
        <span className="hidden sm:inline">Library</span>
      </a>
      {/* The accessible name STARTS WITH the visible label (WCAG 2.5.3, s4-review.md F9): a
          speech user says "Contents", and the panel it opens is titled the same. */}
      <button
        type="button"
        className="pt-btn"
        aria-label={
          highlightCount > 0
            ? `Contents, ${String(highlightCount)} ${highlightCount === 1 ? 'highlight' : 'highlights'}`
            : 'Contents'
        }
        aria-expanded={navigatorOpen}
        aria-pressed={navigatorOpen}
        disabled={!navigatorAvailable}
        title={navigatorAvailable ? 'Outline, pages and highlights' : 'Available when the paper has been read'}
        onClick={onNavigatorToggle}
      >
        Contents
        {highlightCount > 0 ? (
          <span className="pt-num text-[--pt-ink-muted]" aria-hidden="true">
            {highlightCount}
          </span>
        ) : null}
      </button>
      <h1 className="pt-reader__title" title={title}>
        {title}
      </h1>
      <div className="pt-reader__controls">
        <ModeSwitch
          mode={mode}
          onModeChange={onModeChange}
          guidedAvailable={guidedAvailable}
          unavailableReason="Guided and Split open when the paper has been read."
        />
        {mode === 'guided' ? null : <ZoomControl mode={zoomMode} zoom={zoom} onModeChange={onZoomChange} />}
      </div>
    </header>
  );
}

function GuidedPane(props: ViewProps & { readonly doc: IndexedDocument }) {
  return (
    <GuidedView
      doc={props.doc}
      onShowSource={props.onShowSource}
      highlights={props.highlights.highlights}
      initialBlockId={props.initialBlockId}
      followBlockId={props.mode === 'split' ? props.followBlockId : null}
      onTopBlockChange={props.onGuidedTop}
      flashBlockId={props.guidedFlash}
      className="h-full"
    />
  );
}

function PdfUnavailable({ failure, onRetry }: { readonly failure: Failure; readonly onRetry: () => void }) {
  const body =
    failure.kind === 'unreachable'
      ? 'The PDF could not be downloaded: PaperTree is not reachable. Check the connection, then try again.'
      : failure.kind === 'not_parsed'
        ? 'The PDF opens here as soon as PaperTree has finished reading it.'
        : 'The PDF could not be downloaded from PaperTree. Try again in a moment.';
  return (
    <div className="pt-state" role={failure.kind === 'not_parsed' ? 'status' : 'alert'}>
      <h2 className="pt-state__title">
        {failure.kind === 'not_parsed' ? 'The PDF is almost ready' : 'The PDF is not available'}
      </h2>
      <p className="pt-state__body">{body}</p>
      {failure.kind === 'not_parsed' ? null : (
        <button type="button" className="pt-btn pt-btn--outline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

function SourceSlot(props: ViewProps) {
  if (props.pdfFailure !== null) return <PdfUnavailable failure={props.pdfFailure} onRetry={props.onRetryPdf} />;
  return (
    <SourcePane
      doc={props.doc}
      zoom={props.zoom}
      highlights={props.highlights.highlights}
      onCreateHighlight={props.onCreateHighlight}
      highlightUnavailableReason={props.highlights.unavailableReason}
      onActivateHighlight={props.onActivateHighlight}
      activeHighlightId={props.activeHighlightId}
      flash={props.flash}
      narrow={props.narrow}
      sheetOpen={props.narrow && props.navigatorOpen}
      onViewportResize={props.onViewportResize}
      onSelectionChange={props.onSelectionChange}
      documentRef={props.documentRef}
      initialPosition={props.initialPosition}
      onPositionChange={props.onSourcePosition}
      onNotice={props.onNotice}
    />
  );
}

function DocumentSlot(props: ViewProps) {
  const doc = props.doc;
  if (props.mode === 'guided' && doc !== null) return <GuidedPane {...props} doc={doc} />;
  if (props.mode === 'split' && doc !== null) {
    return <SplitView source={<SourceSlot {...props} />} guided={<GuidedPane {...props} doc={doc} />} className="h-full" />;
  }
  return <SourceSlot {...props} />;
}

function NavigatorSlot(props: {
  doc: IndexedDocument;
  highlights: readonly NavigatorHighlight[];
  onShowSource: (blockIds: readonly string[]) => void;
  onJumpToPage: (pageIndex: number) => void;
  onSelectHighlight: (highlightId: string) => void;
  onEditHighlight: (highlightId: string) => void;
  onClose: () => void;
}) {
  const { numPages, pageMeta } = usePdfDocument();
  const pages = useMemo(() => {
    const out: { index: number; width: number; height: number }[] = [];
    const count = (numPages ?? 0) > 0 ? numPages : props.doc.pages.length;
    for (let index = 0; index < count; index += 1) {
      const meta = pageMeta?.get(index);
      const page = props.doc.pages.find((p) => p.index === index);
      out.push({
        index,
        width: meta?.width ?? page?.width ?? 612,
        height: meta?.height ?? page?.height ?? 792,
      });
    }
    return out;
  }, [numPages, pageMeta, props.doc]);
  return (
    <Navigator
      doc={props.doc}
      pages={pages}
      highlights={props.highlights}
      open
      onClose={props.onClose}
      layout="push"
      onNavigateToBlock={(blockId) => props.onShowSource([blockId])}
      onNavigateToPage={props.onJumpToPage}
      onSelectHighlight={props.onSelectHighlight}
      onEditHighlight={props.onEditHighlight}
      renderThumbnail={(pageIndex) => <PageThumbnail pageIndex={pageIndex} />}
    />
  );
}
