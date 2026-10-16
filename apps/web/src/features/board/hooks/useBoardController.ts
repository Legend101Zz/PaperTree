'use client';

/**
 * board/hooks/useBoardController — the one place the board talks to the API.
 *
 * THE RULE (contracts.md §2.7): the client writes only on explicit gestures — drag END (one PATCH
 * per node that moved), an edit commit, connect, group, delete, and pan/zoom END for the viewport.
 * A settled board makes no request at all: there is no polling, no refetch on focus, no autosave
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
import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { boardsApi } from '@/lib/api/boards';
import {
  ApiError,
  type Board,
  type CanvasEdge,
  type CanvasNode,
  type EdgeKind,
  type FromPort,
  type ToPort,
} from '@/lib/api/types';

import { cardName, toFlowEdge, toFlowNode, type PtEdge, type PtNode } from '../model/flow';
import { cardBoxes, frameBoxes, regroup, regroupAround } from '../model/frames';
import { newEdgeId, newNodeId } from '../model/ids';
import { linkedSentence } from '../model/linkAs';
import { DEFAULT_SIZE, boundsOf, freeSpot } from '../model/placement';

export const NUDGE_DEBOUNCE_MS = 400;
/** How long the Undo offer after a delete stays on screen. */
export const UNDO_VISIBLE_MS = 8000;
/** How long the "changed somewhere else" notice stays when nothing else clears it first. */
export const STALE_NOTICE_MS = 8000;

/** What a delete just removed, enough to put it back with the same ids. */
export interface UndoOffer {
  readonly token: number;
  readonly message: string;
}

/** The pins a thread was drawn between. */
export interface ThreadPorts {
  readonly from_port: FromPort | null;
  readonly to_port: ToPort | null;
}

/** Where the board's first read stands. */
export type Status = 'loading' | 'ready' | 'error';

/** Everything `BoardView` needs: the state and every gesture that writes. */
export interface BoardController {
  readonly status: Status;
  readonly board: Board | null;
  readonly nodes: PtNode[];
  readonly edges: PtEdge[];
  readonly notice: string | null;
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
  readonly dismissNotice: () => void;
  /** The Undo offer after a delete (8 s), or null. */
  readonly undo: UndoOffer | null;
  readonly runUndo: () => Promise<void>;
  readonly dismissUndo: () => void;
  /** Several deletes that arrive in one gesture (cards AND their links) become one Undo. */
  readonly deleteSelection: (nodeIds: readonly string[], edgeIds: readonly string[]) => void;
  readonly reload: () => Promise<void>;
  readonly onNodesChange: (changes: NodeChange<PtNode>[]) => void;
  readonly onEdgesChange: (changes: EdgeChange<PtEdge>[]) => void;
  readonly onNodeDragStop: () => void;
  readonly addNote: (near?: { x: number; y: number }) => Promise<void>;
  /** An empty frame centred on `centre` (the middle of the view), its name ready to type (#214). */
  readonly addFrame: (centre: { x: number; y: number }) => Promise<void>;
  readonly commitBody: (id: string, body: string) => void;
  readonly commitTitle: (id: string, title: string) => void;
  readonly commitSize: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  readonly deleteNodes: (ids: readonly string[]) => void;
  readonly deleteEdges: (ids: readonly string[]) => void;
  /**
   * A thread between two cards, drawn between `ports`; resolves true once the server saved it, and
   * offers Undo for 8 s ("Linked as supports.", the toast every delete uses).
   */
  readonly connect: (
    from: string,
    to: string,
    kind: EdgeKind,
    label: string | null,
    ports?: ThreadPorts,
  ) => Promise<boolean>;
  readonly patchEdge: (id: string, fields: { kind?: EdgeKind; label?: string | null }) => void;
  readonly groupNodes: (ids: readonly string[]) => Promise<void>;
  readonly saveViewport: (viewport: Viewport) => void;
  readonly initialViewport: Viewport | null;
}

/**
 * "The card “first words”", "A passage" ... the start of the stale-version sentence.
 *
 * @param card The card's `cardName`, or undefined when it is gone.
 * @returns The sentence's subject.
 */
export function staleSubject(card: string | undefined): string {
  if (card === undefined) return 'A card';
  return card.startsWith('\u201c')
    ? `The card ${card}`
    : `${card.charAt(0).toUpperCase()}${card.slice(1)}`;
}

function sentence(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status !== 0 && error.detail.trim() !== '') {
    return error.code === 'internal' ? fallback : error.detail;
  }
  return fallback;
}

/**
 * The board's state and its writes, for one paper.
 *
 * @param paperId The paper whose board this is.
 * @returns The controller.
 */
export function useBoardController(paperId: string): BoardController {
  const [status, setStatus] = useState<Status>('loading');
  const [board, setBoard] = useState<Board | null>(null);
  const [nodes, setNodesState] = useState<PtNode[]>([]);
  const [edges, setEdgesState] = useState<PtEdge[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoOffer | null>(null);
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
  const undoRestore = useRef<(() => Promise<void>) | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoSeq = useRef(0);
  /** True while the notice on screen is the stale-version one, which clears itself. */
  const staleShown = useRef(false);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /** A stored thread as xyflow draws it, its missing pins resolved from the cards' kinds. */
  const threadOf = useCallback((edge: CanvasEdge): PtEdge => {
    const kind = (id: string) => nodesRef.current.find((n) => n.id === id)?.data.node.kind;
    return toFlowEdge(edge, { from: kind(edge.from_node_id), to: kind(edge.to_node_id) });
  }, []);

  const adopt = useCallback(
    (view: { board: Board | null; nodes: CanvasNode[]; edges: CanvasEdge[] }) => {
      sentRef.current = new Map(view.nodes.map((n) => [n.node_id, { x: n.x, y: n.y }]));
      versionRef.current = new Map(view.nodes.map((n) => [n.node_id, n.version]));
      setBoardBoth(view.board);
      setNodes(view.nodes.map((n) => toFlowNode(n, paperId)));
      const kinds = new Map(view.nodes.map((n) => [n.node_id, n.kind] as const));
      setEdges(
        view.edges.map((e) =>
          toFlowEdge(e, { from: kinds.get(e.from_node_id), to: kinds.get(e.to_node_id) }),
        ),
      );
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
      if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
      if (staleTimer.current !== null) clearTimeout(staleTimer.current);
    };
  }, [reload]);

  // ── writes ────────────────────────────────────────────────────────────────────────────────

  const clearStale = useCallback(() => {
    if (!staleShown.current) return;
    staleShown.current = false;
    if (staleTimer.current !== null) clearTimeout(staleTimer.current);
    staleTimer.current = null;
    setNotice(null);
  }, []);

  /**
   * `cardId` is the card a stale-version refusal was about. The notice names it by what the SERVER
   * has after the reload, never by the reader's unsaved text still on the card when the save failed.
   */
  const failed = useCallback(
    (error: unknown, fallback: string, cardId?: string) => {
      if (!aliveRef.current) return;
      if (error instanceof ApiError && error.code === 'stale_version') {
        staleShown.current = true;
        if (staleTimer.current !== null) clearTimeout(staleTimer.current);
        staleTimer.current = setTimeout(clearStale, STALE_NOTICE_MS);
        void reload().then(() => {
          if (!aliveRef.current || !staleShown.current) return;
          const fresh =
            cardId === undefined ? undefined : nodesRef.current.find((n) => n.id === cardId);
          setNotice(
            `${staleSubject(fresh === undefined ? undefined : cardName(fresh.data.node))} was changed somewhere else. The latest version is shown.`,
          );
        });
        return;
      }
      staleShown.current = false;
      setNotice(sentence(error, fallback));
      void reload();
    },
    [clearStale, reload],
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
            clearStale();
          }
        } catch (error) {
          failed(
            error,
            "Couldn't save that change. The board was reloaded from your last saved version.",
            id,
          );
        }
      };
      chainRef.current.set(id, (chainRef.current.get(id) ?? Promise.resolve()).then(run));
    },
    [clearStale, failed, mergeData],
  );

  /**
   * The nodes that moved since they were last sent, one PATCH each. A card dropped into a frame (or
   * out of one) carries its new `group_id` in that same PATCH (`model/frames`' rule, #214).
   */
  const flushPositions = useCallback(
    (ids: Iterable<string>) => {
      const wanted = new Set(ids);
      const moved = nodesRef.current.filter((n) => {
        const sent = sentRef.current.get(n.id);
        return (
          wanted.has(n.id) &&
          (sent === undefined || sent.x !== n.position.x || sent.y !== n.position.y)
        );
      });
      const frames = frameBoxes(nodesRef.current);
      const joins = new Map(regroup(cardBoxes(moved), frames).map((c) => [c.id, c.groupId]));
      for (const node of moved) {
        const { x, y } = node.position;
        const fields = joins.has(node.id)
          ? { x, y, group_id: joins.get(node.id) ?? null }
          : { x, y };
        sentRef.current.set(node.id, { x, y });
        mergeData(node.id, fields);
        patchNode(node.id, fields);
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
      if (nodesRef.current.find((n) => n.id === id)?.data.node.kind !== 'group') return;
      // A resized frame takes in the cards it now holds and lets go of the ones it no longer does,
      // measured at the size it was given (whatever xyflow's copy of the node says).
      const nodes = nodesRef.current.map((n) =>
        n.id === id
          ? { ...n, position: { x: rect.x, y: rect.y }, width: rect.w, height: rect.h }
          : n,
      );
      for (const change of regroupAround(id, cardBoxes(nodes), frameBoxes(nodes))) {
        mergeData(change.id, { group_id: change.groupId });
        patchNode(change.id, { group_id: change.groupId });
      }
    },
    [mergeData, patchNode],
  );

  const addNode = useCallback(
    async (
      kind: 'note' | 'group',
      at: { x: number; y: number },
      size: { w: number; h: number },
      extra: Partial<CanvasNode>,
    ) => {
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
      clearStale();
      return created.node;
    },
    [clearStale, paperId, setBoardBoth, setNodes],
  );

  const addNote = useCallback(
    async (near?: { x: number; y: number }) => {
      try {
        const size = DEFAULT_SIZE.note;
        const spot = freeSpot(
          nodesRef.current.map((n) => ({
            x: n.position.x,
            y: n.position.y,
            w: n.width ?? n.data.node.w,
            h: n.height ?? n.data.node.h,
          })),
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

  const addFrame = useCallback(
    async (centre: { x: number; y: number }) => {
      // Empty on purpose: a card joins a frame when it is dropped in it, never by lying under it.
      const size = DEFAULT_SIZE.group;
      const at = { x: Math.round(centre.x - size.w / 2), y: Math.round(centre.y - size.h / 2) };
      try {
        const node = await addNode('group', at, size, { title: 'New frame' });
        setEditingId(node.node_id);
      } catch (error) {
        setNotice(sentence(error, "Couldn't add a frame. Check your connection and try again."));
      }
    },
    [addNode],
  );

  const offerUndo = useCallback((message: string, restore: () => Promise<void>) => {
    undoSeq.current += 1;
    undoRestore.current = restore;
    setUndo({ token: undoSeq.current, message });
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      undoRestore.current = null;
      setUndo(null);
    }, UNDO_VISIBLE_MS);
  }, []);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    undoRestore.current = null;
    setUndo(null);
  }, []);

  /**
   * Deletes cards and links, and offers to take it back. Nothing is asked first (no confirm
   * dialog): the delete happens, and for 8 s an Undo puts the same rows back with the same ids.
   */
  const deleteSelection = useCallback(
    (nodeIds: readonly string[], edgeIds: readonly string[]) => {
      const boardId = boardRef.current?.board_id;
      const doomed = new Set(nodeIds.filter((id) => nodesRef.current.some((n) => n.id === id)));
      const edgeSet = new Set(edgeIds);
      // Links that go with a card are removed by the server's cascade; links picked on their own
      // are deleted one by one. Both are remembered for Undo.
      const lostEdges = edgesRef.current.filter(
        (e) => edgeSet.has(e.id) || doomed.has(e.source) || doomed.has(e.target),
      );
      const ownEdges = lostEdges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target));
      if (boardId === undefined || (doomed.size === 0 && ownEdges.length === 0)) return;

      const removedNodes: CanvasNode[] = nodesRef.current
        .filter((n) => doomed.has(n.id))
        .map((n) => ({
          ...n.data.node,
          x: n.position.x,
          y: n.position.y,
          w: n.width ?? n.data.node.w,
          h: n.height ?? n.data.node.h,
        }));
      const removedEdges: CanvasEdge[] = lostEdges.flatMap((e) =>
        e.data === undefined ? [] : [e.data.edge],
      );
      const released = nodesRef.current
        .filter(
          (n) =>
            !doomed.has(n.id) && n.data.node.group_id !== null && doomed.has(n.data.node.group_id),
        )
        .map((n) => ({ id: n.id, groupId: n.data.node.group_id as string }));

      const pending: Promise<void>[] = [];
      if (doomed.size > 0) {
        setNodes(
          nodesRef.current
            .filter((n) => !doomed.has(n.id))
            .map((n) =>
              n.data.node.group_id !== null && doomed.has(n.data.node.group_id)
                ? { ...n, data: { ...n.data, node: { ...n.data.node, group_id: null } } }
                : n,
            ),
        );
      }
      setEdges(edgesRef.current.filter((e) => !lostEdges.includes(e)));

      for (const id of doomed) {
        const previous = chainRef.current.get(id) ?? Promise.resolve();
        const done = previous.then(async () => {
          try {
            await boardsApi.deleteNode(boardId, id);
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return;
            failed(
              error,
              "Couldn't delete that. The board was reloaded from your last saved version.",
            );
          }
        });
        chainRef.current.set(id, done);
        pending.push(done);
        sentRef.current.delete(id);
        versionRef.current.delete(id);
      }
      for (const edge of ownEdges) {
        pending.push(
          boardsApi.deleteEdge(boardId, edge.id).catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 404) return;
            failed(
              error,
              "Couldn't delete that link. The board was reloaded from your last saved version.",
            );
          }),
        );
      }

      const first = removedNodes[0];
      const message =
        removedNodes.length === 1 && first !== undefined
          ? `Deleted ${cardName(first)}.`
          : removedNodes.length > 1
            ? `Deleted ${String(removedNodes.length)} cards.`
            : ownEdges.length === 1
              ? 'Deleted a link.'
              : `Deleted ${String(ownEdges.length)} links.`;

      offerUndo(message, async () => {
        await Promise.all(pending);
        if (!aliveRef.current) return;
        try {
          const restored = new Set<string>();
          const live = new Set(nodesRef.current.map((n) => n.id));
          // Groups first, so a member can point at its group again.
          const ordered = [...removedNodes].sort(
            (a, b) => Number(b.kind === 'group') - Number(a.kind === 'group'),
          );
          for (const snap of ordered) {
            const groupId =
              snap.group_id !== null && (live.has(snap.group_id) || restored.has(snap.group_id))
                ? snap.group_id
                : null;
            const created = await boardsApi.createNode(paperId, {
              node_id: snap.node_id,
              kind: snap.kind,
              x: snap.x,
              y: snap.y,
              w: snap.w,
              h: snap.h,
              title: snap.title,
              body: snap.body,
              ...(snap.source_anchor === null
                ? {}
                : { source_anchor: snap.source_anchor as never }),
              ...(snap.source_message_id === null
                ? {}
                : { source_message_id: snap.source_message_id }),
              // A notebook or diagram card is refused without the thing it shows (S6a).
              ...(snap.source_page_id === null ? {} : { source_page_id: snap.source_page_id }),
              ...(snap.source_diagram_id === null
                ? {}
                : { source_diagram_id: snap.source_diagram_id }),
              group_id: groupId,
            });
            restored.add(snap.node_id);
            sentRef.current.set(snap.node_id, { x: created.node.x, y: created.node.y });
            versionRef.current.set(snap.node_id, created.node.version);
            setNodes([...nodesRef.current, toFlowNode(created.node, paperId)]);
          }
          const reattach = released.filter(
            (m) => restored.has(m.groupId) && nodesRef.current.some((n) => n.id === m.id),
          );
          if (reattach.length > 0) {
            // The server ungrouped them itself, so the versions held here may be behind.
            const fresh = await boardsApi.get(paperId);
            for (const row of fresh.nodes) versionRef.current.set(row.node_id, row.version);
            for (const member of reattach) {
              mergeData(member.id, { group_id: member.groupId });
              patchNode(member.id, { group_id: member.groupId });
            }
          }
          const present = new Set(nodesRef.current.map((n) => n.id));
          for (const edge of removedEdges) {
            if (!present.has(edge.from_node_id) || !present.has(edge.to_node_id)) continue;
            if (edgesRef.current.some((e) => e.id === edge.edge_id)) continue;
            const saved = await boardsApi.createEdge(boardId, {
              edge_id: edge.edge_id,
              from_node_id: edge.from_node_id,
              to_node_id: edge.to_node_id,
              kind: edge.kind,
              label: edge.label,
              // The thread comes back on the pins it was drawn between (a keyboard link has none).
              ...(edge.from_port === null ? {} : { from_port: edge.from_port }),
              ...(edge.to_port === null ? {} : { to_port: edge.to_port }),
            });
            setEdges([...edgesRef.current, threadOf(saved)]);
          }
        } catch (error) {
          setNotice(
            sentence(
              error,
              "Couldn't bring that back. The board was reloaded from your last saved version.",
            ),
          );
          void reload();
        }
      });
    },
    [failed, mergeData, offerUndo, paperId, patchNode, reload, setEdges, setNodes, threadOf],
  );

  const deleteNodes = useCallback(
    (ids: readonly string[]) => {
      deleteSelection(ids, []);
    },
    [deleteSelection],
  );

  const deleteEdges = useCallback(
    (ids: readonly string[]) => {
      deleteSelection([], ids);
    },
    [deleteSelection],
  );

  const runUndo = useCallback(async () => {
    const restore = undoRestore.current;
    dismissUndo();
    if (restore !== null) await restore();
  }, [dismissUndo]);

  const connect = useCallback(
    async (from: string, to: string, kind: EdgeKind, label: string | null, ports?: ThreadPorts) => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined || from === to) return false;
      try {
        const edge = await boardsApi.createEdge(boardId, {
          edge_id: newEdgeId(),
          from_node_id: from,
          to_node_id: to,
          kind,
          label,
          ...ports,
        });
        setEdges([...edgesRef.current, threadOf(edge)]);
        clearStale();
        offerUndo(linkedSentence(kind), async () => {
          setEdges(edgesRef.current.filter((e) => e.id !== edge.edge_id));
          await boardsApi.deleteEdge(boardId, edge.edge_id).catch((error: unknown) => {
            failed(
              error,
              "Couldn't take that thread back. The board was reloaded from your last saved version.",
            );
          });
        });
        return true;
      } catch (error) {
        setNotice(sentence(error, "Couldn't connect those two cards. Try again."));
        return false;
      }
    },
    [clearStale, failed, offerUndo, setEdges, threadOf],
  );

  const patchEdge = useCallback(
    (id: string, fields: { kind?: EdgeKind; label?: string | null }) => {
      const boardId = boardRef.current?.board_id;
      const current = edgesRef.current.find((e) => e.id === id);
      if (boardId === undefined || current === undefined || current.data === undefined) return;
      const merged = { ...current.data.edge, ...fields };
      setEdges(
        edgesRef.current.map((e) =>
          e.id === id ? { ...threadOf(merged), selected: e.selected } : e,
        ),
      );
      boardsApi.patchEdge(boardId, id, fields).catch((error: unknown) => {
        failed(
          error,
          "Couldn't save that link. The board was reloaded from your last saved version.",
        );
      });
    },
    [failed, setEdges, threadOf],
  );

  const groupNodes = useCallback(
    async (ids: readonly string[]) => {
      const members = nodesRef.current.filter(
        (n) => ids.includes(n.id) && n.data.node.kind !== 'group',
      );
      if (members.length < 2) return;
      try {
        const box = boundsOf(
          members.map((n) => ({
            x: n.position.x,
            y: n.position.y,
            w: n.width ?? n.data.node.w,
            h: n.height ?? n.data.node.h,
          })),
        );
        const group = await addNode(
          'group',
          { x: box.x, y: box.y },
          { w: box.w, h: box.h },
          { title: 'Frame' },
        );
        for (const member of members) {
          mergeData(member.id, { group_id: group.node_id });
          patchNode(member.id, { group_id: group.node_id });
        }
      } catch (error) {
        setNotice(sentence(error, "Couldn't frame those cards. Try again."));
      }
    },
    [addNode, mergeData, patchNode],
  );

  const saveViewport = useCallback((viewport: Viewport) => {
    const boardId = boardRef.current?.board_id;
    if (boardId === undefined) return;
    const last = lastViewport.current;
    if (
      last !== null &&
      last.x === viewport.x &&
      last.y === viewport.y &&
      last.zoom === viewport.zoom
    )
      return;
    lastViewport.current = viewport;
    boardsApi.patchBoard(boardId, { viewport }).catch(() => {
      // A viewport is a convenience: failing to remember it is not worth interrupting the reader.
    });
  }, []);

  return useMemo(
    () => ({
      status,
      board,
      nodes,
      edges,
      notice,
      editingId,
      setEditingId,
      dismissNotice: () => {
        staleShown.current = false;
        setNotice(null);
      },
      undo,
      runUndo,
      dismissUndo,
      deleteSelection,
      reload,
      onNodesChange,
      onEdgesChange,
      onNodeDragStop,
      addNote,
      addFrame,
      commitBody,
      commitTitle,
      commitSize,
      deleteNodes,
      deleteEdges,
      connect,
      patchEdge,
      groupNodes,
      saveViewport,
      initialViewport,
    }),
    [
      status,
      board,
      nodes,
      edges,
      notice,
      editingId,
      undo,
      runUndo,
      dismissUndo,
      deleteSelection,
      reload,
      onNodesChange,
      onEdgesChange,
      onNodeDragStop,
      addNote,
      addFrame,
      commitBody,
      commitTitle,
      commitSize,
      deleteNodes,
      deleteEdges,
      connect,
      patchEdge,
      groupNodes,
      saveViewport,
      initialViewport,
    ],
  );
}
