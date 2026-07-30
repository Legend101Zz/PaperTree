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
 * The Inspector slot is deliberately left empty. Epic 3 fills it; a placeholder that did something
 * would be a worse lie than one that says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveAnchor, type Anchor, type IndexedDocument, type Resolution } from '@papertree/anchoring';

import { loadPaper, pdfUrlFor, type FixtureSlug } from '@/lib/fixtures';

export type ReadingMode = 'source' | 'guided' | 'split';

export interface ReaderWorkspaceProps {
  readonly slug: FixtureSlug;
}

interface AnchorRecord {
  readonly anchor: Anchor;
  readonly resolution: Resolution;
}

export function ReaderWorkspace({ slug }: ReaderWorkspaceProps) {
  const [doc, setDoc] = useState<IndexedDocument | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [mode, setMode] = useState<ReadingMode>('source');
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [anchors, setAnchors] = useState<readonly AnchorRecord[]>([]);
  const [zoom, setZoom] = useState(1);

  // Mode, zoom and scroll are remembered PER PAPER (IA §18.2's persistence column), so returning
  // to a paper returns you to how you were reading it, not to a global default.
  const storageKey = `papertree/reader/${slug}`;

  useEffect(() => {
    let cancelled = false;
    loadPaper(slug)
      .then((indexed) => {
        if (!cancelled) setDoc(indexed);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error : new Error(String(error)));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(storageKey);
    if (saved === null) return;
    try {
      const parsed = JSON.parse(saved) as { mode?: ReadingMode; zoom?: number };
      if (parsed.mode !== undefined) setMode(parsed.mode);
      if (typeof parsed.zoom === 'number' && parsed.zoom > 0) setZoom(parsed.zoom);
    } catch {
      // A corrupt entry is not worth a crash, and not worth a migration either — the cost of
      // getting it wrong is that one paper opens at 100% in Source mode.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify({ mode, zoom }));
  }, [storageKey, mode, zoom]);

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
  const documentRef = useRef<{ scrollToBlock?: (blockId: string) => void }>({});
  const showSource = useCallback(
    (blockIds: readonly string[]) => {
      const first = blockIds[0];
      if (first === undefined) return;
      setMode((current) => (current === 'guided' ? 'split' : current));
      documentRef.current.scrollToBlock?.(first);
    },
    [],
  );

  if (loadError !== null) {
    return (
      <div role="alert" className="p-8">
        <h1 className="text-lg font-medium">This paper could not be loaded</h1>
        <p className="mt-2 text-sm opacity-80">{loadError.message}</p>
      </div>
    );
  }

  if (doc === null) {
    return (
      <div role="status" aria-live="polite" className="p-8 text-sm opacity-80">
        Loading {slug}…
      </div>
    );
  }

  return (
    <ReaderWorkspaceView
      doc={doc}
      slug={slug}
      mode={mode}
      onModeChange={setMode}
      zoom={zoom}
      onZoomChange={setZoom}
      navigatorOpen={navigatorOpen}
      onNavigatorToggle={() => setNavigatorOpen((open) => !open)}
      anchors={anchors}
      orphans={orphans}
      onAnchorCaptured={addAnchor}
      onShowSource={showSource}
      documentRef={documentRef}
      pdfUrl={pdfUrlFor(slug)}
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
  readonly slug: FixtureSlug;
  readonly mode: ReadingMode;
  readonly onModeChange: (mode: ReadingMode) => void;
  readonly zoom: number;
  readonly onZoomChange: (zoom: number) => void;
  readonly navigatorOpen: boolean;
  readonly onNavigatorToggle: () => void;
  readonly anchors: readonly AnchorRecord[];
  readonly orphans: readonly AnchorRecord[];
  readonly onAnchorCaptured: (anchor: Anchor) => void;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly documentRef: React.MutableRefObject<{ scrollToBlock?: (blockId: string) => void }>;
  readonly pdfUrl: string;
}

function ReaderWorkspaceView(props: ViewProps) {
  const { doc, mode, orphans } = props;
  const title =
    doc.blocks.find((block) => block.type === 'title')?.text.replace(/\n/g, ' ') ?? props.slug;

  return (
    <div className="flex h-dvh flex-col bg-[--pt-page-ground]">
      <ReaderToolbarShell
        title={title}
        mode={mode}
        onModeChange={props.onModeChange}
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
            <NavigatorSlot doc={doc} anchors={props.anchors} onShowSource={props.onShowSource} />
          </aside>
        ) : null}

        <main className="min-w-0 flex-1 overflow-hidden" aria-label="Document">
          <DocumentSlot {...props} />
        </main>

        {/* The Inspector slot. EPIC 3 FILLS THIS. It is left empty rather than stubbed, because a
            placeholder that appears to work is worse than an absence that is honest. */}
        <aside
          className="hidden w-[380px] shrink-0 border-l xl:block"
          aria-label="Inspector"
          data-epic="3"
        />
      </div>

      {orphans.length > 0 ? <UnanchoredTraySlot orphans={orphans} /> : null}
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

function ReaderToolbarShell({
  title,
  mode,
  onModeChange,
  onNavigatorToggle,
  navigatorOpen,
}: {
  title: string;
  mode: ReadingMode;
  onModeChange: (mode: ReadingMode) => void;
  onNavigatorToggle: () => void;
  navigatorOpen: boolean;
}) {
  const MODES: readonly { id: ReadingMode; label: string }[] = [
    { id: 'source', label: 'Source' },
    { id: 'guided', label: 'Guided' },
    { id: 'split', label: 'Split' },
  ];
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
      <div role="group" aria-label="Reading mode" className="flex">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={mode === entry.id}
            className={`h-11 min-w-[64px] rounded px-3 text-sm ${mode === entry.id ? 'font-semibold underline' : ''}`}
            onPointerUp={() => onModeChange(entry.id)}
            onClick={(event) => {
              if (event.detail === 0) onModeChange(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </header>
  );
}

function DocumentSlot(props: ViewProps) {
  if (props.mode === 'guided') {
    return <PendingSlot label="Guided" detail="F2.5 GuidedView mounts here." />;
  }
  if (props.mode === 'split') {
    return <PendingSlot label="Split" detail="F2.6 SplitView mounts here, scroll-linked by block id." />;
  }
  return (
    <PendingSlot
      label="Source"
      detail={`F2.1 VirtualPageList + F2.3 HighlightOverlay mount here for ${props.pdfUrl}.`}
    />
  );
}

function NavigatorSlot(_props: {
  doc: IndexedDocument;
  anchors: readonly AnchorRecord[];
  onShowSource: (blockIds: readonly string[]) => void;
}) {
  return <PendingSlot label="Navigator" detail="F2.4 Navigator (six tabs) mounts here." />;
}

function UnanchoredTraySlot({ orphans }: { orphans: readonly AnchorRecord[] }) {
  return (
    <div role="region" aria-label="Unanchored highlights" className="border-t px-4 py-2 text-sm">
      {orphans.length} highlight{orphans.length === 1 ? '' : 's'} could not be placed in this
      version of the document. They are kept, not deleted.
    </div>
  );
}
