'use client';

/**
 * canvas/useExplanationCitations — the citations of the answers on the canvas.
 *
 * An explanation card holds the answer's TEXT (with the model's `[bN]` handles) and the id of the
 * message it came from (`source_message_id`); the citations live on the message
 * (GET /papers/{id}/threads/{tid}). This reads the paper's threads once per set of cards and maps
 * message id -> citations, so a card can show "p. 4" where the model wrote "[b2]". When a message
 * cannot be found or the read fails, the card has no entry and strips the handles instead.
 */
import { useEffect, useMemo, useState } from 'react';

import { threadsApi } from '@/lib/api/threads';
import type { Citation } from '@/lib/api/types';

import type { PtNode } from './model';

const MAX_THREADS = 20;

export function useExplanationCitations(
  paperId: string,
  nodes: readonly PtNode[],
): ReadonlyMap<string, readonly Citation[]> {
  const wanted = useMemo(() => {
    const ids = new Set<string>();
    for (const n of nodes) {
      const node = n.data.node;
      if (node.kind === 'explanation' && node.source_message_id !== null) ids.add(node.source_message_id);
    }
    return [...ids].sort();
  }, [nodes]);
  const key = wanted.join('|');
  const [found, setFound] = useState<ReadonlyMap<string, readonly Citation[]>>(new Map());

  useEffect(() => {
    if (wanted.length === 0) return undefined;
    let live = true;
    const missing = new Set(wanted.filter((id) => !found.has(id)));
    if (missing.size === 0) return undefined;
    void (async () => {
      try {
        const threads = [...(await threadsApi.list(paperId))]
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, MAX_THREADS);
        const next = new Map(found);
        for (const thread of threads) {
          if (missing.size === 0 || !live) break;
          const { messages } = await threadsApi.get(paperId, thread.thread_id);
          for (const message of messages) {
            if (missing.delete(message.message_id)) next.set(message.message_id, message.citations);
          }
        }
        if (live) setFound(next);
      } catch {
        // No citations for these cards: they show their words without handles.
      }
    })();
    return () => {
      live = false;
    };
    // `found` is read as the starting point only; the key says when the set of cards changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, key]);

  return found;
}
