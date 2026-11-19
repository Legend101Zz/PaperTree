'use client';

/**
 * board/hooks/useBoardController — the one place the board talks to the API, composed from focused
 * hooks (#349 split it from one 1,170-line file; behaviour is unchanged):
 *
 * - `useBoardStore`: the working copy (`nodesRef`) and the board's one read;
 * - `useBoardWrites`: one PATCH at a time per card, the 409 and failure sentences;
 * - `useBoardPositions`: drag END, the 400 ms nudge debounce;
 * - `useBoardEdits`: edit commits, resize, new notes and frames, framing;
 * - `useBoardRows`: delete and restore of cards and links;
 * - `useBoardThreads`: threads between cards;
 * - `useUndoOffer` + `useBoardHistory` + `useBoardReplay`: undo and redo (#215);
 * - `useBoardViewport`: pan and zoom, saved at gesture END.
 *
 * THE RULE (contracts.md §2.7): the client writes only on explicit gestures — drag END (one PATCH
 * per node that moved), an edit commit, connect, group, delete, and pan/zoom END for the viewport.
 * A settled board makes no request at all: there is no polling, no refetch on focus, no autosave
 * timer. The only timer is the 400 ms debounce that turns a run of arrow-key nudges into one PATCH.
 *
 * LOCAL FIRST, THEN THE SERVER. A change is applied to the screen at once and sent after; if the
 * server refuses it, the reader sees a sentence and the board is reloaded from the server.
 *
 * UNDO AND REDO (#215). Every gesture that writes records ONE step; undo and redo replay it through
 * the same writes, with the version held when they run, so a card changed somewhere else answers
 * 409. Threads carry no version (#283), so a thread step reads the thread first and refuses if it
 * changed. The Undo toast after a delete or a new thread names its own step and takes back that
 * step or nothing.
 */
import { useMemo, useRef } from 'react';

import {
  NOT_NEWEST,
  NUDGE_DEBOUNCE_MS,
  STALE_NOTICE_MS,
  UNDO_VISIBLE_MS,
  staleSubject,
  type BoardController,
  type Status,
  type ThreadPorts,
  type UndoOffer,
} from './controllerShared';
import { useBoardEdits } from './useBoardEdits';
import { useBoardHistory, type HistoryHooks } from './useBoardHistory';
import { useBoardPositions } from './useBoardPositions';
import { useBoardReplay } from './useBoardReplay';
import { useBoardRows } from './useBoardRows';
import { useBoardStore } from './useBoardStore';
import { useBoardThreads } from './useBoardThreads';
import { useBoardViewport } from './useBoardViewport';
import { useBoardWrites } from './useBoardWrites';
import { useUndoOffer } from './useUndoOffer';

export { NOT_NEWEST, NUDGE_DEBOUNCE_MS, STALE_NOTICE_MS, UNDO_VISIBLE_MS, staleSubject };
export type { BoardController, Status, ThreadPorts, UndoOffer };

/**
 * The board's state and its writes, for one paper.
 *
 * @param paperId The paper whose board this is.
 * @returns The controller.
 */
export function useBoardController(paperId: string): BoardController {
  /** Filled at the end of every render: what an undo or redo runs (the writes below). */
  const historyHooks = useRef<HistoryHooks | null>(null);
  const hist = useBoardHistory(historyHooks);
  const store = useBoardStore(paperId, hist.holds);
  const offer = useUndoOffer(hist, store.setNotice);
  const writes = useBoardWrites(store, offer);
  const positions = useBoardPositions(store, writes, offer);
  const edits = useBoardEdits(paperId, store, writes, offer);
  const rows = useBoardRows(paperId, store, writes, offer, hist);
  const threads = useBoardThreads(paperId, store, writes, offer);
  const saveViewport = useBoardViewport(store);
  useBoardReplay(historyHooks, { store, writes, offer, positions, rows, threads });

  const { status, board, nodes, edges, notice, editingId, setEditingId, initialViewport, reload } =
    store;
  const { undo, runUndo, dismissUndo } = offer;
  const { dismissNotice } = writes;
  const { onNodesChange, onEdgesChange, onNodeDragStop } = positions;
  const { addNote, addFrame, commitBody, commitTitle, commitSize, groupNodes } = edits;
  const { deleteSelection, deleteNodes, deleteEdges } = rows;
  const { connect, patchEdge } = threads;

  return useMemo(
    () => ({
      status,
      board,
      nodes,
      edges,
      notice,
      editingId,
      setEditingId,
      dismissNotice,
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
      internals: { store, writes, offer },
    }),
    [
      status,
      board,
      nodes,
      edges,
      notice,
      editingId,
      setEditingId,
      dismissNotice,
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
      store,
      writes,
      offer,
    ],
  );
}
