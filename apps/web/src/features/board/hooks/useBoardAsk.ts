'use client';

/**
 * board/hooks/useBoardAsk — asking on the board: an ask streams an answer into a new card, Keep as
 * note makes a note card with no AI, Fold and Tidy are the tree's own gestures (v03-BOARD-SPEC
 * section 3).
 *
 * THE WIRE. `POST /boards/{board}/nodes/{node}/asks` answers with the thread's SSE and a `node`
 * frame first: the answer card the server made up front. This hook adds that card to the working
 * copy at once, so the layout has already given it its room, then reads `text`, `citations` and
 * `done` into the card. A refusal before the stream (409, 429, 503) is a sentence on the board and
 * the ask box stays open, so nothing typed is lost.
 *
 * WHAT STOPS. Stop aborts the read and tells the server (`cancelRun`), and keeps whatever arrived.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';
import { ApiError, type CanvasNode, type Citation, type ParentSpan } from '@/lib/api/types';

import { buildAskBody, isValidQuestion, type QuickAsk } from '../model/askPayload';
import { toFlowNode } from '../model/flow';
import { tidyResets } from '../model/layout';
import { branchCounts, countsPhrase, type BoardTree } from '../model/tree';
import { sentence } from './controllerShared';

import type { Draft } from '../model/ui';
import type { BoardStore } from './useBoardStore';
import type { BoardUiControl } from './useBoardUi';
import type { UndoOfferControl } from './useUndoOffer';
import type { BoardWrites } from './useBoardWrites';

/** An answer on its way in, or the last of what arrived. */
export interface AnswerStream {
  readonly text: string;
  readonly status: 'writing' | 'complete' | 'partial' | 'error' | 'stopped';
  readonly citations: readonly Citation[];
  readonly runId: string | null;
  /** True until the first words arrive; a quick ask never shows it (#349). */
  readonly thinking: boolean;
  /** A sentence about why the answer stopped short; null otherwise. */
  readonly failure: string | null;
}

/** The tree's gestures that reach the server. */
export interface BoardAsk {
  readonly streams: ReadonlyMap<string, AnswerStream>;
  /** Sends the ask box. Resolves once the answer card exists (or the ask was refused). */
  readonly send: (draft: Draft) => Promise<boolean>;
  /** A quick ask from words: no box, no thinking pause. */
  readonly quick: (parentId: string, span: ParentSpan, quick: QuickAsk) => Promise<boolean>;
  /** Keep as note: a note child on the words. */
  readonly keepNote: (parentId: string, span: ParentSpan) => Promise<void>;
  /** Try again on an answer that stopped short. */
  readonly retry: (nodeId: string) => Promise<boolean>;
  readonly stop: (nodeId: string) => void;
  /** Folds a branch into its pill, or unfolds it. */
  readonly fold: (id: string, folded: boolean) => void;
  /** Tidy: every offset of every tree back to 0. */
  readonly tidy: () => Promise<void>;
}

/**
 * The board's asks and tree gestures.
 *
 * @param paperId The paper.
 * @param store The board's working copy.
 * @param writes The write primitives.
 * @param offer Where each gesture's step is recorded.
 * @param control What is open (an ask closes its box, a new card takes focus).
 * @param tree The trees as they stand.
 * @returns The streams and the gestures.
 */
export function useBoardAsk(
  paperId: string,
  store: BoardStore,
  writes: BoardWrites,
  offer: UndoOfferControl,
  control: BoardUiControl,
  tree: BoardTree,
): BoardAsk {
  const {
    boardRef,
    nodesRef,
    versionRef,
    sentRef,
    aliveRef,
    setNodes,
    mergeData,
    setNotice,
    reload,
  } = store;
  const [streams, setStreams] = useState<ReadonlyMap<string, AnswerStream>>(new Map());
  const aborts = useRef(new Map<string, AbortController>());
  const treeRef = useRef(tree);
  treeRef.current = tree;

  useEffect(() => {
    const live = aborts.current;
    return () => live.forEach((c) => c.abort());
  }, []);

  const patchStream = useCallback((id: string, patch: Partial<AnswerStream>) => {
    setStreams((prev) => {
      const was = prev.get(id);
      if (was === undefined) return prev;
      return new Map(prev).set(id, { ...was, ...patch });
    });
  }, []);

  /** Puts a card the server made into the working copy: its version and place are the server's. */
  const adopt = useCallback(
    (node: CanvasNode) => {
      versionRef.current.set(node.node_id, node.version);
      sentRef.current.set(node.node_id, { x: node.x, y: node.y });
      const exists = nodesRef.current.some((n) => n.id === node.node_id);
      const card = toFlowNode(node, paperId);
      setNodes(
        exists
          ? nodesRef.current.map((n) => (n.id === card.id ? card : n))
          : [...nodesRef.current, card],
      );
    },
    [nodesRef, paperId, sentRef, setNodes, versionRef],
  );

  const run = useCallback(
    async (
      parentId: string,
      body: NonNullable<ReturnType<typeof buildAskBody>>,
      quick: boolean,
    ): Promise<boolean> => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return false;
      const controller = new AbortController();
      let id: string | null = null;
      let written = '';
      try {
        for await (const event of boardsApi.ask(boardId, parentId, body, controller.signal)) {
          if (!aliveRef.current) return id !== null;
          if (event.event === 'node') {
            const node = event.data;
            id = node.node_id;
            aborts.current.set(id, controller);
            adopt(node);
            setStreams((prev) =>
              new Map(prev).set(node.node_id, {
                text: '',
                status: 'writing',
                citations: [],
                runId: null,
                thinking: !quick,
                failure: null,
              }),
            );
            control.setText('');
            control.closeDraft();
            control.focus(node.node_id);
            continue;
          }
          if (id === null) continue;
          if (event.event === 'run') patchStream(id, { runId: event.data.run_id });
          else if (event.event === 'text') {
            const at = id;
            written += event.data.delta;
            setStreams((prev) => {
              const was = prev.get(at);
              if (was === undefined) return prev;
              return new Map(prev).set(at, {
                ...was,
                text: was.text + event.data.delta,
                thinking: false,
              });
            });
          } else if (event.event === 'citations') patchStream(id, { citations: event.data.items });
          else if (event.event === 'done') {
            const { status, error } = event.data;
            patchStream(id, {
              status: status === 'aborted' ? 'stopped' : status,
              thinking: false,
              failure: error === null ? null : error.message,
            });
          }
        }
        return id !== null;
      } catch (error) {
        if (controller.signal.aborted) return id !== null;
        if (id === null) {
          // Refused before the stream: the box stays open with what was typed.
          setNotice(
            sentence(error, "Couldn't send that question. Check your connection, then try again."),
          );
          return false;
        }
        patchStream(id, {
          status: 'error',
          thinking: false,
          failure: error instanceof ApiError ? error.detail : 'The answer stopped arriving.',
        });
        return true;
      } finally {
        if (id !== null) {
          aborts.current.delete(id);
          // What arrived is the card's own text now; the stored copy comes with the next read.
          if (written !== '' && aliveRef.current) mergeData(id, { final_text: written });
        }
      }
    },
    [adopt, aliveRef, boardRef, control, mergeData, patchStream, setNotice],
  );

  const send = useCallback(
    (draft: Draft): Promise<boolean> => {
      const body = buildAskBody({
        question: draft.text,
        span: draft.span,
        askDifferently: draft.askDifferently,
        uses: draft.uses,
      });
      return body === null ? Promise.resolve(false) : run(draft.parentId, body, false);
    },
    [run],
  );

  const quick = useCallback(
    (parentId: string, span: ParentSpan, which: QuickAsk): Promise<boolean> => {
      const body = buildAskBody({ quick: which, span, uses: control.freshUses });
      control.openMenu(null);
      return body === null ? Promise.resolve(false) : run(parentId, body, true);
    },
    [control, run],
  );

  /**
   * Try again on an answer that stopped short (rule 6): the same question, Uses and level, with
   * `redo_of` set, so the server replaces a failed answer with no branches in place and gives any
   * other a `right` sibling.
   */
  const retry = useCallback(
    (nodeId: string): Promise<boolean> => {
      const row = nodesRef.current.find((n) => n.id === nodeId)?.data.node;
      const question = (row?.question ?? '').trim();
      if (row === undefined || !isValidQuestion(question)) return Promise.resolve(false);
      const uses = row.uses ?? control.freshUses;
      return run(
        nodeId,
        {
          question,
          uses,
          level: row.level ?? uses.level,
          redo_of: nodeId,
          ...(row.parent_span != null ? { span: row.parent_span } : {}),
        },
        false,
      );
    },
    [control.freshUses, nodesRef, run],
  );

  const keepNote = useCallback(
    async (parentId: string, span: ParentSpan): Promise<void> => {
      const boardId = boardRef.current?.board_id;
      if (boardId === undefined) return;
      control.openMenu(null);
      try {
        const note = await boardsApi.keepNote(boardId, parentId, { span, text: span.quote });
        if (!aliveRef.current) return;
        adopt(note);
        control.focus(note.node_id);
      } catch (error) {
        setNotice(
          sentence(error, "Couldn't keep that as a note. Check your connection, then try again."),
        );
      }
    },
    [adopt, aliveRef, boardRef, control, setNotice],
  );

  const stop = useCallback(
    (nodeId: string) => {
      const was = streams.get(nodeId);
      aborts.current.get(nodeId)?.abort();
      if (was?.runId != null) threadsApi.cancelRun(was.runId).catch(() => undefined);
      patchStream(nodeId, { status: 'stopped', thinking: false });
    },
    [patchStream, streams],
  );

  const { patchNode } = writes;
  const { recordStep, forgetRow } = offer;

  const fold = useCallback(
    (id: string, folded: boolean) => {
      const row = nodesRef.current.find((n) => n.id === id)?.data.node;
      if (row === undefined) return;
      const counts = branchCounts(treeRef.current, id);
      mergeData(id, { folded });
      void patchNode(id, { folded });
      recordStep({
        type: 'patch',
        label: `${folded ? 'fold' : 'unfold'} of ${countsPhrase(counts)}`,
        cards: [{ id, before: { folded: !folded }, after: { folded } }],
      });
    },
    [mergeData, nodesRef, patchNode, recordStep],
  );

  const tidy = useCallback(async (): Promise<void> => {
    const boardId = boardRef.current?.board_id;
    if (boardId === undefined) return;
    const current = treeRef.current;
    const jobs = current.roots
      .map((root) => ({ root, ids: tidyResets(current, root.node_id) }))
      .filter((job) => job.ids.length > 0);
    if (jobs.length === 0) return;
    const ids = jobs.flatMap((job) => job.ids);
    for (const id of ids) mergeData(id, { offset_x: 0, offset_y: 0 });
    // The server bumps every version it touches: the history must not keep a step that would write
    // over them with the version it knew (it would answer 409).
    for (const id of ids) forgetRow(id);
    try {
      // The answer lists the cards it changed with their new versions: no second read of the board.
      for (const job of jobs) {
        const { nodes } = await boardsApi.tidy(boardId, job.root.node_id);
        if (!aliveRef.current) return;
        for (const changed of nodes) {
          versionRef.current.set(changed.node_id, changed.version);
          mergeData(changed.node_id, {
            offset_x: changed.offset_x,
            offset_y: changed.offset_y,
            version: changed.version,
            updated_at: changed.updated_at,
          });
        }
      }
    } catch (error) {
      setNotice(sentence(error, "Couldn't tidy the board. Check your connection, then try again."));
      // A refused or half-done Tidy: what the server holds is the truth.
      await reload();
    }
  }, [aliveRef, boardRef, forgetRow, mergeData, reload, setNotice, versionRef]);

  return { streams, send, quick, retry, keepNote, stop, fold, tidy };
}
