'use client';

/**
 * board/hooks/useCardSources — what the explanation and notebook cards read beyond the board row.
 *
 * An explanation card holds the answer's TEXT (with the model's `[bN]` handles) and the id of the
 * message it came from; the question, citations, coverage and usage live on the thread
 * (GET /papers/{id}/threads/{tid}). A notebook card holds a page id; its miniature needs the page's
 * items (GET /notebook/pages/{pid}). Both are read once per set of cards, at load, never polled, so
 * a settled board still makes no request. A read that fails leaves the card without the extra (it
 * shows its own words, its counts and its title), never with invented numbers.
 */
import { useEffect, useMemo, useState } from 'react';

import { threadsApi } from '@/lib/api/threads';

import { notebookPagesApi, type NotebookPageRead } from '../api/notebook';
import { explanationSource, type ExplanationSource } from '../model/cards';

import type { PtNode } from '../model/flow';
import type { Citation } from '@/lib/api/types';

const MAX_THREADS = 20;

/** The extras the board's cards have read, by message id and by page id. */
export interface CardSources {
  readonly explanations: ReadonlyMap<string, ExplanationSource>;
  readonly pages: ReadonlyMap<string, NotebookPageRead>;
}

/**
 * The ids a set of cards needs read, joined into a stable key.
 *
 * @param nodes The board's cards.
 * @param kind The card kind.
 * @param pick The id that kind carries.
 * @returns The sorted ids.
 */
function wantedIds(
  nodes: readonly PtNode[],
  kind: 'explanation' | 'notebook',
  pick: (node: PtNode['data']['node']) => string | null,
): string[] {
  const ids = new Set<string>();
  for (const n of nodes) {
    const id = n.data.node.kind === kind ? pick(n.data.node) : null;
    if (id !== null) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Reads the threads, newest first, until every wanted message is found.
 *
 * @param paperId The board's paper.
 * @param wanted The message ids on explanation cards.
 * @returns Message id → its source, for the ones found.
 */
async function readExplanations(
  paperId: string,
  wanted: readonly string[],
): Promise<Map<string, ExplanationSource>> {
  const found = new Map<string, ExplanationSource>();
  const threads = [...(await threadsApi.list(paperId))]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, MAX_THREADS);
  for (const thread of threads) {
    if (found.size === wanted.length) break;
    const { messages } = await threadsApi.get(paperId, thread.thread_id);
    for (const id of wanted) {
      const source = found.has(id) ? null : explanationSource(messages, id);
      if (source !== null) found.set(id, source);
    }
  }
  return found;
}

/**
 * Reads each page; one that fails (gone, not the caller's) is left out.
 *
 * @param wanted The page ids on notebook cards.
 * @returns Page id → the page as read.
 */
async function readPages(wanted: readonly string[]): Promise<Map<string, NotebookPageRead>> {
  const reads = await Promise.allSettled(wanted.map((id) => notebookPagesApi.get(id)));
  const found = new Map<string, NotebookPageRead>();
  reads.forEach((read, i) => {
    const id = wanted[i];
    if (read.status === 'fulfilled' && id !== undefined) found.set(id, read.value);
  });
  return found;
}

/**
 * The thread and notebook reads behind the board's cards, keyed by message id and page id.
 *
 * @param paperId The board's paper.
 * @param nodes The board's cards.
 * @returns What has been read so far (empty maps until the reads land, or when they fail).
 */
export function useCardSources(paperId: string, nodes: readonly PtNode[]): CardSources {
  const messages = wantedIds(nodes, 'explanation', (n) => n.source_message_id);
  const pages = wantedIds(nodes, 'notebook', (n) => n.source_page_id);
  const messageKey = messages.join('|');
  const pageKey = pages.join('|');
  const [explanations, setExplanations] = useState<ReadonlyMap<string, ExplanationSource>>(
    new Map(),
  );
  const [pageReads, setPageReads] = useState<ReadonlyMap<string, NotebookPageRead>>(new Map());

  useEffect(() => {
    if (messages.length === 0) return undefined;
    let live = true;
    readExplanations(paperId, messages).then(
      (found) => live && setExplanations(found),
      () => undefined, // no extras: the cards show their own words without markers
    );
    return () => {
      live = false;
    };
    // The key says when the set of cards changed; the array itself is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, messageKey]);

  useEffect(() => {
    if (pages.length === 0) return undefined;
    let live = true;
    void readPages(pages).then((found) => live && setPageReads(found));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  return useMemo(() => ({ explanations, pages: pageReads }), [explanations, pageReads]);
}

/**
 * The citations of the answers on the board, by message id (the v0.1 hook's shape, kept for its
 * callers).
 *
 * @param paperId The board's paper.
 * @param nodes The board's cards.
 * @returns Message id → its citations; no entry when it could not be read.
 */
export function useExplanationCitations(
  paperId: string,
  nodes: readonly PtNode[],
): ReadonlyMap<string, readonly Citation[]> {
  const { explanations } = useCardSources(paperId, nodes);
  return useMemo(
    () => new Map([...explanations].map(([id, source]) => [id, source.citations] as const)),
    [explanations],
  );
}
