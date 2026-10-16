'use client';

/**
 * board/hooks/useCardSources — what the explanation and notebook cards read beyond the board row.
 *
 * An explanation card holds the answer's TEXT (with the model's `[bN]` handles) and the id of the
 * message it came from; the question, citations, coverage and usage live on the thread
 * (GET /papers/{id}/threads/{tid}). A notebook card holds a page id; its miniature needs the page's
 * items (GET /notebook/pages/{pid}). Each is read once, when its card first appears, never polled,
 * so a settled board makes no request and a delete or an Undo makes none either. A read that fails leaves the card without the extra (it
 * shows its own words, its counts and its title), never with invented numbers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { threadsApi } from '@/lib/api/threads';

import { notebookPagesApi, type NotebookPageRead } from '../api/notebook';
import { explanationSource, type ExplanationSource } from '../model/cards';

import type { PtNode } from '../model/flow';
import type { MessageDiagram } from '@/lib/api/types';

const MAX_THREADS = 20;
/** Diagram threads read at once when a board's plates are looked up. */
const DIAGRAM_BATCH = 4;

/** The extras the board's cards have read, by message id and by page id. */
export interface CardSources {
  readonly explanations: ReadonlyMap<string, ExplanationSource>;
  readonly pages: ReadonlyMap<string, NotebookPageRead>;
  /** A diagram card's plate, by its message id (#217). */
  readonly diagrams: ReadonlyMap<string, MessageDiagram>;
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
  kind: 'explanation' | 'notebook' | 'diagram',
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
      const source = found.has(id) ? null : explanationSource(thread.thread_id, messages, id);
      if (source !== null) found.set(id, source);
    }
  }
  return found;
}

/**
 * Reads the diagram threads, newest first, until every wanted plate is found (#217).
 *
 * @param paperId The board's paper.
 * @param wanted The message ids on diagram cards.
 * @returns Message id → its stored plate, for the ones found.
 */
async function readDiagrams(
  paperId: string,
  wanted: readonly string[],
): Promise<Map<string, MessageDiagram>> {
  const found = new Map<string, MessageDiagram>();
  const threads = [...(await threadsApi.list(paperId))]
    .filter((t) => t.kind === 'diagram')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, MAX_THREADS);
  // A few reads at a time, not twenty in a row (#217 review N9): each read is a whole thread.
  for (let i = 0; i < threads.length && found.size < wanted.length; i += DIAGRAM_BATCH) {
    const reads = await Promise.allSettled(
      threads.slice(i, i + DIAGRAM_BATCH).map((t) => threadsApi.get(paperId, t.thread_id)),
    );
    for (const read of reads) {
      if (read.status !== 'fulfilled') continue;
      for (const m of read.value.messages) {
        if (m.diagram !== undefined && wanted.includes(m.message_id)) {
          found.set(m.message_id, m.diagram);
        }
      }
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
 * Reads what a set of ids needs, once per id: an id read before (or being read) is not read again,
 * so deleting a card, or bringing it back with Undo, sends no request. A read that fails is
 * forgotten, so the next change to the set tries it again.
 *
 * @param key The wanted ids, joined: what changes when the set of cards changes.
 * @param wanted The ids the cards need.
 * @param read Reads the missing ids.
 * @returns Id → what was read so far.
 */
function useReadOnce<V>(
  key: string,
  wanted: readonly string[],
  read: (missing: readonly string[]) => Promise<Map<string, V>>,
): ReadonlyMap<string, V> {
  const [found, setFound] = useState<ReadonlyMap<string, V>>(new Map());
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const missing = wanted.filter((id) => !asked.current.has(id));
    if (missing.length === 0) return undefined;
    missing.forEach((id) => asked.current.add(id));
    let live = true;
    let done = false;
    const forget = (): void => missing.forEach((id) => asked.current.delete(id));
    read(missing).then(
      (more) => {
        done = true;
        if (live) setFound((prev) => new Map([...prev, ...more]));
      },
      () => {
        done = true;
        forget(); // no extras: the cards show their own words, counts and titles
      },
    );
    return () => {
      live = false;
      if (!done) forget(); // unmounted mid-read (or React's dev re-run): read again next time
    };
    // The key says when the set changed; the array itself is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
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
  const explanations = useReadOnce(`${paperId}:${messages.join('|')}`, messages, (missing) =>
    readExplanations(paperId, missing),
  );
  const pageReads = useReadOnce(pages.join('|'), pages, readPages);
  const plates = wantedIds(nodes, 'diagram', (n) => n.source_diagram_id);
  const diagrams = useReadOnce(`${paperId}:${plates.join('|')}`, plates, (missing) =>
    readDiagrams(paperId, missing),
  );
  return useMemo(
    () => ({ explanations, pages: pageReads, diagrams }),
    [explanations, pageReads, diagrams],
  );
}
