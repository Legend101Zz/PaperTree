'use client';

/**
 * board/components/BoardView — the page (frame 06): the header with the board's tools, then, in the
 * `main` landmark, the board (xyflow) with its minimap and legend, the empty board (06b), the
 * notices and the Undo toast.
 *
 * Nothing here talks to the API directly; every gesture goes through `useBoardController`, which is
 * the only module that sends a request (and only on the gestures contracts.md §2.7 lists).
 *
 * At scale (#215): the cards are memoised; a board of 150 cards or more renders only those in view
 * and turns them to glances below the low-zoom switch (one subscription to the zoom, here); the
 * zoom the stylesheet reads is published in 0.05 steps, since each write restyles every card.
 */
import { Background, ReactFlow, ReactFlowProvider, useReactFlow, useStore } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useBoardController } from '../hooks/useBoardController';
import { useBoardSelection } from '../hooks/useBoardSelection';
import { useBranchBoard } from '../hooks/useBranchBoard';
import { useBoardTools } from '../hooks/useBoardTools';
import { useCardSources } from '../hooks/useCardSources';
import { useDropIn } from '../hooks/useDropIn';
import { useLinkAs } from '../hooks/useLinkAs';
import { usePaperTitle } from '../hooks/usePaperTitle';
import { useThreadDrawing } from '../hooks/useThreadDrawing';
import { useUndoKeys } from '../hooks/useUndoKeys';
import { anchorPageIndex } from '../model/cards';
import {
  ZOOM_RANGE,
  besideHref,
  boardCounts,
  boardName,
  countsLine,
  paperBesideHref,
} from '../model/chrome';
import { withPageTitles, type PtEdge, type PtNode } from '../model/flow';
import { bigBoard, glanceAt, publishedZoom } from '../model/glance';
import { BoardHeader } from './BoardHeader';
import { NO_PAGES, useProvidedHost, type BoardHost } from './BoardHost';
import { BoardMinimap } from './BoardMinimap';
import { BoardFailed, BoardLoading, BoardNotice, UndoToast } from './BoardStates';
import { BoardToolbar } from './BoardToolbar';
import { CanvasActionsProvider, GlanceProvider, LinkingProvider } from './BoardContext';
import { BranchProvider } from './BranchContext';
import { nodeTypes } from './cards';
import { EmptyBoard } from './EmptyBoard';
import { LinkAsLayer } from './LinkAsLayer';
import { ThreadBar } from './ThreadBar';
import { edgeTypes } from './ThreadEdge';
import { ThreadLegend as Legend } from './ThreadLegend';
import { ThreadPreview } from './ThreadPreview';
import { AskLayer } from './tree/AskBox';
import { Breadcrumb } from './tree/Breadcrumb';
import { ExportSheet } from './tree/ExportSheet';
import { OutlineView } from './tree/OutlineView';
import { SpanMenu } from './tree/SpanMenu';
import { TreeEdges } from './tree/TreeEdges';

import type { CanvasNode } from '@/lib/api/types';
import './tree/tree.css';
import './beside.css';
import './cards.css';
import './threads.css';
import './legend.css';
import './chrome.css';

/**
 * Whether the board shows the thread key: only when it holds v0.2 threads (between loose cards).
 * A tree of passages, answers and notes has no pins and no threads, so it has nothing to key.
 *
 * @param threads How many threads the board has.
 */
export function showLegend(threads: number): boolean {
  return threads > 0;
}

/** The legend never changes with the board, so a drag does not redraw it. */
const ThreadLegend = memo(Legend);

/** Shift as well as Ctrl/Cmd adds to the selection (S9). */
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control'];

/**
 * What a focused card tells a screen reader it can do, L (keyboard linking, #213) included; while a
 * keyboard thread walks the cards, the walk's keys instead (the arrows pick, they do not move).
 * xyflow 12.12 reads `keyboardDisabled` when the keyboard is ENABLED (its names are swapped), so
 * both carry the sentence.
 */
const cardDescription = (text: string) => ({
  'node.a11yDescription.default': text,
  'node.a11yDescription.keyboardDisabled': text,
});
const CARD_KEYS = cardDescription(
  'Press Enter or Space to select a card, the arrow keys to move it, L to start a thread from it, and Delete to remove it.',
);
const WALK_KEYS = cardDescription(
  'Tab or the arrow keys choose where the thread goes, Enter links, Escape cancels.',
);

/**
 * The board of a paper that is not beside anything: the whole window. Its source links open the
 * reader with this board beside it (#349), and B does the same without a card.
 *
 * @param paperId The paper.
 * @returns The host.
 */
function fullWidthHost(paperId: string): BoardHost {
  return {
    beside: false,
    visiblePages: NO_PAGES,
    arrival: null,
    dragIn: null,
    showInPaper: (target) =>
      window.location.assign(besideHref(paperId, target.nodeId, target.citationId)),
    onBranched: () => undefined,
    onEscapeUnused: () => undefined,
    toggleSplit: () => window.location.assign(paperBesideHref(paperId)),
  };
}

/** Keys typed into a field are the field's, not the board's. */
const TYPING = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/**
 * The board of one paper: the whole page, or (inside the split view's host) the pane beside the paper.
 *
 * @example
 * <BoardView paperId="ppr_…" />
 */
export function BoardView({ paperId }: { readonly paperId: string }): ReactNode {
  return (
    <ReactFlowProvider>
      <Board paperId={paperId} />
    </ReactFlowProvider>
  );
}

/**
 * Publishes the board's zoom as `--pt-cv-zoom` on the stage, so the stylesheet can keep in-card
 * controls tappable (>= 40 px on screen) at phone widths. It writes the variable straight onto the
 * element: a pan or zoom must not re-render the whole board; and only in 0.05 steps
 * (`publishedZoom`), since every write restyles every card under the stage.
 */
function ZoomVar() {
  const zoom = useStore((state) => publishedZoom(state.transform[2]));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current
      ?.closest<HTMLElement>('.pt-cv__stage')
      ?.style.setProperty('--pt-cv-zoom', String(zoom));
  }, [zoom]);
  return <span ref={ref} hidden />;
}

/**
 * Whether the cards are glances now: one subscription for the whole board, which re-renders it only
 * when the zoom crosses the switch (`glanceAt`'s band keeps a hovering zoom from flickering).
 *
 * @param big Whether the board is drawn for scale (`bigBoard`).
 */
function useGlanceZoom(big: boolean): boolean {
  const was = useRef(false);
  const glance = useStore((state) =>
    glanceAt(state.transform[2], was.current, big, state.fitViewQueued),
  );
  was.current = glance;
  return glance;
}

/** "Deep Residual Learning, p. 3": where a passage came from, for the Markdown export. */
function exportSource(paperTitle: string | null, passage: CanvasNode): string | undefined {
  const page = anchorPageIndex(passage.source_anchor);
  const words = [paperTitle, page === null ? null : `p. ${String(page + 1)}`].filter(
    (w): w is string => w !== null && w !== '',
  );
  return words.length === 0 ? undefined : words.join(', ');
}

function Board({ paperId }: { readonly paperId: string }) {
  const provided = useProvidedHost();
  const host = useMemo(() => provided ?? fullWidthHost(paperId), [provided, paperId]);
  const beside = host.beside;
  const ctl = useBoardController(paperId);
  const big = bigBoard(ctl.nodes.length);
  const glance = useGlanceZoom(big);
  const flow = useReactFlow<PtNode, PtEdge>();
  const { selection, onSelectionChange } = useBoardSelection();
  const drawing = useThreadDrawing(ctl.nodes);
  const stage = useRef<HTMLDivElement>(null);
  const [areaMode, setAreaMode] = useState(false);
  const paperTitle = usePaperTitle(paperId);
  useUndoKeys(ctl.history);
  // The first view on any width is the WHOLE board (never zoomed in past 100 %, never out past 20 %).
  // A phone used to be capped at 60 %, which cropped a board wider than the screen; "Fit all" in
  // the toolbar brings the whole board back after the reader has panned or zoomed.
  const fitOptions = useMemo(() => ({ padding: 0.15, maxZoom: 1, minZoom: ZOOM_RANGE.min }), []);

  // xyflow reports the cards and the links of one Delete press in two separate callbacks; they are
  // joined here so one key press is one delete and one Undo.
  const queued = useRef({ nodes: new Set<string>(), edges: new Set<string>(), timer: false });
  const queueDelete = useCallback(
    (nodes: readonly string[], edges: readonly string[]) => {
      const q = queued.current;
      nodes.forEach((id) => q.nodes.add(id));
      edges.forEach((id) => q.edges.add(id));
      if (q.timer) return;
      q.timer = true;
      setTimeout(() => {
        const batch = { nodes: [...q.nodes], edges: [...q.edges] };
        q.nodes.clear();
        q.edges.clear();
        q.timer = false;
        ctl.deleteSelection(batch.nodes, batch.edges);
      }, 0);
    },
    [ctl],
  );

  const branch = useBranchBoard(paperId, ctl, stage, host);
  const dropIn = useDropIn(host, stage);
  const sources = useCardSources(paperId, ctl.nodes);
  // The cards as drawn: tree cards where Tidy put them, not where the row says.
  const nodes = useMemo(
    () => withPageTitles(branch.view.nodes, (pageId) => sources.pages.get(pageId)?.page.title),
    [branch.view.nodes, sources.pages],
  );
  const link = useLinkAs(ctl, drawing, nodes, stage);
  const tools = useBoardTools({
    ctl,
    selection,
    drawing,
    link,
    stage,
    areaMode,
    setAreaMode,
    fitOptions,
    branch,
    ...(beside ? {} : { paperBeside: host.toggleSplit }),
  });
  const selectedEdge =
    selection.edges.length === 1 ? ctl.edges.find((e) => e.id === selection.edges[0]) : undefined;

  const actions = useMemo(
    () => ({
      editingId: ctl.editingId,
      setEditingId: ctl.setEditingId,
      commitBody: ctl.commitBody,
      commitTitle: ctl.commitTitle,
      commitSize: ctl.commitSize,
      sources,
    }),
    [ctl.editingId, ctl.setEditingId, ctl.commitBody, ctl.commitTitle, ctl.commitSize, sources],
  );

  const ready = ctl.status === 'ready';
  const empty = ready && ctl.nodes.length === 0;
  const counts = countsLine(
    boardCounts(
      ctl.nodes.map((n) => n.data.node),
      ctl.edges.length,
    ),
  );
  const notice = drawing.refusal ?? ctl.notice;

  // The reader's own name for the board, else the paper's title; the default "Canvas" is neither.
  const givenName = boardName(ctl.board?.title, null);
  const title = boardName(ctl.board?.title, paperTitle) ?? 'Board';

  // B opens the paper beside a full-width board. (Beside the paper the reader owns the key.)
  useEffect(() => {
    if (beside) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'b' || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing)
        return;
      if (event.target instanceof Element && event.target.closest(TYPING) !== null) return;
      event.preventDefault();
      host.toggleSplit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beside, host]);

  return (
    <CanvasActionsProvider value={actions}>
      <BranchProvider value={branch.actions}>
        <div className="pt-cv" data-beside={beside ? '' : undefined}>
          <BoardHeader
            paperId={paperId}
            paperTitle={paperTitle}
            counts={ready ? counts : null}
            beside={beside}
            {...(givenName === null ? {} : { name: givenName })}
          >
            <BoardToolbar {...tools} />
          </BoardHeader>

          <main className="pt-cv__main">
            {notice === null || ctl.status === 'error' ? null : (
              <BoardNotice
                text={notice}
                onDismiss={() => {
                  drawing.dismissRefusal();
                  ctl.dismissNotice();
                }}
              />
            )}

            <div
              ref={stage}
              className="pt-cv__stage"
              data-testid="canvas-stage"
              data-status={ctl.status}
              {...dropIn.handlers}
            >
              {dropIn.mark === null ? null : (
                <>
                  <div
                    className="pt-drop__foot"
                    aria-hidden="true"
                    style={{
                      left: dropIn.mark.left,
                      top: dropIn.mark.top,
                      width: dropIn.mark.width,
                      height: dropIn.mark.height,
                    }}
                  />
                  <svg
                    className="pt-drop__cross"
                    aria-hidden="true"
                    viewBox="0 0 28 28"
                    style={{ left: dropIn.mark.x - 14, top: dropIn.mark.y - 14 }}
                  >
                    <circle cx="14" cy="14" r="5" />
                    <path d="M14 2v7M14 19v7M2 14h7M19 14h7" />
                  </svg>
                  <span
                    className="pt-drop__says"
                    aria-hidden="true"
                    style={{ left: dropIn.mark.x + 12, top: dropIn.mark.y + 12 }}
                  >
                    lands here
                  </span>
                </>
              )}
              {selectedEdge?.data === undefined ? null : (
                <ThreadBar
                  edge={selectedEdge.data.edge}
                  open={link.request?.mode === 'change'}
                  onKind={(opener) => link.changeKind(selectedEdge.id, opener)}
                  onLabel={(label) => ctl.patchEdge(selectedEdge.id, { label })}
                />
              )}

              {branch.control.ui.menu === null ? null : <SpanMenu menu={branch.control.ui.menu} />}
              {/* The selected link's bar owns the stage's top edge: the path waits behind it. */}
              {selectedEdge?.data === undefined ? <Breadcrumb /> : null}
              {ctl.status === 'loading' ? (
                <BoardLoading />
              ) : ctl.status === 'error' ? (
                <BoardFailed reason={ctl.notice} onRetry={() => void ctl.reload()} />
              ) : (
                <>
                  <LinkingProvider value={drawing.linking}>
                    <GlanceProvider value={glance}>
                      <ReactFlow<PtNode, PtEdge>
                        nodes={nodes}
                        edges={ctl.edges}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        onNodesChange={(changes) =>
                          branch.view.onNodesChange(changes, ctl.onNodesChange)
                        }
                        onEdgesChange={ctl.onEdgesChange}
                        onNodeDragStop={() => {
                          branch.view.onDragStop();
                          ctl.onNodeDragStop();
                        }}
                        {...drawing.flowProps}
                        onPaneClick={() => {
                          drawing.flowProps.onPaneClick?.();
                          branch.control.focus(null);
                        }}
                        onNodesDelete={(ns) =>
                          queueDelete(
                            ns.map((n) => n.id),
                            [],
                          )
                        }
                        onEdgesDelete={(es) =>
                          queueDelete(
                            [],
                            es.map((e) => e.id),
                          )
                        }
                        onSelectionChange={onSelectionChange}
                        onMoveEnd={(event, viewport) => {
                          // Programmatic moves (the first fit) have no event; only the reader's pan/zoom END is saved.
                          if (event !== null) ctl.saveViewport(viewport);
                        }}
                        onDoubleClick={(event) => {
                          const target = event.target as HTMLElement;
                          if (!target.classList.contains('react-flow__pane')) return;
                          void ctl.addNote(
                            flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                          );
                        }}
                        defaultViewport={ctl.initialViewport ?? undefined}
                        fitView={ctl.initialViewport === null && branch.arrivalCard === null}
                        fitViewOptions={fitOptions}
                        minZoom={ZOOM_RANGE.min}
                        maxZoom={ZOOM_RANGE.max}
                        zoomOnDoubleClick={false}
                        // Delete only: Backspace is a typing key and one stray press must not remove a card.
                        deleteKeyCode={['Delete']}
                        // S9: Shift, Ctrl and Cmd all ADD to the selection (React Flow's own default is
                        // Meta/Ctrl only). Shift-drag on the empty board still draws a selection box.
                        multiSelectionKeyCode={MULTI_SELECT_KEYS}
                        selectionOnDrag={areaMode}
                        panOnDrag={!areaMode}
                        elevateNodesOnSelect={false}
                        nodesFocusable
                        edgesFocusable
                        ariaLabelConfig={link.keyboard.walking ? WALK_KEYS : CARD_KEYS}
                        onKeyDown={(event) => {
                          link.keyboard.onKeyDown(event);
                          // Enter or Space on a focused tree card focuses its path, as a click does.
                          const target = event.target;
                          if (
                            event.defaultPrevented ||
                            (event.key !== 'Enter' && event.key !== ' ') ||
                            !(target instanceof HTMLElement) ||
                            !target.classList.contains('react-flow__node')
                          ) {
                            return;
                          }
                          const id = target.dataset.id;
                          if (id !== undefined && branch.view.layout.cards.has(id)) {
                            branch.control.focus(id);
                          }
                        }}
                        onlyRenderVisibleElements={big}
                        aria-label="Board of passages, explanations and notes"
                      >
                        <ZoomVar />
                        <TreeEdges layout={branch.view.layout} onPath={branch.onPath} />
                        <AskLayer />
                        {link.preview === null ? null : <ThreadPreview {...link.preview} />}
                        <Background gap={24} size={1} />
                        <BoardMinimap empty={empty} />
                      </ReactFlow>
                    </GlanceProvider>
                  </LinkingProvider>
                  {empty ? <EmptyBoard paperId={paperId} /> : null}
                  {link.request === null ? null : (
                    <LinkAsLayer
                      request={link.request}
                      nodes={nodes}
                      stage={stage}
                      onChoose={link.choose}
                      onCancel={link.cancel}
                    />
                  )}
                </>
              )}
            </div>
            {/* v0.2 threads join loose cards only; the key to them is drawn under the stage, in the
                flow, and only when the board has one. It never lies over the cards, the minimap or an
                ask box. */}
            {ready && !empty && showLegend(ctl.edges.length) ? (
              <ThreadLegend glance={glance} />
            ) : null}
            {branch.control.ui.outline ? (
              <OutlineView
                tree={branch.view.tree}
                title={title}
                countsLine={counts}
                onExport={() => branch.control.setSheet(true)}
                onBack={() => branch.control.setOutline(false)}
              />
            ) : null}
            {branch.control.ui.sheet ? (
              <ExportSheet
                tree={branch.view.tree}
                title={title}
                sourceOf={(passage) => exportSource(paperTitle, passage)}
                onClose={() => branch.control.setSheet(false)}
              />
            ) : null}
            {/* The board's spoken line (linking by keyboard, S6c); inside `main`, beside the board. */}
            <p className="pt-sr-only" role="status" aria-live="polite" data-testid="board-said">
              {link.said}
            </p>

            {ctl.undo === null ? null : (
              <UndoToast
                message={ctl.undo.message}
                onUndo={() => void ctl.runUndo()}
                onDismiss={ctl.dismissUndo}
              />
            )}
          </main>
        </div>
      </BranchProvider>
    </CanvasActionsProvider>
  );
}
