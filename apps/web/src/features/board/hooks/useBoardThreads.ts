'use client';

/**
 * board/hooks/useBoardThreads — the threads (edges) between cards: drawing one, changing its kind
 * or label, and the replay of such a change by undo or redo.
 */
import { useCallback } from 'react';

import { boardsApi } from '@/lib/api/boards';

import { kindLabel } from '../model/flow';
import { threadIsAsLeft, type RowsCommand, type ThreadFields } from '../model/history';
import { newEdgeId } from '../model/ids';
import { linkedSentence } from '../model/linkAs';
import { RELOADED, sentence, type ThreadPorts } from './controllerShared';

import type { EdgeKind } from '@/lib/api/types';
import type { BoardStore } from './useBoardStore';
import type { UndoOfferControl } from './useUndoOffer';
import type { BoardWrites } from './useBoardWrites';

/** The thread gestures, and the replay of one. */
export interface BoardThreads {
  readonly connect: (
    from: string,
    to: string,
    kind: EdgeKind,
    label: string | null,
    ports?: ThreadPorts,
  ) => Promise<boolean>;
  readonly patchEdge: (id: string, fields: ThreadFields) => void;
  /** A thread step's replay (read first, refused if another tab changed it); true once saved. */
  readonly replayThread: (
    id: string,
    fields: ThreadFields,
    expect: ThreadFields,
    lead: string,
  ) => Promise<boolean>;
}

/**
 * The thread gestures for one board.
 *
 * @param paperId The paper whose board this is.
 * @param store The board's working copy.
 * @param writes The write primitives.
 * @param offer Where each gesture's step is recorded.
 * @returns The thread gestures.
 */
export function useBoardThreads(
  paperId: string,
  store: BoardStore,
  writes: BoardWrites,
  offer: UndoOfferControl,
): BoardThreads {
  const { boardRef, edgesRef, adopt, setEdges, setNotice, threadOf } = store;
  const { failed, clearStale, edgeWrite } = writes;
  const { recordStep, forgetRow } = offer;

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
    [boardRef, clearStale, edgesRef, recordStep, setEdges, setNotice, threadOf],
  );

  /** A thread's kind or label on screen at once (the PATCH is the caller's, in the thread's turn). */
  const showEdge = useCallback(
    (id: string, fields: ThreadFields): string | null => {
      const boardId = boardRef.current?.board_id;
      const current = edgesRef.current.find((e) => e.id === id);
      if (boardId === undefined || current?.data === undefined) return null;
      const merged = { ...current.data.edge, ...fields };
      setEdges(
        edgesRef.current.map((e) =>
          e.id === id ? { ...threadOf(merged), selected: e.selected } : e,
        ),
      );
      return boardId;
    },
    [boardRef, edgesRef, setEdges, threadOf],
  );

  /** One PATCH of a thread, after its earlier writes; resolves true once saved. */
  const putEdge = useCallback(
    (boardId: string, id: string, fields: ThreadFields, lead?: string): Promise<boolean> =>
      boardsApi.patchEdge(boardId, id, fields).then(
        () => true,
        (error: unknown) => {
          failed(error, `Couldn't save that link. ${RELOADED}`, { thread: id, lead });
          return false;
        },
      ),
    [failed],
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
      const boardId = showEdge(id, fields);
      if (boardId !== null) void edgeWrite(id, () => putEdge(boardId, id, fields));
    },
    [edgeWrite, edgesRef, putEdge, recordStep, showEdge],
  );

  /**
   * Threads carry no version (#283), so the thread is read from the server first and the replay
   * refused, with the board refreshed and a sentence, when it is not as the step left it: another
   * tab changed it. One round trip remains between that read and the PATCH.
   */
  const replayThread = useCallback(
    async (
      id: string,
      fields: ThreadFields,
      expect: ThreadFields,
      lead: string,
    ): Promise<boolean> => {
      try {
        const view = await boardsApi.get(paperId);
        const row = view.edges.find((e) => e.edge_id === id);
        if (row === undefined || !threadIsAsLeft(row, expect)) {
          forgetRow(id);
          adopt(view);
          setNotice(
            row === undefined
              ? `${lead} That thread is no longer on the board.`
              : `${lead} The thread was changed somewhere else. The latest version is shown.`,
          );
          return false;
        }
      } catch (error) {
        failed(error, RELOADED, { thread: id, lead });
        return false;
      }
      const boardId = showEdge(id, fields);
      return boardId === null ? false : putEdge(boardId, id, fields, lead);
    },
    [adopt, failed, forgetRow, paperId, putEdge, setNotice, showEdge],
  );

  return { connect, patchEdge, replayThread };
}
