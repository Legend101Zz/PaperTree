'use client';

/**
 * board/components/BoardView — the page body: header with the toolbar, the board, the empty state.
 *
 * Nothing here talks to the API directly; every gesture goes through `useBoardController`, which is
 * the only module that sends a request (and only on the gestures contracts.md §2.7 lists).
 */
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useBoardController } from '../hooks/useBoardController';
import { useCardSources } from '../hooks/useCardSources';
import { useLinkAs } from '../hooks/useLinkAs';
import { useThreadDrawing } from '../hooks/useThreadDrawing';
import { withPageTitles, type PtEdge, type PtNode } from '../model/flow';
import { CanvasActionsProvider, LinkingProvider } from './BoardContext';
import { nodeTypes } from './cards';
import { LinkAsLayer } from './LinkAsLayer';
import { ThreadBar } from './ThreadBar';
import { edgeTypes } from './ThreadEdge';
import { ThreadLegend } from './ThreadLegend';
import { ThreadPreview } from './ThreadPreview';
import './cards.css';
import './threads.css';
import './legend.css';

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

interface Selection {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}
const NONE: Selection = { nodes: [], edges: [] };

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
      <Canvas paperId={paperId} />
    </ReactFlowProvider>
  );
}

/**
 * Publishes the canvas zoom as `--pt-cv-zoom` on the stage, so the stylesheet can keep in-card
 * controls tappable (>= 40 px on screen) at phone widths. It writes the variable straight onto the
 * element: a pan or zoom must not re-render the whole canvas.
 */
function ZoomVar() {
  const zoom = useStore((state) => state.transform[2]);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current
      ?.closest<HTMLElement>('.pt-cv__stage')
      ?.style.setProperty('--pt-cv-zoom', String(zoom));
  }, [zoom]);
  return <span ref={ref} hidden />;
}

function Canvas({ paperId }: { readonly paperId: string }) {
  const ctl = useBoardController(paperId);
  const flow = useReactFlow<PtNode, PtEdge>();
  const [selection, setSelection] = useState<Selection>(NONE);
  const order = useRef<string[]>([]);
  const drawing = useThreadDrawing(ctl.nodes);
  const stage = useRef<HTMLDivElement>(null);
  const [areaMode, setAreaMode] = useState(false);
  // The first view on any width is the WHOLE board (never zoomed in past 100 %, never out past 20 %).
  // A phone used to be capped at 60 %, which cropped a board wider than the screen; "Fit all" in
  // the toolbar brings the whole board back after the reader has panned or zoomed.
  const fitOptions = useMemo(() => ({ padding: 0.15, maxZoom: 1, minZoom: 0.2 }), []);

  // xyflow reports the cards and the links of one Delete press in two separate callbacks; they are
  // joined here so one key press is one delete and one Undo.
  const queued = useRef<{
    nodes: Set<string>;
    edges: Set<string>;
    timer: ReturnType<typeof setTimeout> | null;
  }>({
    nodes: new Set(),
    edges: new Set(),
    timer: null,
  });
  const queueDelete = useCallback(
    (nodes: readonly string[], edges: readonly string[]) => {
      const q = queued.current;
      nodes.forEach((id) => q.nodes.add(id));
      edges.forEach((id) => q.edges.add(id));
      if (q.timer !== null) return;
      q.timer = setTimeout(() => {
        const batch = { nodes: [...q.nodes], edges: [...q.edges] };
        q.nodes.clear();
        q.edges.clear();
        q.timer = null;
        ctl.deleteSelection(batch.nodes, batch.edges);
      }, 0);
    },
    [ctl],
  );

  const onSelectionChange = useCallback(
    ({ nodes, edges }: { nodes: { id: string }[]; edges: { id: string }[] }) => {
      const ids = nodes.map((n) => n.id);
      // Remember the order cards were picked in: a link goes from the first to the second.
      order.current = [
        ...order.current.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !order.current.includes(id)),
      ];
      const next: Selection = { nodes: [...order.current], edges: edges.map((e) => e.id) };
      setSelection((prev) =>
        prev.nodes.join() === next.nodes.join() && prev.edges.join() === next.edges.join()
          ? prev
          : next,
      );
    },
    [],
  );

  const sources = useCardSources(paperId, ctl.nodes);
  const nodes = useMemo(
    () => withPageTitles(ctl.nodes, (pageId) => sources.pages.get(pageId)?.page.title),
    [ctl.nodes, sources.pages],
  );
  const link = useLinkAs(ctl, drawing, nodes, stage);

  const selectedNodes = useMemo(
    () => ctl.nodes.filter((n) => selection.nodes.includes(n.id)),
    [ctl.nodes, selection.nodes],
  );
  const selectedGroups = selectedNodes.filter((n) => n.data.node.kind === 'group');
  const cards = selectedNodes.filter((n) => n.data.node.kind !== 'group');
  const selectedEdge =
    selection.edges.length === 1 ? ctl.edges.find((e) => e.id === selection.edges[0]) : undefined;
  const anySelected = selection.nodes.length + selection.edges.length > 0;

  const doDelete = (): void => {
    ctl.deleteSelection(selection.nodes, selection.edges);
  };

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

  const empty = ctl.status === 'ready' && ctl.nodes.length === 0;

  return (
    <CanvasActionsProvider value={actions}>
      <div className="pt-cv">
        <header className="pt-reader__bar pt-cv__bar">
          <a className="pt-btn" href={`/paper/${encodeURIComponent(paperId)}/read`}>
            <span aria-hidden="true">←</span>
            <span>Back to paper</span>
          </a>
          <h1 className="pt-reader__title">Canvas</h1>
          <div className="pt-cv__tools" role="toolbar" aria-label="Canvas tools">
            <button
              type="button"
              className="pt-btn pt-btn--outline"
              onClick={() => void ctl.addNote()}
              disabled={ctl.status !== 'ready'}
            >
              Add note
            </button>
            <button
              type="button"
              className="pt-btn pt-btn--outline"
              aria-pressed={areaMode}
              title="Drag across the canvas to select several cards. Shift, Ctrl or Cmd plus click adds a card to the selection."
              onClick={() => setAreaMode((v) => !v)}
            >
              Select area
            </button>
            <button
              type="button"
              className="pt-btn pt-btn--outline"
              disabled={cards.length < 2}
              title="Group the selected cards. Select two or more with Shift, Ctrl or Cmd plus click."
              onClick={() => void ctl.groupNodes(cards.map((n) => n.id))}
            >
              Group
            </button>
            <button
              type="button"
              className="pt-btn pt-btn--outline"
              disabled={selectedGroups.length === 0}
              onClick={() => ctl.deleteNodes(selectedGroups.map((n) => n.id))}
            >
              Ungroup
            </button>
            <button
              type="button"
              className="pt-btn pt-btn--outline"
              disabled={selection.nodes.length !== 2}
              // The tooltip, and the accessible description, say why it is off and what turns it on.
              title={
                selection.nodes.length === 2
                  ? 'Link the two selected cards with a thread, from the first to the second.'
                  : 'Select exactly two cards to link them: Shift, Ctrl or Cmd plus click, or Select area.'
              }
              onClick={() => {
                const [from, to] = selection.nodes;
                if (from !== undefined && to !== undefined) drawing.link(from, to);
              }}
            >
              Link
            </button>
            <button
              type="button"
              className="pt-btn pt-btn--outline pt-btn--danger"
              disabled={!anySelected}
              onClick={doDelete}
            >
              Delete
            </button>
            <button
              type="button"
              className="pt-btn pt-btn--outline"
              disabled={ctl.status !== 'ready' || ctl.nodes.length === 0}
              onClick={() => {
                void flow.fitView(fitOptions);
              }}
            >
              Fit all
            </button>
          </div>
        </header>

        {(drawing.refusal ?? ctl.notice) === null || ctl.status === 'error' ? null : (
          <div className="pt-cv__notice" role="alert">
            <span>{drawing.refusal ?? ctl.notice}</span>
            <button
              type="button"
              className="pt-btn"
              onClick={() => {
                drawing.dismissRefusal();
                ctl.dismissNotice();
              }}
            >
              Dismiss
            </button>
          </div>
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
            <div className="pt-cv__skeleton" role="status" aria-label="Loading your canvas">
              <div className="pt-skeleton__page" />
            </div>
          ) : ctl.status === 'error' ? (
            <div className="pt-state" role="alert">
              <h2 className="pt-state__title">Your canvas didn&apos;t load</h2>
              <p className="pt-state__body">
                {ctl.notice ?? 'Check your connection, then try again.'}
              </p>
              <button
                type="button"
                className="pt-btn pt-btn--primary"
                onClick={() => void ctl.reload()}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <LinkingProvider value={drawing.linking}>
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
                  minZoom={0.2}
                  maxZoom={2}
                  zoomOnDoubleClick={false}
                  // Delete only: Backspace is a typing key and one stray press must not remove a card.
                  deleteKeyCode={['Delete']}
                  // S9: Shift, Ctrl and Cmd all ADD to the selection (React Flow's own default is
                  // Meta/Ctrl only). Shift-drag on the empty canvas still draws a selection box.
                  multiSelectionKeyCode={MULTI_SELECT_KEYS}
                  selectionOnDrag={areaMode}
                  panOnDrag={!areaMode}
                  elevateNodesOnSelect={false}
                  nodesFocusable
                  edgesFocusable
                  ariaLabelConfig={link.keyboard.walking ? WALK_KEYS : CARD_KEYS}
                  onKeyDown={link.keyboard.onKeyDown}
                  aria-label="Canvas of passages, explanations and notes"
                >
                  <ZoomVar />
                  {link.preview === null ? null : <ThreadPreview {...link.preview} />}
                  <Background gap={24} size={1} />
                  <Controls
                    showInteractive={false}
                    position="bottom-left"
                    fitViewOptions={fitOptions}
                  />
                </ReactFlow>
              </LinkingProvider>
              {empty ? <EmptyState paperId={paperId} /> : <ThreadLegend />}
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
        <p className="pt-sr-only" role="status" aria-live="polite">
          {link.said}
        </p>

        {ctl.undo === null ? null : (
          <div
            className="pt-toast pt-toast--lift"
            role="status"
            aria-live="polite"
            data-testid="undo-toast"
          >
            <div className="pt-toast__body">
              <span>{ctl.undo.message}</span>
              <button
                type="button"
                className="pt-btn pt-btn--outline"
                onClick={() => void ctl.runUndo()}
              >
                Undo
              </button>
              <button
                type="button"
                className="pt-btn"
                aria-label="Dismiss"
                onClick={ctl.dismissUndo}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </CanvasActionsProvider>
  );
}

function EmptyState({ paperId }: { readonly paperId: string }) {
  return (
    <div className="pt-cv__empty" data-testid="canvas-empty">
      <div className="pt-cv__empty-card">
        <h2 className="pt-state__title">Nothing on your canvas yet</h2>
        <p className="pt-state__body">
          The canvas holds only what you put on it. Select a passage in the paper and choose Send to
          canvas, or open an explanation and send it here. You can also add a note of your own.
        </p>
        <a className="pt-btn pt-btn--primary" href={`/paper/${encodeURIComponent(paperId)}/read`}>
          Open the paper
        </a>
      </div>
    </div>
  );
}
