'use client';

/**
 * canvas/useBoardController — the one place the canvas talks to the API.
 *
 * THE RULE (contracts.md §2.7): the client writes only on explicit gestures — drag END (one PATCH
 * per node that moved), an edit commit, connect, group, delete, and pan/zoom END for the viewport.
 * A settled canvas makes no request at all: there is no polling, no refetch on focus, no autosave
 * timer. The only timer is the 400 ms debounce that turns a run of arrow-key nudges into one PATCH.
 *
 * LOCAL FIRST, THEN THE SERVER. A change is applied to the screen at once and sent after; if the
 * server refuses it, the reader sees a sentence and the board is reloaded from the server, so the
 * screen never keeps a change the server does not have (failures are visible, never faked).
 *
 * ONE PATCH AT A TIME PER NODE. Each node has a promise chain, so a drag followed by an edit sends
 * two requests in order, each carrying the version the previous one returned.
 *
 * `nodesRef` is the working copy: handlers read and write it synchronously and then publish it with
 * `setNodes`, so two events in the same tick cannot overwrite each other.
 */
import { applyEdgeChanges, applyNodeChanges, type EdgeChange, type NodeChange, type Viewport } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { boardsApi } from '@/lib/api/boards';
import { ApiError, type Board, type CanvasEdge, type CanvasNode, type EdgeKind } from '@/lib/api/types';

import { newEdgeId, newNodeId } from './ids';
import { toFlowEdge, toFlowNode, type PtEdge, type PtNode } from './model';
import { DEFAULT_SIZE, boundsOf, freeSpot } from './placement';

export const NUDGE_DEBOUNCE_MS = 400;

export type Status = 'loading' | 'ready' | 'error';

export interface BoardController {
  readonly status: Status;
  readonly board: Board | null;
  readonly nodes: PtNode[];
  readonly edges: PtEdge[];
  readonly notice: string | null;
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
  readonly dismissNotice: () => void;
  readonly reload: () => Promise<void>;
  readonly onNodesChange: (changes: NodeChange<PtNode>[]) => void;
  readonly onEdgesChange: (changes: EdgeChange<PtEdge>[]) => void;
  readonly onNodeDragStop: () => void;
  readonly addNote: (near?: { x: number; y: number }) => Promise<void>;
  readonly commitBody: (id: string, body: string) => void;
  readonly commitTitle: (id: string, title: string) => void;
  readonly commitSize: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  readonly deleteNodes: (ids: readonly string[]) => void;
  readonly deleteEdges: (ids: readonly string[]) => void;
  readonly connect: (from: string, to: string, kind: EdgeKind, label: string | null) => Promise<void>;
  readonly patchEdge: (id: string, fields: { kind?: EdgeKind; label?: string | null }) => void;
  readonly groupNodes: (ids: readonly string[]) => Promise<void>;
  readonly saveViewport: (viewport: Viewport) => void;
  readonly initialViewport: Viewport | null;
}

function sentence(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status !== 0 && error.detail.trim() !== '') {
    return error.code === 'internal' ? fallback : error.detail;
  }
  return fallback;
}

export function useBoardController(paperId: string): BoardController {
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
  /** The position/size each node was last sent with (or loaded with): what "moved" means. */
  const sentRef = useRef(new Map<string, { x: number; y: number }>());
  const versionRef = useRef(new Map<string, number>());
  const chainRef = useRef(new Map<string, Promise<void>>());
  const nudgeIds = useRef(new Set<string>());
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const adopt = useCallback(
    (view: { board: Board | null; nodes: CanvasNode[]; edges: CanvasEdge[] }) => {
      sentRef.current = new Map(view.nodes.map((n) => [n.node_id, { x: n.x, y: n.y }]));
      versionRef.current = new Map(view.nodes.map((n) => [n.node_id, n.version]));
      setBoardBoth(view.board);
      setNodes(view.nodes.map((n) => toFlowNode(n, paperId)));
      setEdges(view.edges.map(toFlowEdge));
    },
    [paperId, setBoardBoth, setEdges, setNodes],
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
        sentence(error, "Couldn't load your canvas. Check your connection, then try again."),
      );
      setStatus((s) => (s === 'loading' ? 'error' : s));
    }
  }, [adopt, paperId]);

  useEffect(() => {
    aliveRef.current = true;
    void reload();
    return () => {
      aliveRef.current = false;
      if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    };
  }, [reload]);

  // ── writes ────────────────────────────────────────────────────────────────────────────────

  const failed = useCallback(
    (error: unknown, fallback: string) => {
      if (!aliveRef.current) return;
      if (error instanceof ApiError && error.code === 'stale_version') {
        setNotice('This card was changed somewhere else. The latest version is shown.');
      } else {
        setNotice(sentence(error, fallback));
      }
      void reload();
    },
    [reload],
  );

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

  const patchNode = useCallback(
    (id: string, fields: Record<string, unknown>) => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return;
      const run = async (): Promise<void> => {
        const version = versionRef.current.get(id);
        if (version === undefined) return;
        try {
          const saved = await boardsApi.patchNode(boardId, id, { version, ...fields });
          versionRef.current.set(id, saved.version);
          if (aliveRef.current) {
            mergeData(id, { version: saved.version, updated_at: saved.updated_at });
          }
        } catch (error) {
          failed(error, "Couldn't save that change. The canvas was reloaded from your last saved version.");
        }
      };
      chainRef.current.set(id, (chainRef.current.get(id) ?? Promise.resolve()).then(run));
    },
    [failed, mergeData],
  );

  const flushPositions = useCallback(
    (ids: Iterable<string>) => {
      for (const id of ids) {
        const node = nodesRef.current.find((n) => n.id === id);
        if (node === undefined) continue;
        const sent = sentRef.current.get(id);
        const { x, y } = node.position;
        if (sent !== undefined && sent.x === x && sent.y === y) continue;
        sentRef.current.set(id, { x, y });
        mergeData(id, { x, y });
        patchNode(id, { x, y });
      }
    },
    [mergeData, patchNode],
  );

  const onNodesChange = useCallback(
    (incoming: NodeChange<PtNode>[]) => {
      const changes: NodeChange<PtNode>[] = [];
      const touched = new Set(
        incoming.filter((c) => c.type === 'position').map((c) => (c as { id: string }).id),
      );
      for (const change of incoming) {
        // Deleting goes through `deleteNodes` (API first-class), never through xyflow's own removal.
        if (change.type === 'remove') continue;
        changes.push(change);
        if (change.type === 'position' && change.position !== undefined) {
          const moved = nodesRef.current.find((n) => n.id === change.id);
          if (moved?.data.node.kind === 'group') {
            const dx = change.position.x - moved.position.x;
            const dy = change.position.y - moved.position.y;
            for (const member of nodesRef.current) {
              if (member.data.node.group_id !== moved.id || touched.has(member.id)) continue;
              changes.push({
                type: 'position',
                id: member.id,
                position: { x: member.position.x + dx, y: member.position.y + dy },
                dragging: change.dragging,
              });
              touched.add(member.id);
            }
          }
        }
        // A position change that is not a drag in progress is a keyboard nudge: send it once, later.
        if (change.type === 'position' && change.dragging !== true) {
          nudgeIds.current.add(change.id);
        }
      }
      if (changes.length > 0) setNodes(applyNodeChanges(changes, nodesRef.current));
      if (nudgeIds.current.size > 0 && nudgeTimer.current === null) {
        nudgeTimer.current = setTimeout(() => {
          nudgeTimer.current = null;
          const ids = [...nudgeIds.current];
          nudgeIds.current.clear();
          flushPositions(ids);
        }, NUDGE_DEBOUNCE_MS);
      }
    },
    [flushPositions, setNodes],
  );

  /** Selection of a link; deleting goes through `deleteEdges`, never through xyflow's removal. */
  const onEdgesChange = useCallback(
    (incoming: EdgeChange<PtEdge>[]) => {
      const changes = incoming.filter((c) => c.type !== 'remove');
      if (changes.length > 0) setEdges(applyEdgeChanges(changes, edgesRef.current));
    },
    [setEdges],
  );

  /** Drag END: every node whose position differs from what the server has, one PATCH each. */
  const onNodeDragStop = useCallback(() => {
    if (nudgeTimer.current !== null) {
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = null;
    }
    nudgeIds.current.clear();
    flushPositions(nodesRef.current.map((n) => n.id));
  }, [flushPositions]);

  const commitBody = useCallback(
    (id: string, body: string) => {
      const current = nodesRef.current.find((n) => n.id === id);
      if (current === undefined || current.data.node.body === body) return;
      mergeData(id, { body });
      patchNode(id, { body });
    },
    [mergeData, patchNode],
  );

  const commitTitle = useCallback(
    (id: string, title: string) => {
      const current = nodesRef.current.find((n) => n.id === id);
      const next = title.trim() === '' ? null : title.trim();
      if (current === undefined || current.data.node.title === next) return;
      mergeData(id, { title: next });
      patchNode(id, { title: next });
    },
    [mergeData, patchNode],
  );

  const commitSize = useCallback(
    (id: string, rect: { x: number; y: number; w: number; h: number }) => {
      sentRef.current.set(id, { x: rect.x, y: rect.y });
      mergeData(id, rect);
      patchNode(id, rect);
    },
    [mergeData, patchNode],
  );

  const addNode = useCallback(
    async (kind: 'note' | 'group', at: { x: number; y: number }, size: { w: number; h: number }, extra: Partial<CanvasNode>) => {
      const node_id = newNodeId();
      const created = await boardsApi.createNode(paperId, {
        node_id,
        kind,
        x: at.x,
        y: at.y,
        w: size.w,
        h: size.h,
        body: extra.body ?? '',
        title: extra.title ?? null,
      });
      if (boardRef.current === null) setBoardBoth(created.board);
      sentRef.current.set(node_id, { x: created.node.x, y: created.node.y });
      versionRef.current.set(node_id, created.node.version);
      setNodes([...nodesRef.current, toFlowNode(created.node, paperId)]);
      return created.node;
    },
    [paperId, setBoardBoth, setNodes],
  );

  const addNote = useCallback(
    async (near?: { x: number; y: number }) => {
      try {
        const size = DEFAULT_SIZE.note;
        const spot = freeSpot(
          nodesRef.current.map((n) => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.data.node.w, h: n.height ?? n.data.node.h })),
          size,
          near,
        );
        const node = await addNode('note', spot, size, {});
        setEditingId(node.node_id);
      } catch (error) {
        setNotice(sentence(error, "Couldn't add a note. Check your connection and try again."));
      }
    },
    [addNode],
  );

  const deleteNodes = useCallback(
    (ids: readonly string[]) => {
      const boardId = boardRef.current?.board_id;
      const doomed = new Set(ids.filter((id) => nodesRef.current.some((n) => n.id === id)));
      if (boardId === undefined || doomed.size === 0) return;
      setNodes(
        nodesRef.current
          .filter((n) => !doomed.has(n.id))
          .map((n) =>
            n.data.node.group_id !== null && doomed.has(n.data.node.group_id)
              ? { ...n, data: { ...n.data, node: { ...n.data.node, group_id: null } } }
              : n,
          ),
      );
      setEdges(edgesRef.current.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)));
      for (const id of doomed) {
        const previous = chainRef.current.get(id) ?? Promise.resolve();
        chainRef.current.set(
          id,
          previous.then(async () => {
            try {
              await boardsApi.deleteNode(boardId, id);
            } catch (error) {
              if (error instanceof ApiError && error.status === 404) return;
              failed(error, "Couldn't delete that. The canvas was reloaded from your last saved version.");
            }
          }),
        );
        sentRef.current.delete(id);
        versionRef.current.delete(id);
      }
    },
    [failed, setEdges, setNodes],
  );

  const deleteEdges = useCallback(
    (ids: readonly string[]) => {
      const boardId = boardRef.current?.board_id;
      const present = ids.filter((id) => edgesRef.current.some((e) => e.id === id));
      if (boardId === undefined || present.length === 0) return;
      setEdges(edgesRef.current.filter((e) => !present.includes(e.id)));
      for (const id of present) {
        boardsApi.deleteEdge(boardId, id).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return;
          failed(error, "Couldn't delete that link. The canvas was reloaded from your last saved version.");
        });
      }
    },
    [failed, setEdges],
  );

  const connect = useCallback(
    async (from: string, to: string, kind: EdgeKind, label: string | null) => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined || from === to) return;
      try {
        const edge = await boardsApi.createEdge(boardId, {
          edge_id: newEdgeId(),
          from_node_id: from,
          to_node_id: to,
          kind,
          label,
        });
        setEdges([...edgesRef.current, toFlowEdge(edge)]);
      } catch (error) {
        setNotice(sentence(error, "Couldn't connect those two cards. Try again."));
      }
    },
    [setEdges],
  );

  const patchEdge = useCallback(
    (id: string, fields: { kind?: EdgeKind; label?: string | null }) => {
      const boardId = boardRef.current?.board_id;
      const current = edgesRef.current.find((e) => e.id === id);
      if (boardId === undefined || current === undefined || current.data === undefined) return;
      const merged = { ...current.data.edge, ...fields };
      setEdges(
        edgesRef.current.map((e) => (e.id === id ? { ...toFlowEdge(merged), selected: e.selected } : e)),
      );
      boardsApi.patchEdge(boardId, id, fields).catch((error: unknown) => {
        failed(error, "Couldn't save that link. The canvas was reloaded from your last saved version.");
      });
    },
    [failed, setEdges],
  );

  const groupNodes = useCallback(
    async (ids: readonly string[]) => {
      const members = nodesRef.current.filter((n) => ids.includes(n.id) && n.data.node.kind !== 'group');
      if (members.length < 2) return;
      try {
        const box = boundsOf(
          members.map((n) => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.data.node.w, h: n.height ?? n.data.node.h })),
        );
        const group = await addNode('group', { x: box.x, y: box.y }, { w: box.w, h: box.h }, { title: 'Group' });
        for (const member of members) {
          mergeData(member.id, { group_id: group.node_id });
          patchNode(member.id, { group_id: group.node_id });
        }
      } catch (error) {
        setNotice(sentence(error, "Couldn't group those cards. Try again."));
      }
    },
    [addNode, mergeData, patchNode],
  );

  const saveViewport = useCallback(
    (viewport: Viewport) => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return;
      const last = lastViewport.current;
      if (last !== null && last.x === viewport.x && last.y === viewport.y && last.zoom === viewport.zoom) return;
      lastViewport.current = viewport;
      boardsApi.patchBoard(boardId, { viewport }).catch(() => {
        // A viewport is a convenience: failing to remember it is not worth interrupting the reader.
      });
    },
    [],
  );

  return useMemo(
    () => ({
      status, board, nodes, edges, notice, editingId, setEditingId,
      dismissNotice: () => setNotice(null),
      reload, onNodesChange, onEdgesChange, onNodeDragStop, addNote, commitBody, commitTitle, commitSize,
      deleteNodes, deleteEdges, connect, patchEdge, groupNodes, saveViewport, initialViewport,
    }),
    [status, board, nodes, edges, notice, editingId, reload, onNodesChange, onEdgesChange, onNodeDragStop, addNote, commitBody, commitTitle, commitSize, deleteNodes, deleteEdges, connect, patchEdge, groupNodes, saveViewport, initialViewport],
  );
}
