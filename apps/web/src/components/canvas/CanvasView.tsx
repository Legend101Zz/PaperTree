'use client';

/**
 * canvas/CanvasView — the page body: header with the toolbar, the board, the empty state.
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
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EdgeKind } from '@/lib/api/types';

import { CanvasActionsProvider } from './CanvasContext';
import { KindPicker } from './KindPicker';
import { edgeTypes } from './LabeledEdge';
import { EDGE_KINDS, nodeLabel, type PtEdge, type PtNode } from './model';
import { nodeTypes } from './nodes';
import { useBoardController } from './useBoardController';
import { useExplanationCitations } from './useExplanationCitations';

interface Selection {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}
const NONE: Selection = { nodes: [], edges: [] };

/** Shift as well as Ctrl/Cmd adds to the selection (S9). */
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control'];

export function CanvasView({ paperId }: { readonly paperId: string }) {
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
  const [picking, setPicking] = useState<{ from: string; to: string } | null>(null);
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

  const labelOf = useCallback(
    (id: string) => {
      const n = ctl.nodes.find((x) => x.id === id);
      return n === undefined ? 'Card' : nodeLabel(n.data.node);
    },
    [ctl.nodes],
  );

  const onConnect = useCallback((c: Connection) => {
    if (c.source !== c.target) setPicking({ from: c.source, to: c.target });
  }, []);

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

  const citations = useExplanationCitations(paperId, ctl.nodes);
  const actions = useMemo(
    () => ({
      editingId: ctl.editingId,
      setEditingId: ctl.setEditingId,
      commitBody: ctl.commitBody,
      commitTitle: ctl.commitTitle,
      commitSize: ctl.commitSize,
      citations,
    }),
    [ctl.editingId, ctl.setEditingId, ctl.commitBody, ctl.commitTitle, ctl.commitSize, citations],
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
              onClick={() => {
                const [from, to] = selection.nodes;
                if (from !== undefined && to !== undefined) setPicking({ from, to });
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

        {ctl.notice === null || ctl.status === 'error' ? null : (
          <div className="pt-cv__notice" role="alert">
            <span>{ctl.notice}</span>
            <button type="button" className="pt-btn" onClick={ctl.dismissNotice}>
              Dismiss
            </button>
          </div>
        )}

        <div className="pt-cv__stage" data-testid="canvas-stage" data-status={ctl.status}>
          {selectedEdge?.data === undefined ? null : (
            <div className="pt-cv__edgebar" role="group" aria-label="Selected link">
              <label className="pt-cv-field pt-cv-field--inline">
                <span>Kind</span>
                <select
                  className="pt-field"
                  value={selectedEdge.data.edge.kind}
                  onChange={(e) =>
                    ctl.patchEdge(selectedEdge.id, { kind: e.target.value as EdgeKind })
                  }
                >
                  {EDGE_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pt-cv-field pt-cv-field--inline">
                <span>Label</span>
                <input
                  key={`${selectedEdge.id}:${selectedEdge.data.edge.label ?? ''}`}
                  className="pt-field"
                  defaultValue={selectedEdge.data.edge.label ?? ''}
                  maxLength={80}
                  placeholder={selectedEdge.data.edge.kind.replace('_', ' ')}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  onBlur={(e) => {
                    const next = e.target.value.trim() === '' ? null : e.target.value.trim();
                    if (next !== selectedEdge.data?.edge.label)
                      ctl.patchEdge(selectedEdge.id, { label: next });
                  }}
                />
              </label>
            </div>
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
              <ReactFlow<PtNode, PtEdge>
                nodes={ctl.nodes}
                edges={ctl.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={ctl.onNodesChange}
                onEdgesChange={ctl.onEdgesChange}
                onNodeDragStop={ctl.onNodeDragStop}
                onConnect={onConnect}
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
                aria-label="Canvas of passages, explanations and notes"
              >
                <ZoomVar />
                <Background gap={24} size={1} />
                <Controls
                  showInteractive={false}
                  position="bottom-left"
                  fitViewOptions={fitOptions}
                />
              </ReactFlow>
              {empty ? <EmptyState paperId={paperId} /> : null}
            </>
          )}
        </div>

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

        {picking === null ? null : (
          <KindPicker
            fromLabel={labelOf(picking.from)}
            toLabel={labelOf(picking.to)}
            onCancel={() => setPicking(null)}
            onPick={(kind, label) => {
              const { from, to } = picking;
              setPicking(null);
              void ctl.connect(from, to, kind, label);
            }}
          />
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
