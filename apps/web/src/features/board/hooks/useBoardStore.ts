'use client';

/**
 * board/hooks/useBoardStore — the board's working copy and its one read.
 *
 * `nodesRef` is the working copy: handlers read and write it synchronously and then publish it with
 * `setNodes`, so two events in the same tick cannot overwrite each other. The other refs are the
 * bookkeeping the write hooks share: the position each card was last sent with, the version each
 * card holds, and one promise chain per card (one PATCH at a time per card).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { boardsApi } from '@/lib/api/boards';

import { toFlowEdge, toFlowNode, type PtEdge, type PtNode } from '../model/flow';
import { sentence, type Status } from './controllerShared';

import type { Board, CanvasEdge, CanvasNode } from '@/lib/api/types';
import type { Viewport } from '@xyflow/react';

/** The shared state and refs; every other controller hook takes this and works on it. */
export interface BoardStore {
  readonly status: Status;
  readonly board: Board | null;
  readonly nodes: PtNode[];
  readonly edges: PtEdge[];
  readonly notice: string | null;
  readonly setNotice: (notice: string | null) => void;
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
  readonly initialViewport: Viewport | null;
  readonly nodesRef: { current: PtNode[] };
  readonly edgesRef: { current: PtEdge[] };
  readonly boardRef: { current: Board | null };
  /** The position each node was last sent with (or loaded with): what "moved" means. */
  readonly sentRef: { current: Map<string, { x: number; y: number }> };
  readonly versionRef: { current: Map<string, number> };
  readonly chainRef: { readonly current: Map<string, Promise<void>> };
  /** Cards whose DELETE is on its way: a reload that races it must not show them again. */
  readonly deletingRef: { readonly current: Set<string> };
  readonly aliveRef: { current: boolean };
  readonly lastViewport: { current: Viewport | null };
  readonly setNodes: (next: PtNode[]) => void;
  readonly setEdges: (next: PtEdge[]) => void;
  readonly setBoardBoth: (next: Board | null) => void;
  /** A stored thread as xyflow draws it, its missing pins resolved from the cards' kinds. */
  readonly threadOf: (edge: CanvasEdge) => PtEdge;
  readonly adopt: (view: { board: Board | null; nodes: CanvasNode[]; edges: CanvasEdge[] }) => void;
  readonly reload: () => Promise<void>;
  /** Shows a field change on a card at once (the PATCH is the caller's). */
  readonly mergeData: (id: string, patch: Partial<CanvasNode>) => void;
}

/**
 * The board's state for one paper, loaded once on mount.
 *
 * @param paperId The paper whose board this is.
 * @param holds Whether the history holds a step that writes this card (it keeps its version on reload).
 * @returns The store.
 */
export function useBoardStore(paperId: string, holds: (id: string) => boolean): BoardStore {
  const [status, setStatus] = useState<Status>('loading');
  const [board, setBoard] = useState<Board | null>(null);
  const [nodes, setNodesState] = useState<PtNode[]>([]);
  const [edges, setEdgesState] = useState<PtEdge[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialViewport, setInitialViewport] = useState<Viewport | null>(null);

  const nodesRef = useRef<PtNode[]>([]);
  const edgesRef = useRef<PtEdge[]>([]);
  const boardRef = useRef<Board | null>(null);
  const sentRef = useRef(new Map<string, { x: number; y: number }>());
  const versionRef = useRef(new Map<string, number>());
  const chainRef = useRef(new Map<string, Promise<void>>());
  const deletingRef = useRef(new Set<string>());
  const lastViewport = useRef<Viewport | null>(null);
  const aliveRef = useRef(true);

  const setNodes = useCallback((next: PtNode[]) => {
    nodesRef.current = next;
    setNodesState(next);
  }, []);
  const setEdges = useCallback((next: PtEdge[]) => {
    edgesRef.current = next;
    setEdgesState(next);
  }, []);
  const setBoardBoth = useCallback((next: Board | null) => {
    boardRef.current = next;
    setBoard(next);
  }, []);

  const threadOf = useCallback((edge: CanvasEdge): PtEdge => {
    const kind = (id: string) => nodesRef.current.find((n) => n.id === id)?.data.node.kind;
    return toFlowEdge(edge, { from: kind(edge.from_node_id), to: kind(edge.to_node_id) });
  }, []);

  const adopt = useCallback(
    (view: { board: Board | null; nodes: CanvasNode[]; edges: CanvasEdge[] }) => {
      const rows = view.nodes.filter((n) => !deletingRef.current.has(n.node_id));
      sentRef.current = new Map(rows.map((n) => [n.node_id, { x: n.x, y: n.y }]));
      // A card a step writes keeps the version held here: if another tab changed it, the undo
      // answers 409 instead of overwriting what this read just showed (#215 review S2).
      const held = versionRef.current;
      versionRef.current = new Map(
        rows.map((n) => [
          n.node_id,
          (holds(n.node_id) ? held.get(n.node_id) : n.version) ?? n.version,
        ]),
      );
      setBoardBoth(view.board);
      setNodes(rows.map((n) => toFlowNode(n, paperId)));
      const kinds = new Map(rows.map((n) => [n.node_id, n.kind] as const));
      setEdges(
        view.edges
          .filter((e) => kinds.has(e.from_node_id) && kinds.has(e.to_node_id))
          .map((e) =>
            toFlowEdge(e, { from: kinds.get(e.from_node_id), to: kinds.get(e.to_node_id) }),
          ),
      );
    },
    [holds, paperId, setBoardBoth, setEdges, setNodes],
  );

  const reload = useCallback(async () => {
    try {
      const view = await boardsApi.get(paperId);
      if (!aliveRef.current) return;
      adopt(view);
      lastViewport.current = view.board?.viewport ?? null;
      setInitialViewport((current) => current ?? view.board?.viewport ?? null);
      setStatus('ready');
    } catch (error) {
      if (!aliveRef.current) return;
      setNotice(
        sentence(error, "Couldn't load your board. Check your connection, then try again."),
      );
      setStatus((s) => (s === 'loading' ? 'error' : s));
    }
  }, [adopt, paperId]);

  useEffect(() => {
    aliveRef.current = true;
    void reload();
    return () => {
      aliveRef.current = false;
    };
  }, [reload]);

  const mergeData = useCallback(
    (id: string, patch: Partial<CanvasNode>) => {
      setNodes(
        nodesRef.current.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } } } : n,
        ),
      );
    },
    [setNodes],
  );

  return {
    status,
    board,
    nodes,
    edges,
    notice,
    setNotice,
    editingId,
    setEditingId,
    initialViewport,
    nodesRef,
    edgesRef,
    boardRef,
    sentRef,
    versionRef,
    chainRef,
    deletingRef,
    aliveRef,
    lastViewport,
    setNodes,
    setEdges,
    setBoardBoth,
    threadOf,
    adopt,
    reload,
    mergeData,
  };
}
