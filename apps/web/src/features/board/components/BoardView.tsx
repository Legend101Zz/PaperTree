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
import { useBoardTools } from '../hooks/useBoardTools';
import { useCardSources } from '../hooks/useCardSources';
import { useLinkAs } from '../hooks/useLinkAs';
import { usePaperTitle } from '../hooks/usePaperTitle';
import { useThreadDrawing } from '../hooks/useThreadDrawing';
import { useUndoKeys } from '../hooks/useUndoKeys';
import { ZOOM_RANGE, boardCounts, countsLine } from '../model/chrome';
import { withPageTitles, type PtEdge, type PtNode } from '../model/flow';
import { bigBoard, glanceAt, publishedZoom } from '../model/glance';
import { BoardHeader } from './BoardHeader';
import { BoardMinimap } from './BoardMinimap';
import { BoardFailed, BoardLoading, BoardNotice, UndoToast } from './BoardStates';
import { BoardToolbar } from './BoardToolbar';
import { CanvasActionsProvider, GlanceProvider, LinkingProvider } from './BoardContext';
import { nodeTypes } from './cards';
import { EmptyBoard } from './EmptyBoard';
import { LinkAsLayer } from './LinkAsLayer';
import { ThreadBar } from './ThreadBar';
import { edgeTypes } from './ThreadEdge';
import { ThreadLegend as Legend } from './ThreadLegend';
import { ThreadPreview } from './ThreadPreview';
import './cards.css';
import './threads.css';
import './legend.css';
import './chrome.css';

/**
 * The reader URL that opens a card's cited passage and flashes it (`useFocusFromCanvas`).
 *
 * @param paperId The paper.
 * @param nodeId The AI card the marker is on.
 * @param citationId The citation behind the marker.
 * @param threadId The thread the answer is in, so the reader reads that one thread only.
 * @returns `/paper/<id>/read?focus=<card>&cite=<citation>[&thread=<thread>]`.
 */
export function citationHref(
  paperId: string,
  nodeId: string,
  citationId: string,
  threadId?: string,
): string {
  const q = new URLSearchParams({ focus: nodeId, cite: citationId });
  if (threadId !== undefined) q.set('thread', threadId);
  return `/paper/${encodeURIComponent(paperId)}/read?${q.toString()}`;
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
 * The board page for one paper.
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

function Board({ paperId }: { readonly paperId: string }) {
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

  const sources = useCardSources(paperId, ctl.nodes);
  const nodes = useMemo(
    () => withPageTitles(ctl.nodes, (pageId) => sources.pages.get(pageId)?.page.title),
    [ctl.nodes, sources.pages],
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
      openCitation: (nodeId: string, citationId: string, threadId?: string) =>
        window.location.assign(citationHref(paperId, nodeId, citationId, threadId)),
      sources,
    }),
    [
      ctl.editingId,
      ctl.setEditingId,
      ctl.commitBody,
      ctl.commitTitle,
      ctl.commitSize,
      paperId,
      sources,
    ],
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

  return (
    <CanvasActionsProvider value={actions}>
      <div className="pt-cv">
        <BoardHeader paperId={paperId} paperTitle={paperTitle} counts={ready ? counts : null}>
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
          >
            {selectedEdge?.data === undefined ? null : (
              <ThreadBar
                edge={selectedEdge.data.edge}
                open={link.request?.mode === 'change'}
                onKind={(opener) => link.changeKind(selectedEdge.id, opener)}
                onLabel={(label) => ctl.patchEdge(selectedEdge.id, { label })}
              />
            )}

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
                      onNodesChange={ctl.onNodesChange}
                      onEdgesChange={ctl.onEdgesChange}
                      onNodeDragStop={ctl.onNodeDragStop}
                      {...drawing.flowProps}
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
                      fitView={ctl.initialViewport === null}
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
                      onKeyDown={link.keyboard.onKeyDown}
                      onlyRenderVisibleElements={big}
                      aria-label="Board of passages, explanations and notes"
                    >
                      <ZoomVar />
                      {link.preview === null ? null : <ThreadPreview {...link.preview} />}
                      <Background gap={24} size={1} />
                      <BoardMinimap empty={empty} />
                    </ReactFlow>
                  </GlanceProvider>
                </LinkingProvider>
                {empty ? <EmptyBoard paperId={paperId} /> : <ThreadLegend glance={glance} />}
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
    </CanvasActionsProvider>
  );
}
