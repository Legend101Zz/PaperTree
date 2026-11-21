'use client';

/**
 * board/hooks/useBoardRows — taking cards and threads off the board, and putting them back.
 *
 * A delete is applied on screen at once and sent as one DELETE per card; nothing is asked first (no
 * confirm dialog). For 8 s the toast's Undo puts the same rows back with the same ids (the
 * history's step, so Cmd/Ctrl+Z does the same, for as long as it is the newest).
 */
import { useCallback } from 'react';

import { boardsApi } from '@/lib/api/boards';
import { ApiError, type CanvasNode } from '@/lib/api/types';

import { cardName, toFlowNode, withFields } from '../model/flow';
import { withSubtrees } from '../model/tree';
import { itemsPhrase, restoreBody, restoreThreadBody, type RowsCommand } from '../model/history';
import { RELOADED, sentence } from './controllerShared';

import type { HistoryControl } from './useBoardHistory';
import type { BoardStore } from './useBoardStore';
import type { UndoOfferControl } from './useUndoOffer';
import type { BoardWrites } from './useBoardWrites';

/** Deleting, and the replay of a delete or an add. */
export interface BoardRows {
  readonly deleteSelection: (nodeIds: readonly string[], edgeIds: readonly string[]) => void;
  readonly deleteNodes: (ids: readonly string[]) => void;
  readonly deleteEdges: (ids: readonly string[]) => void;
  /** Takes rows off the board (a gesture's delete, redo of a delete, undo of an add). */
  readonly removeRows: (rows: RowsCommand, lead?: string) => Promise<boolean>;
  /** Puts rows back with the same ids, content and anchors. */
  readonly restoreRows: (rows: RowsCommand, lead: string) => Promise<boolean>;
}

/**
 * Delete and restore of cards and links, for one board.
 *
 * @param paperId The paper whose board this is.
 * @param store The board's working copy.
 * @param writes The write primitives.
 * @param offer Where each gesture's step is recorded.
 * @param hist The history (a delete's requests are waited for by the next undo).
 * @returns The delete and restore gestures.
 */
export function useBoardRows(
  paperId: string,
  store: BoardStore,
  writes: BoardWrites,
  offer: UndoOfferControl,
  hist: HistoryControl,
): BoardRows {
  const {
    aliveRef,
    boardRef,
    nodesRef,
    edgesRef,
    sentRef,
    versionRef,
    chainRef,
    deletingRef,
    mergeData,
    reload,
    setEdges,
    setNodes,
    setNotice,
    threadOf,
  } = store;
  const { failed, clearStale, patchNode, edgeWrite } = writes;
  const { recordStep } = offer;
  const afterWrite = hist.after;

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
      const refused = (what: string, thread?: string) => (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return;
        ok = false;
        failed(error, `Couldn't delete ${what}. ${RELOADED}`, { lead, thread });
      };
      const pending: Promise<void>[] = [];
      const below = new Map<string, string[]>();
      for (const row of rows.nodes) {
        const parent = row.parent_id ?? null;
        if (parent !== null && doomed.has(parent)) {
          below.set(parent, [...(below.get(parent) ?? []), row.node_id]);
        }
      }
      // The server deletes a card's whole subtree: one DELETE for the top of each doomed branch,
      // and the cards under it share its request (their chain and "being deleted" mark).
      const tops = [...doomed].filter((id) => {
        const parent = rows.nodes.find((n) => n.node_id === id)?.parent_id ?? null;
        return parent === null || !doomed.has(parent);
      });
      const under = (id: string): string[] =>
        (below.get(id) ?? []).flatMap((child) => [child, ...under(child)]);
      for (const id of tops) {
        const covered = [id, ...under(id)];
        const previous = Promise.all(
          covered.map((c) => chainRef.current.get(c) ?? Promise.resolve()),
        );
        for (const c of covered) deletingRef.current.add(c);
        const done = previous
          .then(() => boardsApi.deleteNode(boardId, id))
          .catch(refused('that'))
          .finally(() => covered.forEach((c) => deletingRef.current.delete(c)));
        for (const c of covered) {
          chainRef.current.set(c, done);
          sentRef.current.delete(c);
          versionRef.current.delete(c);
        }
        pending.push(done);
      }
      for (const edge of own) {
        const id = edge.edge_id;
        pending.push(
          edgeWrite(id, () => boardsApi.deleteEdge(boardId, id)).catch(refused('that link', id)),
        );
      }
      const all = Promise.all(pending).then(() => ok);
      afterWrite(all);
      return all;
    },
    [
      afterWrite,
      boardRef,
      chainRef,
      deletingRef,
      edgeWrite,
      edgesRef,
      failed,
      nodesRef,
      sentRef,
      setEdges,
      setNodes,
      versionRef,
    ],
  );

  /**
   * Puts rows back with the same ids, content and anchors (frames first, so a card can rejoin its
   * frame; then the cards a deleted frame held; then the threads). The POST is idempotent on the
   * id, so a row the server still has (a reload raced its DELETE) is returned, not doubled.
   * NodeCreate has no `z`, so a card comes back at z 0 (every card v0.2 makes has z 0), with a new
   * `created_at` and version 1; the board sorts by `z, created_at`, so a restored card is drawn
   * last and is the last card Tab reaches (#215).
   */
  const restoreRows = useCallback(
    async (rows: RowsCommand, lead: string): Promise<boolean> => {
      const boardId = boardRef.current?.board_id;
      if (!aliveRef.current || boardId === undefined) return false;
      try {
        const live = new Set(nodesRef.current.map((n) => n.id));
        const ordered = [...rows.nodes].sort(
          (a, b) => Number(b.kind === 'group') - Number(a.kind === 'group'),
        );
        for (const snap of ordered) {
          const groupId = snap.group_id !== null && live.has(snap.group_id) ? snap.group_id : null;
          const created = await boardsApi.createNode(paperId, restoreBody(snap, groupId));
          sentRef.current.set(snap.node_id, { x: created.node.x, y: created.node.y });
          versionRef.current.set(snap.node_id, created.node.version);
          const card = toFlowNode(created.node, paperId);
          setNodes(
            live.has(snap.node_id)
              ? nodesRef.current.map((n) => (n.id === card.id ? card : n))
              : [...nodesRef.current, card],
          );
          live.add(snap.node_id);
        }
        // The server's trigger ungrouped a deleted frame's cards without a new version, so the
        // versions held here are still the server's.
        const rejoin = rows.members.filter((m) => live.has(m.groupId) && live.has(m.id));
        for (const member of rejoin) mergeData(member.id, { group_id: member.groupId });
        const rejoined = await Promise.all(
          rejoin.map((m) => patchNode(m.id, { group_id: m.groupId }, lead)),
        );
        let threads = true;
        for (const edge of rows.edges) {
          if (edgesRef.current.some((e) => e.id === edge.edge_id)) continue;
          if (!live.has(edge.from_node_id) || !live.has(edge.to_node_id)) {
            threads = false; // a card it joined was deleted somewhere else (#215 review N1)
            continue;
          }
          const saved = await boardsApi.createEdge(boardId, restoreThreadBody(edge));
          setEdges([...edgesRef.current, threadOf(saved)]);
        }
        clearStale();
        if (!threads) setNotice(`${lead} A card that thread joined is no longer on the board.`);
        return threads && rejoined.every(Boolean);
      } catch (error) {
        setNotice(`${lead} ${sentence(error, RELOADED)}`);
        void reload();
        return false;
      }
    },
    [
      aliveRef,
      boardRef,
      clearStale,
      edgesRef,
      mergeData,
      nodesRef,
      paperId,
      patchNode,
      reload,
      sentRef,
      setEdges,
      setNodes,
      setNotice,
      threadOf,
      versionRef,
    ],
  );

  /**
   * Deletes cards and links, and offers to take it back. Links that go with a card are removed by
   * the server's cascade; links picked on their own are deleted one by one. Both are remembered.
   */
  const deleteSelection = useCallback(
    (nodeIds: readonly string[], edgeIds: readonly string[]) => {
      // The server deletes the whole subtree of a card, so the screen and the Undo take it too:
      // every card under a chosen one goes with it, parents first (an Undo puts them back in order).
      const live = new Map(nodesRef.current.map((n) => [n.id, n] as const));
      const chosen = new Set(nodeIds.filter((id) => live.has(id)));
      const ordered = withSubtrees(
        nodesRef.current.map((n) => n.data.node),
        chosen,
      );
      const doomed = new Set(ordered.map((n) => n.node_id));
      const edgeSet = new Set(edgeIds);
      const lostEdges = edgesRef.current.filter(
        (e) => edgeSet.has(e.id) || doomed.has(e.source) || doomed.has(e.target),
      );
      const ownEdges = lostEdges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target));
      if (boardRef.current === null || (doomed.size === 0 && ownEdges.length === 0)) return;

      const removedNodes: CanvasNode[] = ordered.flatMap((row) => {
        const n = live.get(row.node_id);
        return n === undefined
          ? []
          : [
              {
                ...n.data.node,
                x: n.position.x,
                y: n.position.y,
                w: n.width ?? n.data.node.w,
                h: n.height ?? n.data.node.h,
              },
            ];
      });
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
    [boardRef, edgesRef, nodesRef, recordStep, removeRows],
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

  return { deleteSelection, deleteNodes, deleteEdges, removeRows, restoreRows };
}
