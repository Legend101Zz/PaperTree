'use client';

/**
 * board/hooks/useBoardEdits — the gestures that change or add a card: an edit commit, a resize,
 * a new note or frame, framing several cards. Each is applied on screen at once, sent after, and
 * recorded as ONE undo step.
 */
import { useCallback } from 'react';

import { boardsApi } from '@/lib/api/boards';

import { cardName, toFlowNode, type PtNode } from '../model/flow';
import { cardBoxes, frameBoxes, regroupAround } from '../model/frames';
import { itemsPhrase, type CardChange } from '../model/history';
import { newNodeId } from '../model/ids';
import { DEFAULT_SIZE, boundsOf, freeSpot, spotNear } from '../model/placement';
import { sentence } from './controllerShared';

import type { CanvasNode } from '@/lib/api/types';
import type { BoardStore } from './useBoardStore';
import type { UndoOfferControl } from './useUndoOffer';
import type { BoardWrites } from './useBoardWrites';

/** The edit and add gestures. */
export interface BoardEdits {
  readonly addNote: (near?: { x: number; y: number }) => Promise<void>;
  readonly addFrame: (centre: { x: number; y: number }) => Promise<void>;
  readonly commitBody: (id: string, body: string) => void;
  readonly commitTitle: (id: string, title: string) => void;
  readonly commitSize: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  readonly groupNodes: (ids: readonly string[]) => Promise<void>;
}

/**
 * A card's rectangle as the placement helpers want it.
 *
 * @param n The card.
 * @returns Its position and measured (else stored) size.
 */
const rectOf = (n: PtNode) => ({
  x: n.position.x,
  y: n.position.y,
  w: n.width ?? n.data.node.w,
  h: n.height ?? n.data.node.h,
});

/**
 * The edit and add gestures for one board.
 *
 * @param paperId The paper whose board this is (new cards are created through it).
 * @param store The board's working copy.
 * @param writes The write primitives.
 * @param offer Where each gesture's step is recorded.
 * @returns The edit and add gestures.
 */
export function useBoardEdits(
  paperId: string,
  store: BoardStore,
  writes: BoardWrites,
  offer: UndoOfferControl,
): BoardEdits {
  const {
    boardRef,
    nodesRef,
    sentRef,
    versionRef,
    mergeData,
    setBoardBoth,
    setNodes,
    setNotice,
    setEditingId,
  } = store;
  const { patchNode, clearStale } = writes;
  const { recordStep } = offer;

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
    [mergeData, nodesRef, patchNode, recordStep],
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
    [mergeData, nodesRef, patchNode, recordStep],
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
    [mergeData, nodesRef, patchNode, recordStep, sentRef],
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
    [boardRef, clearStale, nodesRef, paperId, sentRef, setBoardBoth, setNodes, versionRef],
  );

  const addNote = useCallback(
    async (near?: { x: number; y: number }) => {
      try {
        const size = DEFAULT_SIZE.note;
        const spot = freeSpot(nodesRef.current.map(rectOf), size, near);
        const node = await addNode('note', spot, size, {});
        recordStep({ type: 'add', label: 'new note', nodes: [node], edges: [], members: [] });
        setEditingId(node.node_id);
      } catch (error) {
        setNotice(sentence(error, "Couldn't add a note. Check your connection and try again."));
      }
    },
    [addNode, nodesRef, recordStep, setEditingId, setNotice],
  );

  const addFrame = useCallback(
    async (centre: { x: number; y: number }) => {
      // In clear space nearest the middle of the view, never on top of cards (#214 review S1); and
      // empty on purpose: a card joins a frame when it is dropped in it.
      const size = DEFAULT_SIZE.group;
      const at = spotNear(nodesRef.current.map(rectOf), size, centre);
      try {
        const node = await addNode('group', at, size, { title: 'New frame' });
        recordStep({ type: 'add', label: 'new frame', nodes: [node], edges: [], members: [] });
        setEditingId(node.node_id);
      } catch (error) {
        setNotice(sentence(error, "Couldn't add a frame. Check your connection and try again."));
      }
    },
    [addNode, nodesRef, recordStep, setEditingId, setNotice],
  );

  const groupNodes = useCallback(
    async (ids: readonly string[]) => {
      const members = nodesRef.current.filter(
        (n) => ids.includes(n.id) && n.data.node.kind !== 'group',
      );
      if (members.length < 2) return;
      try {
        const box = boundsOf(members.map(rectOf));
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
    [addNode, mergeData, nodesRef, patchNode, recordStep, setNotice],
  );

  return { addNote, addFrame, commitBody, commitTitle, commitSize, groupNodes };
}
