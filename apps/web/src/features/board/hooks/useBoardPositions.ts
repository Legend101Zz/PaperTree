'use client';

/**
 * board/hooks/useBoardPositions — dragging, nudging and the writes that follow.
 *
 * THE RULE (contracts.md §2.7): the client writes only on explicit gestures. A drag sends one PATCH
 * per node that moved, at drag END; the only timer is the 400 ms debounce that turns a run of
 * arrow-key nudges into one PATCH. A settled board makes no request at all.
 */
import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';

import { cardBoxes, frameBoxes, regroup } from '../model/frames';
import { itemsPhrase, type CardChange } from '../model/history';
import { NUDGE_DEBOUNCE_MS } from './controllerShared';

import type { PtEdge, PtNode } from '../model/flow';
import type { BoardStore } from './useBoardStore';
import type { UndoOfferControl } from './useUndoOffer';
import type { BoardWrites } from './useBoardWrites';

/** The gestures that move cards. */
export interface BoardPositions {
  readonly onNodesChange: (changes: NodeChange<PtNode>[]) => void;
  readonly onEdgesChange: (changes: EdgeChange<PtEdge>[]) => void;
  readonly onNodeDragStop: () => void;
  /** Sends (and records as one step) a pending run of nudges now rather than after the debounce. */
  readonly flushNudges: () => void;
}

/**
 * The drag and nudge handlers for one board.
 *
 * @param store The board's working copy.
 * @param writes The write primitives.
 * @param offer Where each gesture's step is recorded.
 * @returns The drag and nudge handlers.
 */
export function useBoardPositions(
  store: BoardStore,
  writes: BoardWrites,
  offer: UndoOfferControl,
): BoardPositions {
  const { nodesRef, edgesRef, sentRef, mergeData, setNodes, setEdges } = store;
  const { patchNode } = writes;
  const { recordStep } = offer;
  const nudgeIds = useRef(new Set<string>());
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    },
    [],
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
    [mergeData, nodesRef, patchNode, recordStep, sentRef],
  );

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
    [flushNudges, nodesRef, setNodes],
  );

  /** Selection of a link; deleting goes through `deleteEdges`, never through xyflow's removal. */
  const onEdgesChange = useCallback(
    (incoming: EdgeChange<PtEdge>[]) => {
      const changes = incoming.filter((c) => c.type !== 'remove');
      if (changes.length > 0) setEdges(applyEdgeChanges(changes, edgesRef.current));
    },
    [edgesRef, setEdges],
  );

  /** Drag END: every node whose position differs from what the server has, one PATCH each. */
  const onNodeDragStop = useCallback(() => {
    if (nudgeTimer.current !== null) {
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = null;
    }
    nudgeIds.current.clear();
    flushPositions(nodesRef.current.map((n) => n.id));
  }, [flushPositions, nodesRef]);

  return { onNodesChange, onEdgesChange, onNodeDragStop, flushNudges };
}
