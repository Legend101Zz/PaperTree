'use client';

/**
 * The reader workspace — the composition layer for Source / Guided / Split.
 *
 * THE ORGANISING RULE (IA §18.2): **one document, one navigator, one inspector, one transport.**
 * The paper is the only permanent object on screen. Everything else is summoned, does its job, and
 * leaves. The v1 reader had twelve surfaces competing for the same screen, three of them mounting
 * independent `<Document>` instances of the same PDF, with panel positions hardcoded as viewport
 * coordinates. This file exists to make that impossible: there is exactly one document surface,
 * one Navigator, and one Inspector slot, and none of them knows a pixel coordinate.
 *
 * WHAT REPLACED THE OLD ROUTE'S BUG. `read/page.tsx:228-233` captured a highlight by dividing
 * `range.getClientRects()` by `window.innerWidth`/`innerHeight`, and `PDFViewer.tsx:145-154`
 * rendered the result as a percentage of the page element. That is why every stored highlight is
 * unrecoverable — the record contains no page height, no PDF-space bbox, no character offset and
 * no block id, so nothing can reconstruct it. Capture now goes through `useSelectionCapture` →
 * `captureAnchor`, which writes a complete multi-selector anchor in IR space, and painting goes
 * through `HighlightOverlay`, which never measures the DOM.
 *
 * The Inspector slot is filled by Epic 3 (F3.6). It was left as an absence rather than a stub, so
 * landing it was an addition and nothing here had to be rearranged. Its answer source is a fixture
 * because nothing serves PaperIR over HTTP yet (#62), and that is visible at the call site rather
 * than hidden behind a default.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveAnchor, type Anchor, type IndexedDocument, type Resolution } from '@papertree/anchoring';

import {
  createFixtureAnswerSource,
  createLiveAnswerSource,
  Inspector,
} from '@/components/inspector';
import { GuidedView } from '@/components/reader/GuidedView';
import { ModeSwitch } from '@/components/reader/ModeSwitch';
import { Navigator } from '@/components/reader/Navigator';
import { SourcePane } from '@/components/reader/SourcePane';
import { SplitView } from '@/components/reader/SplitView';
import { UnanchoredTray } from '@/components/reader/UnanchoredTray';
import { resolveZoom, ZoomControl, type ZoomMode } from '@/components/reader/ZoomControl';
import {
  applyScroll,
  type DocumentHandle,
  type DocumentRef,
  type PendingScroll,
} from '@/components/reader/documentHandle';
import {
  loadDocument,
  paperRefKey,
  pdfSourceFor,
  type PaperRef,
} from '@/lib/paperSource';

export type ReadingMode = 'source' | 'guided' | 'split';

export interface ReaderWorkspaceProps {
  /**
   * A fixture slug or a real `paper_id`, already resolved by the route.
   *
   * A discriminated union rather than a bare string: the two differ in where the document AND the
   * PDF come from, and a string would have pushed that decision back down into every consumer —
   * which is how `pdfUrlFor(slug)` came to be a second fixture-specific seam nobody counted.
   */
  readonly paper: PaperRef;
}

interface AnchorRecord {
  readonly anchor: Anchor;
  readonly resolution: Resolution;
}

export function ReaderWorkspace({ paper }: ReaderWorkspaceProps) {
  const paperKey = paperRefKey(paper);
  const [pdfSource, setPdfSource] = useState<string | ArrayBuffer | null>(null);
  const [doc, setDoc] = useState<IndexedDocument | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [mode, setMode] = useState<ReadingMode>('source');
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [anchors, setAnchors] = useState<readonly AnchorRecord[]>([]);
  /**
   * ZOOM IS A MODE, NOT A NUMBER, and `ZoomControl`'s header says why: "fit width" stored as `1.37`
   * stops fitting the instant the window is resized. The scalar below is derived from the mode and
   * the measured container on every resize, so a fit mode keeps fitting.
   */
  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: 'scale', scale: 1 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // Mode, zoom and scroll are remembered PER PAPER (IA §18.2's persistence column), so returning
  // to a paper returns you to how you were reading it, not to a global default.
  const storageKey = `papertree/reader/${paperKey}`;

  useEffect(() => {
    let cancelled = false;
    const fail = (error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error : new Error(String(error)));
    };
    loadDocument(paper)
      .then((indexed) => {
        if (!cancelled) setDoc(indexed);
      })
      .catch(fail);
    // The PDF is fetched alongside the IR rather than after it: they are independent, and for an
    // API paper the bytes need an Authorization header that pdf.js cannot send for itself.
    pdfSourceFor(paper)
      .then((source) => {
        if (!cancelled) setPdfSource(source);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [paper]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(storageKey);
    if (saved === null) return;
    try {
      const parsed = JSON.parse(saved) as { mode?: ReadingMode; zoomMode?: ZoomMode };
      if (parsed.mode !== undefined) setMode(parsed.mode);
      // The MODE is what persists. Restoring a stored scalar for a paper last read fit-to-width on
      // a wider window would reopen it at a size that fits nothing.
      if (parsed.zoomMode !== undefined) setZoomMode(parsed.zoomMode);
    } catch {
      // A corrupt entry is not worth a crash, and not worth a migration either — the cost of
      // getting it wrong is that one paper opens at 100% in Source mode.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify({ mode, zoomMode }));
  }, [storageKey, mode, zoomMode]);

  /**
   * Re-resolve every anchor against the current parse.
   *
   * Runs on document change, never on zoom or scroll — resolution is a property of the DOCUMENT,
   * and tying it to a view parameter is how the v1 reader ended up recomputing geometry on every
   * resize. `resolveAnchor` consults the T0 cache first, so a re-run against an unchanged parse is
   * a map lookup per anchor.
   */
  const reresolve = useCallback((indexed: IndexedDocument, records: readonly AnchorRecord[]) => {
    return records.map((record) => ({
      anchor: record.anchor,
      resolution: resolveAnchor(record.anchor, indexed),
    }));
  }, []);

  useEffect(() => {
    if (doc === null) return;
    setAnchors((current) => (current.length === 0 ? current : reresolve(doc, current)));
  }, [doc, reresolve]);

  const addAnchor = useCallback(
    (anchor: Anchor) => {
      if (doc === null) return;
      setAnchors((current) => [...current, { anchor, resolution: resolveAnchor(anchor, doc) }]);
    },
    [doc],
  );

  const orphans = useMemo(
    () => anchors.filter((record) => record.resolution.state === 'orphan'),
    [anchors],
  );

  /**
   * "Show source" — the return path every derived surface owes.
   *
   * IA §18.6: "no view is a dead end — anything derived can always navigate back to the exact
   * region it came from." This is that function, and it is passed down to every `DerivedBlock`.
   */
  const documentRef = useRef<DocumentHandle | null>(null);

  /**
   * What to scroll to once a document pane exists to scroll it — #64, and a bug the old shape hid.
   *
   * `showSource` from Guided mode switches to Split and then scrolls. `SourcePane` does not exist
   * until that state change commits, so the ref is still null on the line after `setMode`. The old
   * code called `documentRef.current.scrollToBlock?.(first)` there and did nothing, which looked
   * identical to the never-wired case and is why this was invisible: in Guided mode the seam was
   * broken twice over.
   */
  const pendingScroll = useRef<PendingScroll | null>(null);

  const requestScroll = useCallback((request: PendingScroll) => {
    const handle = documentRef.current;
    if (handle === null) {
      pendingScroll.current = request;
      return;
    }
    applyScroll(handle, request);
  }, []);

  const showSource = useCallback(
    (blockIds: readonly string[]) => {
      const first = blockIds[0];
      if (first === undefined) return;
      setMode((current) => (current === 'guided' ? 'split' : current));
      requestScroll({ kind: 'block', blockId: first });
    },
    [requestScroll],
  );

  /**
   * The page-level jump an orphaned anchor gets instead of a precise location.
   *
   * Hypothesis's 2017 orphans-tab decision is the precedent and it is the right one: a failed
   * anchor is never deleted, it is SHOWN, with its stored quote and a way to get near it.
   */
  const jumpToPage = useCallback(
    (pageIndex: number, _anchorId: string) => {
      // `scrollToPage`, not a `page:${n}` string through `scrollToBlock` — #64 step 3. The old
      // sentinel could never have matched a block id even once the seam was connected.
      requestScroll({ kind: 'page', pageIndex });
    },
    [requestScroll],
  );

  /**
   * Flush a scroll that was requested before a document pane existed.
   *
   * Keyed on `mode` because that is the only thing that mounts or unmounts `SourcePane`. React
   * runs ref callbacks during commit and effects after, so by the time this fires the pane has
   * already installed its handle.
   */
  useEffect(() => {
    const request = pendingScroll.current;
    const handle = documentRef.current;
    if (request === null || handle === null) return;
    pendingScroll.current = null;
    applyScroll(handle, request);
  }, [mode]);

  if (loadError !== null) {
    return (
      <div role="alert" className="p-8">
        <h1 className="text-lg font-medium">This paper could not be loaded</h1>
        <p className="mt-2 text-sm opacity-80">{loadError.message}</p>
      </div>
    );
  }

  /**
   * The mode resolved against the page and the measured container.
   *
   * Page ONE is the reference on purpose: a document with a landscape figure page would otherwise
   * make "fit width" mean something different depending on where the reader had scrolled to.
   */
  const zoom =
    doc === null
      ? 1
      : resolveZoom(zoomMode, {
          pageWidth: doc.pages[0]?.width ?? 612,
          pageHeight: doc.pages[0]?.height ?? 792,
          userUnit: doc.pages[0]?.user_unit ?? 1,
          containerWidth: viewport.width,
          containerHeight: viewport.height,
        });

  if (doc === null) {
    return (
      <div role="status" aria-live="polite" className="p-8 text-sm opacity-80">
        Loading {paper.kind === 'fixture' ? paper.slug : paper.paperId}…
      </div>
    );
  }

  return (
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
      anchors={anchors}
      orphans={orphans}
      onAnchorCaptured={addAnchor}
      onShowSource={showSource}
      documentRef={documentRef}
      pdfSource={pdfSource}
      onJumpToPage={jumpToPage}
    />
  );
}

/**
 * The view half, split out so the state above can be tested without a DOM and so the composition
 * is readable as a single expression.
 *
 * It is intentionally a thin shell: every region is one component, and the shell knows nothing
 * about any of their internals. The v1 reader's route was 500 lines that reached into six panels;
 * that is the shape this is avoiding.
 */
interface ViewProps {
  readonly doc: IndexedDocument;
  readonly paper: PaperRef;
  readonly mode: ReadingMode;
  readonly onModeChange: (mode: ReadingMode) => void;
  readonly zoom: number;
  readonly zoomMode: ZoomMode;
  readonly onZoomChange: (mode: ZoomMode) => void;
  readonly onViewportResize: (size: { readonly width: number; readonly height: number }) => void;
  readonly navigatorOpen: boolean;
  readonly onNavigatorToggle: () => void;
  readonly anchors: readonly AnchorRecord[];
  readonly orphans: readonly AnchorRecord[];
  readonly onAnchorCaptured: (anchor: Anchor) => void;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly documentRef: DocumentRef;
  readonly pdfSource: string | ArrayBuffer | null;
  /** A page-level jump for an anchor that could not be placed — never a delete. */
  readonly onJumpToPage: (pageIndex: number, anchorId: string) => void;
}

function ReaderWorkspaceView(props: ViewProps) {
  const { doc, mode, orphans } = props;

  /**
   * The Inspector's answer source. THE SWAP #62 PREDICTED, and it is this one expression.
   *
   * An `api` paper exists on `services/api` and can be asked about: `POST /papers/{id}/ask` runs
   * the tool loop and returns a verified `GroundedAnswer` (#76). A `fixture` paper does NOT exist
   * on any server — the three committed fixtures are files under `public/` — so there is nothing
   * for `/ask` to be asked about, and the fixture source stays as the offline path rather than as
   * a fallback. That is a property of the DOCUMENT, so it needs no new flag;
   * `NEXT_PUBLIC_PAPERTREE_FIXTURES` gates documents and is deliberately not consulted here.
   *
   * The fixture source's `at`/`client` stay fixed rather than defaulted to a wall clock: an
   * `Anchor` records `created.at`, so a `Date.now()` there would make every captured citation
   * anchor differ between renders and turn any test that compares them into a flake. The live
   * source defaults to a real clock, because a real answer's anchor has a real creation time.
   */
  const paper = props.paper;
  const inspectorAnswerSource = useMemo(
    () =>
      paper.kind === 'api'
        ? createLiveAnswerSource({ doc })
        : createFixtureAnswerSource({
            doc,
            at: '1970-01-01T00:00:00.000Z',
            client: 'papertree-web/inspector',
          }),
    [doc, paper],
  );

  const title =
    doc.blocks.find((block) => block.type === 'title')?.text.replace(/\n/g, ' ') ??
    paperRefKey(props.paper);

  return (
    <div className="flex h-dvh flex-col bg-[--pt-page-ground]">
      <ReaderToolbarShell
        title={title}
        mode={mode}
        onModeChange={props.onModeChange}
        zoom={props.zoom}
        zoomMode={props.zoomMode}
        onZoomChange={props.onZoomChange}
        onNavigatorToggle={props.onNavigatorToggle}
        navigatorOpen={props.navigatorOpen}
      />

      <div className="flex min-h-0 flex-1">
        {/* Navigator — hidden by default and summoned. On iPad it is an overlay sheet, never a
            push, so the document does not reflow when it opens (IA §19.5). */}
        {props.navigatorOpen ? (
          <aside
            className="w-[320px] shrink-0 overflow-y-auto border-r md:relative absolute inset-y-0 left-0 z-20 bg-[--pt-panel-ground]"
            aria-label="Navigator"
          >
            <NavigatorSlot
              doc={doc}
              anchors={props.anchors}
              onShowSource={props.onShowSource}
              onClose={props.onNavigatorToggle}
            />
          </aside>
        ) : null}

        <main className="min-w-0 flex-1 overflow-hidden" aria-label="Document">
          <DocumentSlot {...props} />
        </main>

        {/* The Inspector slot, filled by EPIC 3 (F3.6).

            `answerSource` is REQUIRED, and #76 is the moment that required-ness paid for itself:
            an endpoint landed, the compiler named THIS call site and only this one, and the
            Inspector did not change by a character. `paperId` is the real `paper_id` for an API
            paper — `paperRefKey` returns `api:ppr_…`, which is a cache key and not an id, and
            sending it would 404 every ask.

            `onNavigate` routes a citation through the SAME `onShowSource` seam every derived
            surface already uses, and that seam now TERMINATES: `SourcePane` populates
            `documentRef` from its `VirtualPageList` handle and resolves the block id to a
            (pageIndex, bbox) where `doc.byId` is in scope. #64, closed. Both members of
            `DocumentHandle` are required, so an unwired pane is a compile error rather than a
            dead click. */}
        <aside
          className="hidden w-[380px] shrink-0 border-l xl:block"
          aria-label="Inspector"
          data-epic="3"
        >
          <Inspector
            context={{ kind: 'selection', blockIds: [doc.blocks[0]?.id ?? ''], quote: title }}
            answerSource={inspectorAnswerSource}
            paperId={paper.kind === 'api' ? paper.paperId : paperRefKey(paper)}
            onNavigate={(citation) => {
              props.onShowSource(citation.resolution.blockIds);
            }}
            onShowSource={props.onShowSource}
          />
        </aside>
      </div>

      {orphans.length > 0 ? (
        <UnanchoredTraySlot orphans={orphans} onJumpToPage={props.onJumpToPage} />
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Slots.
 *
 * These are the seams the feature components plug into. They are declared here, with the props
 * they will receive, so the composition is complete and typechecks before every component exists —
 * and so a missing component is a visible, labelled gap in the UI rather than a blank screen.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

function PendingSlot({ label, detail }: { label: string; detail: string }) {
  return (
    <div
      role="status"
      className="m-4 rounded border border-dashed p-4 text-sm opacity-70"
      data-pending-slot={label}
    >
      <strong>{label}</strong>
      <p className="mt-1">{detail}</p>
    </div>
  );
}

/**
 * The reader's one toolbar.
 *
 * It used to declare its own mode buttons inline — a three-entry `MODES` array and a `map` — while
 * `components/reader/ModeSwitch.tsx` sat unimported next to it, and it had NO zoom control at all
 * while `ZoomControl` sat unimported beside that. Both were found by `test/reachable.spec.ts`, and
 * `ZoomControl`'s absence meant F2.1's "real zoom, not a CSS width slider" had no way to be
 * exercised by a user: the state existed and nothing could change it. Issue #60.
 *
 * `ModeSwitch` is not a cosmetic swap for the inline buttons. It knows to DISABLE Guided with a
 * stated reason when a document has no derived reading, which the inline version had no concept of.
 */
function ReaderToolbarShell({
  title,
  mode,
  onModeChange,
  zoom,
  zoomMode,
  onZoomChange,
  onNavigatorToggle,
  navigatorOpen,
}: {
  title: string;
  mode: ReadingMode;
  onModeChange: (mode: ReadingMode) => void;
  zoom: number;
  zoomMode: ZoomMode;
  onZoomChange: (mode: ZoomMode) => void;
  onNavigatorToggle: () => void;
  navigatorOpen: boolean;
}) {
  return (
    <header className="flex items-center gap-2 border-b px-2 py-1">
      <button
        type="button"
        aria-label="Navigator"
        aria-expanded={navigatorOpen}
        className="flex h-11 w-11 items-center justify-center rounded"
        onPointerUp={onNavigatorToggle}
        onClick={(event) => {
          if (event.detail === 0) onNavigatorToggle();
        }}
      >
        ☰
      </button>
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {/* Zoom applies to the paper, so it is hidden in Guided — a percentage that changes nothing
          is worse than no control. Split shows it: half of Split is the paper. */}
      {mode === 'guided' ? null : (
        <ZoomControl mode={zoomMode} zoom={zoom} onModeChange={onZoomChange} />
      )}
      <ModeSwitch mode={mode} onModeChange={onModeChange} />
    </header>
  );
}

function GuidedPane(props: ViewProps) {
  return <GuidedView doc={props.doc} onShowSource={props.onShowSource} className="h-full overflow-y-auto" />;
}

function DocumentSlot(props: ViewProps) {
  if (props.mode === 'guided') return <GuidedPane {...props} />;
  if (props.mode === 'split') {
    return (
      <SplitView
        source={
          <SourcePane
            doc={props.doc}
            pdfSource={props.pdfSource}
            zoom={props.zoom}
            anchors={props.anchors}
            onAnchorCaptured={props.onAnchorCaptured}
            onViewportResize={props.onViewportResize}
            documentRef={props.documentRef}
          />
        }
        guided={<GuidedPane {...props} />}
        className="h-full"
      />
    );
  }
  return (
    <SourcePane
      doc={props.doc}
      pdfSource={props.pdfSource}
      zoom={props.zoom}
      anchors={props.anchors}
      onAnchorCaptured={props.onAnchorCaptured}
      onViewportResize={props.onViewportResize}
      documentRef={props.documentRef}
    />
  );
}

function NavigatorSlot(props: {
  doc: IndexedDocument;
  anchors: readonly AnchorRecord[];
  onShowSource: (blockIds: readonly string[]) => void;
  onClose: () => void;
}) {
  return (
    <Navigator
      doc={props.doc}
      pages={props.doc.pages.map((page) => ({
        index: page.index,
        width: page.width,
        height: page.height,
      }))}
      open
      onClose={props.onClose}
      layout="push"
      onNavigateToBlock={(blockId) => props.onShowSource([blockId])}
      onNavigateToPage={() => undefined}
    />
  );
}

function UnanchoredTraySlot({
  orphans,
  onJumpToPage,
}: {
  orphans: readonly AnchorRecord[];
  onJumpToPage: (pageIndex: number, anchorId: string) => void;
}) {
  return (
    <UnanchoredTray
      // The tray does its own filtering ON PURPOSE, so nothing can be dropped before it gets there.
      items={orphans.map((record) => ({ anchor: record.anchor, resolution: record.resolution }))}
      onJumpToPage={onJumpToPage}
    />
  );
}
