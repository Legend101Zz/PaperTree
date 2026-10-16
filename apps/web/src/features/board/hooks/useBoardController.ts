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
 *
 * UNDO AND REDO (#215). Every gesture that writes records ONE step in `useBoardHistory` (a drag of
 * several cards, a frame and the cards it carries, a resize with the cards it takes in); undo and
 * redo replay it through these same writes, with the version held when they run, so a card changed
 * somewhere else answers 409: the board reloads, says so, and forgets the steps about that card.
 * The Undo toast after a delete or a new thread is the same stack's Undo.
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

import {
  cardName,
  kindLabel,
  toFlowEdge,
  toFlowNode,
  withFields,
  type PtEdge,
  type PtNode,
} from '../model/flow';
import { cardBoxes, frameBoxes, regroup, regroupAround } from '../model/frames';
import {
  itemsPhrase,
  type BoardCommand,
  type CardChange,
  type CardFields,
  type ReplayIo,
  type RowsCommand,
  type ThreadFields,
} from '../model/history';
import { newEdgeId, newNodeId } from '../model/ids';
import { linkedSentence } from '../model/linkAs';
import { DEFAULT_SIZE, boundsOf, freeSpot, spotNear } from '../model/placement';
import { useBoardHistory, type BoardHistory, type HistoryHooks } from './useBoardHistory';

export const NUDGE_DEBOUNCE_MS = 400;
/** How long the Undo offer after a delete stays on screen. */
export const UNDO_VISIBLE_MS = 8000;
/** How long the "changed somewhere else" notice stays when nothing else clears it first. */
export const STALE_NOTICE_MS = 8000;

/** The Undo toast after a delete or a new thread: its words (its Undo is the history's). */
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
  /** The Undo offer after a delete or a new thread (8 s), or null. */
  readonly undo: UndoOffer | null;
  /** The toast's Undo: the history's newest step, which is the one the toast names. */
  readonly runUndo: () => Promise<void>;
  /** Undo and redo of every gesture that writes (#215). */
  readonly history: BoardHistory;
  readonly dismissUndo: () => void;
  /** Several deletes that arrive in one gesture (cards AND their links) become one Undo. */
  readonly deleteSelection: (nodeIds: readonly string[], edgeIds: readonly string[]) => void;
  readonly reload: () => Promise<void>;
  readonly onNodesChange: (changes: NodeChange<PtNode>[]) => void;
  readonly onEdgesChange: (changes: EdgeChange<PtEdge>[]) => void;
  readonly onNodeDragStop: () => void;
  readonly addNote: (near?: { x: number; y: number }) => Promise<void>;
  /** An empty frame in clear space nearest `centre` (the view's middle), its name ready to type. */
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

/** The end of every sentence that follows a reload. */
const RELOADED = 'The board was reloaded from your last saved version.';

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
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoSeq = useRef(0);
  /** True while the notice on screen is the stale-version one, which clears itself. */
  const staleShown = useRef(false);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Filled at the end of every render: what an undo or redo runs (the writes below). */
  const historyHooks = useRef<HistoryHooks | null>(null);
  const hist = useBoardHistory(historyHooks);
  const { record: remember, forget: forgetRow, after: afterWrite } = hist;

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
    (error: unknown, fallback: string, cardId?: string, lead?: string) => {
      if (!aliveRef.current) return;
      if (error instanceof ApiError && error.code === 'stale_version') {
        // No later undo may overwrite what changed somewhere else (#215).
        if (cardId !== undefined) forgetRow(cardId);
        staleShown.current = true;
        if (staleTimer.current !== null) clearTimeout(staleTimer.current);
        staleTimer.current = setTimeout(clearStale, STALE_NOTICE_MS);
        void reload().then(() => {
          if (!aliveRef.current || !staleShown.current) return;
          const fresh =
            cardId === undefined ? undefined : nodesRef.current.find((n) => n.id === cardId);
          setNotice(
            `${lead === undefined ? '' : `${lead} `}${staleSubject(fresh === undefined ? undefined : cardName(fresh.data.node))} was changed somewhere else. The latest version is shown.`,
          );
        });
        return;
      }
      staleShown.current = false;
      setNotice(
        lead === undefined ? sentence(error, fallback) : `${lead} ${sentence(error, RELOADED)}`,
      );
      void reload();
    },
    [clearStale, forgetRow, reload],
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

  /** One PATCH, after the card's earlier ones; resolves true once saved (`lead` heads a refusal). */
  const patchNode = useCallback(
    (id: string, fields: CardFields, lead?: string): Promise<boolean> => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return Promise.resolve(false);
      let saved = false;
      const run = async (): Promise<void> => {
        const version = versionRef.current.get(id);
        if (version === undefined) return;
        try {
          const row = await boardsApi.patchNode(boardId, id, { version, ...fields });
          versionRef.current.set(id, row.version);
          saved = true;
          if (aliveRef.current) {
            mergeData(id, { version: row.version, updated_at: row.updated_at });
            clearStale();
          }
        } catch (error) {
          failed(error, `Couldn't save that change. ${RELOADED}`, id, lead);
        }
      };
      const done = (chainRef.current.get(id) ?? Promise.resolve()).then(run);
      chainRef.current.set(id, done);
      return done.then(() => saved);
    },
    [clearStale, failed, mergeData],
  );

  const offerUndo = useCallback((message: string) => {
    undoSeq.current += 1;
    setUndo({ token: undoSeq.current, message });
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      setUndo(null);
    }, UNDO_VISIBLE_MS);
  }, []);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  /**
   * A gesture's one step. Only a delete and a new thread show the Undo toast (`toast` is its
   * words); any other step puts an earlier toast away, since its Undo would now take back this one.
   */
  const recordStep = useCallback(
    (command: BoardCommand, toast?: string) => {
      remember(command);
      if (toast === undefined) dismissUndo();
      else offerUndo(toast);
    },
    [dismissUndo, offerUndo, remember],
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
      // The whole gesture is one step: every card a drag (or a frame) moved, and the frames joined.
      const changes: CardChange[] = [];
      for (const node of moved) {
        const { x, y } = node.position;
        const joined = joins.has(node.id);
        const fields = joined ? { x, y, group_id: joins.get(node.id) ?? null } : { x, y };
        const was = sentRef.current.get(node.id);
        if (was !== undefined) {
          const before = joined ? { ...was, group_id: node.data.node.group_id } : { ...was };
          changes.push({ id: node.id, before, after: fields });
        }
        sentRef.current.set(node.id, { x, y });
        mergeData(node.id, fields);
        void patchNode(node.id, fields);
      }
      if (changes.length === 0) return;
      const label = `move of ${itemsPhrase(moved.map((n) => n.data.node))}`;
      recordStep({ type: 'patch', label, cards: changes });
    },
    [mergeData, patchNode, recordStep],
  );

  /** A run of arrow-key nudges, sent (and recorded as one step) now rather than after the debounce. */
  const flushNudges = useCallback(() => {
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
    const ids = [...nudgeIds.current];
    nudgeIds.current.clear();
    if (ids.length > 0) flushPositions(ids);
  }, [flushPositions]);

  const onNodesChange = useCallback(
    (incoming: NodeChange<PtNode>[]) => {
      const changes: NodeChange<PtNode>[] = [];
      const touched = new Set(
        incoming.filter((c) => c.type === 'position').map((c) => (c as { id: string }).id),
      );
      // A NodeResizer step batches the moved corner (left or top edge) with a `resizing` size
      // change. That position belongs to the resize: the frame's cards stay where they are, and
      // nothing is sent until `commitSize` at the resize's end (#214 review B2).
      const resizing = new Set(
        incoming.flatMap((c) => (c.type === 'dimensions' && c.resizing === true ? [c.id] : [])),
      );
      for (const change of incoming) {
        // Deleting goes through `deleteNodes` (API first-class), never through xyflow's own removal.
        if (change.type === 'remove') continue;
        changes.push(change);
        if (change.type !== 'position' || resizing.has(change.id)) continue;
        // A position change that is not a drag in progress is a keyboard nudge: send it once, later.
        const nudge = change.dragging !== true;
        if (nudge) nudgeIds.current.add(change.id);
        const moved = nodesRef.current.find((n) => n.id === change.id);
        if (change.position === undefined || moved?.data.node.kind !== 'group') continue;
        // A frame carries its cards; on a nudge they are queued with it, so each is saved too.
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
          if (nudge) nudgeIds.current.add(member.id);
        }
      }
      if (changes.length > 0) setNodes(applyNodeChanges(changes, nodesRef.current));
      if (nudgeIds.current.size > 0 && nudgeTimer.current === null) {
        nudgeTimer.current = setTimeout(flushNudges, NUDGE_DEBOUNCE_MS);
      }
    },
    [flushNudges, setNodes],
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
      const before = { body: current.data.node.body };
      recordStep({
        type: 'patch',
        label: `edit of ${cardName(current.data.node)}`,
        cards: [{ id, before, after: { body } }],
      });
      mergeData(id, { body });
      void patchNode(id, { body });
    },
    [mergeData, patchNode, recordStep],
  );

  const commitTitle = useCallback(
    (id: string, title: string) => {
      const current = nodesRef.current.find((n) => n.id === id);
      const next = title.trim() === '' ? null : title.trim();
      if (current === undefined || current.data.node.title === next) return;
      const what = current.data.node.kind === 'group' ? 'rename' : 'edit';
      recordStep({
        type: 'patch',
        label: `${what} of ${cardName(current.data.node)}`,
        cards: [{ id, before: { title: current.data.node.title }, after: { title: next } }],
      });
      mergeData(id, { title: next });
      void patchNode(id, { title: next });
    },
    [mergeData, patchNode, recordStep],
  );

  const commitSize = useCallback(
    (id: string, rect: { x: number; y: number; w: number; h: number }) => {
      const node = nodesRef.current.find((n) => n.id === id);
      const was = sentRef.current.get(id);
      if (node === undefined || was === undefined) return;
      const before = { x: was.x, y: was.y, w: node.data.node.w, h: node.data.node.h };
      if (before.x === rect.x && before.y === rect.y && before.w === rect.w && before.h === rect.h)
        return;
      // The resize and the cards a frame takes in or lets go are one step.
      const changes: CardChange[] = [{ id, before, after: rect }];
      sentRef.current.set(id, { x: rect.x, y: rect.y });
      mergeData(id, rect);
      void patchNode(id, rect);
      if (node.data.node.kind === 'group') {
        // A resized frame takes in the cards it now holds and lets go of the ones it no longer
        // does, measured at the size it was given (whatever xyflow's copy of the node says).
        const nodes = nodesRef.current.map((n) =>
          n.id === id
            ? { ...n, position: { x: rect.x, y: rect.y }, width: rect.w, height: rect.h }
            : n,
        );
        for (const change of regroupAround(id, cardBoxes(nodes), frameBoxes(nodes))) {
          const groupId = nodes.find((n) => n.id === change.id)?.data.node.group_id ?? null;
          changes.push({
            id: change.id,
            before: { group_id: groupId },
            after: { group_id: change.groupId },
          });
          mergeData(change.id, { group_id: change.groupId });
          void patchNode(change.id, { group_id: change.groupId });
        }
      }
      recordStep({ type: 'patch', label: `resize of ${cardName(node.data.node)}`, cards: changes });
    },
    [mergeData, patchNode, recordStep],
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
        recordStep({ type: 'add', label: 'new note', nodes: [node], edges: [], members: [] });
        setEditingId(node.node_id);
      } catch (error) {
        setNotice(sentence(error, "Couldn't add a note. Check your connection and try again."));
      }
    },
    [addNode, recordStep],
  );

  const addFrame = useCallback(
    async (centre: { x: number; y: number }) => {
      // In clear space nearest the middle of the view, never on top of cards (#214 review S1); and
      // empty on purpose: a card joins a frame when it is dropped in it.
      const size = DEFAULT_SIZE.group;
      const taken = nodesRef.current.map((n) => ({
        x: n.position.x,
        y: n.position.y,
        w: n.width ?? n.data.node.w,
        h: n.height ?? n.data.node.h,
      }));
      const at = spotNear(taken, size, centre);
      try {
        const node = await addNode('group', at, size, { title: 'New frame' });
        recordStep({ type: 'add', label: 'new frame', nodes: [node], edges: [], members: [] });
        setEditingId(node.node_id);
      } catch (error) {
        setNotice(sentence(error, "Couldn't add a frame. Check your connection and try again."));
      }
    },
    [addNode, recordStep],
  );

  /**
   * Takes cards and threads off the board: on screen at once, then one DELETE each (a card's own
   * threads go with it by the server's cascade). A gesture's delete and the replay of a step
   * (redo a delete, undo an add) both come here; the next undo waits for these requests.
   */
  const removeRows = useCallback(
    (rows: RowsCommand, lead?: string): Promise<boolean> => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return Promise.resolve(false);
      const doomed = new Set(rows.nodes.map((n) => n.node_id));
      const edgeIds = new Set(rows.edges.map((e) => e.edge_id));
      const lost = edgesRef.current.filter(
        (e) => edgeIds.has(e.id) || doomed.has(e.source) || doomed.has(e.target),
      );
      const own = rows.edges.filter(
        (e) => !doomed.has(e.from_node_id) && !doomed.has(e.to_node_id),
      );
      if (doomed.size > 0) {
        setNodes(
          nodesRef.current
            .filter((n) => !doomed.has(n.id))
            .map((n) =>
              n.data.node.group_id !== null && doomed.has(n.data.node.group_id)
                ? withFields(n, { group_id: null })
                : n,
            ),
        );
      }
      setEdges(edgesRef.current.filter((e) => !lost.includes(e)));

      let ok = true;
      const refused = (what: string) => (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return;
        ok = false;
        failed(error, `Couldn't delete ${what}. ${RELOADED}`, undefined, lead);
      };
      const pending: Promise<void>[] = [];
      for (const id of doomed) {
        const previous = chainRef.current.get(id) ?? Promise.resolve();
        const done = previous.then(() => boardsApi.deleteNode(boardId, id)).catch(refused('that'));
        chainRef.current.set(id, done);
        pending.push(done);
        sentRef.current.delete(id);
        versionRef.current.delete(id);
      }
      for (const edge of own) {
        pending.push(boardsApi.deleteEdge(boardId, edge.edge_id).catch(refused('that link')));
      }
      const all = Promise.all(pending).then(() => ok);
      afterWrite(all);
      return all;
    },
    [afterWrite, failed, setEdges, setNodes],
  );

  /**
   * Puts rows back with the same ids, content and anchors (frames first, so a card can rejoin its
   * frame; then the cards a deleted frame held; then the threads whose two cards are present).
   * NodeCreate has no `z`, so a card comes back at z 0 (every card v0.2 makes has z 0), with a new
   * `created_at` and version 1 (#215).
   */
  const restoreRows = useCallback(
    async (rows: RowsCommand, lead?: string): Promise<boolean> => {
      const boardId = boardRef.current?.board_id;
      if (!aliveRef.current || boardId === undefined) return false;
      try {
        const live = new Set(nodesRef.current.map((n) => n.id));
        const ordered = [...rows.nodes].sort(
          (a, b) => Number(b.kind === 'group') - Number(a.kind === 'group'),
        );
        for (const snap of ordered) {
          if (live.has(snap.node_id)) continue;
          const groupId = snap.group_id !== null && live.has(snap.group_id) ? snap.group_id : null;
          const created = await boardsApi.createNode(paperId, {
            node_id: snap.node_id,
            kind: snap.kind,
            x: snap.x,
            y: snap.y,
            w: snap.w,
            h: snap.h,
            title: snap.title,
            body: snap.body,
            ...(snap.source_anchor === null ? {} : { source_anchor: snap.source_anchor as never }),
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
          live.add(snap.node_id);
          sentRef.current.set(snap.node_id, { x: created.node.x, y: created.node.y });
          versionRef.current.set(snap.node_id, created.node.version);
          setNodes([...nodesRef.current, toFlowNode(created.node, paperId)]);
        }
        // The server's trigger ungrouped a deleted frame's cards without a new version, so the
        // versions held here are still the server's.
        const rejoin = rows.members.filter((m) => live.has(m.groupId) && live.has(m.id));
        for (const member of rejoin) mergeData(member.id, { group_id: member.groupId });
        const rejoined = await Promise.all(
          rejoin.map((m) => patchNode(m.id, { group_id: m.groupId }, lead)),
        );
        for (const edge of rows.edges) {
          if (!live.has(edge.from_node_id) || !live.has(edge.to_node_id)) continue;
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
        clearStale();
        return rejoined.every(Boolean);
      } catch (error) {
        const fallback = `Couldn't bring that back. ${RELOADED}`;
        setNotice(
          lead === undefined ? sentence(error, fallback) : `${lead} ${sentence(error, RELOADED)}`,
        );
        void reload();
        return false;
      }
    },
    [clearStale, mergeData, paperId, patchNode, reload, setEdges, setNodes, threadOf],
  );

  /**
   * Deletes cards and links, and offers to take it back. Nothing is asked first (no confirm
   * dialog): the delete happens, and for 8 s the toast's Undo puts the same rows back with the
   * same ids (the history's step, so Cmd/Ctrl+Z does the same, for as long as it is the newest).
   */
  const deleteSelection = useCallback(
    (nodeIds: readonly string[], edgeIds: readonly string[]) => {
      const doomed = new Set(nodeIds.filter((id) => nodesRef.current.some((n) => n.id === id)));
      const edgeSet = new Set(edgeIds);
      // Links that go with a card are removed by the server's cascade; links picked on their own
      // are deleted one by one. Both are remembered for Undo.
      const lostEdges = edgesRef.current.filter(
        (e) => edgeSet.has(e.id) || doomed.has(e.source) || doomed.has(e.target),
      );
      const ownEdges = lostEdges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target));
      if (boardRef.current === null || (doomed.size === 0 && ownEdges.length === 0)) return;

      const removedNodes: CanvasNode[] = nodesRef.current
        .filter((n) => doomed.has(n.id))
        .map((n) => ({
          ...n.data.node,
          x: n.position.x,
          y: n.position.y,
          w: n.width ?? n.data.node.w,
          h: n.height ?? n.data.node.h,
        }));
      const rows: RowsCommand = {
        type: 'remove',
        label: `delete of ${itemsPhrase(removedNodes, ownEdges.length)}`,
        nodes: removedNodes,
        edges: lostEdges.flatMap((e) => (e.data === undefined ? [] : [e.data.edge])),
        members: nodesRef.current.flatMap((n) =>
          !doomed.has(n.id) && n.data.node.group_id !== null && doomed.has(n.data.node.group_id)
            ? [{ id: n.id, groupId: n.data.node.group_id }]
            : [],
        ),
      };
      void removeRows(rows);

      const first = removedNodes[0];
      const message =
        removedNodes.length === 1 && first !== undefined
          ? `Deleted ${cardName(first)}.`
          : removedNodes.length > 1
            ? `Deleted ${String(removedNodes.length)} cards.`
            : ownEdges.length === 1
              ? 'Deleted a link.'
              : `Deleted ${String(ownEdges.length)} links.`;
      recordStep(rows, message);
    },
    [recordStep, removeRows],
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

  const undoStep = hist.view.undo;
  const runUndo = useCallback(async () => {
    // Only while the toast shows: after it goes, Cmd/Ctrl+Z and the toolbar's Undo still can.
    if (undoTimer.current === null) return;
    dismissUndo();
    await undoStep();
  }, [dismissUndo, undoStep]);

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
        const step: RowsCommand = {
          type: 'add',
          label: `new thread “${kindLabel(kind)}”`,
          nodes: [],
          edges: [edge],
          members: [],
        };
        recordStep(step, linkedSentence(kind));
        return true;
      } catch (error) {
        setNotice(sentence(error, "Couldn't connect those two cards. Try again."));
        return false;
      }
    },
    [clearStale, recordStep, setEdges, threadOf],
  );

  /** A thread's kind or label: on screen at once, then the PATCH; resolves true once saved. */
  const sendEdge = useCallback(
    (id: string, fields: ThreadFields, lead?: string): Promise<boolean> => {
      const boardId = boardRef.current?.board_id;
      const current = edgesRef.current.find((e) => e.id === id);
      if (boardId === undefined || current?.data === undefined) return Promise.resolve(false);
      const merged = { ...current.data.edge, ...fields };
      setEdges(
        edgesRef.current.map((e) =>
          e.id === id ? { ...threadOf(merged), selected: e.selected } : e,
        ),
      );
      return boardsApi.patchEdge(boardId, id, fields).then(
        () => true,
        (error: unknown) => {
          failed(error, `Couldn't save that link. ${RELOADED}`, undefined, lead);
          return false;
        },
      );
    },
    [failed, setEdges, threadOf],
  );

  const patchEdge = useCallback(
    (id: string, fields: ThreadFields) => {
      const current = edgesRef.current.find((e) => e.id === id)?.data?.edge;
      if (current === undefined) return;
      const before: ThreadFields = {
        ...('kind' in fields ? { kind: current.kind } : {}),
        ...('label' in fields ? { label: current.label } : {}),
      };
      const label =
        fields.kind === undefined ? 'thread label' : `change to “${kindLabel(fields.kind)}”`;
      recordStep({ type: 'thread', label, id, before, after: fields });
      void sendEdge(id, fields);
    },
    [recordStep, sendEdge],
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
        const label = `framing of ${itemsPhrase(members.map((m) => m.data.node))}`;
        const cards = members.map((m) => ({
          id: m.id,
          before: { group_id: m.data.node.group_id },
          after: { group_id: group.node_id },
        }));
        // One step: the frame, then its cards; undone cards first, then the frame.
        recordStep({
          type: 'batch',
          label,
          steps: [
            { type: 'add', label, nodes: [group], edges: [], members: [] },
            { type: 'patch', label, cards },
          ],
        });
        for (const member of members) {
          mergeData(member.id, { group_id: group.node_id });
          void patchNode(member.id, { group_id: group.node_id });
        }
      } catch (error) {
        setNotice(sentence(error, "Couldn't frame those cards. Try again."));
      }
    },
    [addNode, mergeData, patchNode, recordStep],
  );

  /**
   * The writes an undo or redo replays.
   *
   * @param lead The sentence each failure starts with ("Couldn't undo move of 3 cards.").
   * @returns The board's writes for one replay.
   */
  const replayIo = (lead: string): ReplayIo => ({
    patchCards: async (changes) => {
      if (changes.some((c) => !nodesRef.current.some((n) => n.id === c.id))) {
        setNotice(`${lead} That card is no longer on the board.`);
        return false;
      }
      const by = new Map(changes.map((c) => [c.id, c.fields] as const));
      setNodes(
        nodesRef.current.map((n) => {
          const fields = by.get(n.id);
          return fields === undefined ? n : withFields(n, fields);
        }),
      );
      for (const { id, fields } of changes) {
        if (fields.x !== undefined && fields.y !== undefined)
          sentRef.current.set(id, { x: fields.x, y: fields.y });
      }
      const saved = await Promise.all(changes.map((c) => patchNode(c.id, c.fields, lead)));
      return saved.every(Boolean);
    },
    patchThread: (id, fields) => {
      if (edgesRef.current.some((e) => e.id === id)) return sendEdge(id, fields, lead);
      setNotice(`${lead} That thread is no longer on the board.`);
      return Promise.resolve(false);
    },
    restore: (rows) => restoreRows(rows, lead),
    remove: (rows) => removeRows(rows, lead),
  });
  historyHooks.current = {
    before: () => {
      flushNudges();
      dismissUndo();
    },
    io: replayIo,
  };

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
      history: hist.view,
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
      hist.view,
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
