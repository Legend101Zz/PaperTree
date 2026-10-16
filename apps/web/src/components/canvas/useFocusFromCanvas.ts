'use client';

/**
 * canvas/useFocusFromCanvas — the reader's half of "Open source".
 *
 * The canvas links an excerpt to `/paper/<id>/read?focus=<node_id>`. Once the parse is loaded this
 * reads the board, takes that node's STORED Anchor and calls `focusAnchor` (resolve, scroll, flash).
 * A numbered marker on an AI card adds `&cite=<citation_id>` (#212): then the anchor is that
 * citation's, read from the card's thread message. It runs once per URL; a node or citation that is
 * gone, or a read that fails, is a quiet no-op because the reader has already opened on the paper,
 * which is where the reader wanted to be.
 */
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';

import type { Anchor } from '@papertree/anchoring';

/** Long enough for the page list to mount and the scroll to settle before the 1.2 s flash starts. */
export const FOCUS_SETTLE_MS = 400;

/** The stored anchor of a citation on one assistant message, searched thread by thread. */
async function citationAnchor(
  paperId: string,
  messageId: string,
  citationId: string,
): Promise<Anchor | null> {
  for (const thread of await threadsApi.list(paperId)) {
    const { messages } = await threadsApi.get(paperId, thread.thread_id);
    const message = messages.find((m) => m.message_id === messageId);
    if (message !== undefined)
      return message.citations.find((c) => c.citation_id === citationId)?.anchor ?? null;
  }
  return null;
}

export function useFocusFromCanvas(
  paperId: string | null,
  ready: boolean,
  focusAnchor: (anchor: Anchor, opts?: { flash?: boolean }) => void,
): void {
  const params = useSearchParams();
  const nodeId = params?.get('focus') ?? null;
  const citeId = params?.get('cite') ?? null;
  const done = useRef<string | null>(null);
  const latest = useRef(focusAnchor);
  latest.current = focusAnchor;

  useEffect(() => {
    const key = `${nodeId ?? ''}|${citeId ?? ''}`;
    if (paperId === null || nodeId === null || !ready || done.current === key) return undefined;
    done.current = key;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    boardsApi
      .get(paperId)
      .then(async (view) => {
        const node = view.nodes.find((n) => n.node_id === nodeId);
        if (citeId === null) return node?.source_anchor ?? null;
        const messageId = node?.source_message_id ?? null;
        return messageId === null ? null : citationAnchor(paperId, messageId, citeId);
      })
      .then(
        (anchor) => {
          if (cancelled || anchor === null) return;
          timer = setTimeout(() => latest.current(anchor), FOCUS_SETTLE_MS);
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [paperId, nodeId, citeId, ready]);
}
