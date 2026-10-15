'use client';

/**
 * canvas/useFocusFromCanvas — the reader's half of "Open source".
 *
 * The canvas links an excerpt to `/paper/<id>/read?focus=<node_id>`. Once the parse is loaded this
 * reads the board, takes that node's STORED Anchor and calls `focusAnchor` (resolve, scroll, flash).
 * It runs once per `?focus=` value; a node that is gone, or a read that fails, is a quiet no-op
 * because the reader has already opened on the paper, which is where the reader wanted to be.
 */
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import type { Anchor } from '@papertree/anchoring';

import { boardsApi } from '@/lib/api/boards';

/** Long enough for the page list to mount and the scroll to settle before the 1.2 s flash starts. */
export const FOCUS_SETTLE_MS = 400;

export function useFocusFromCanvas(
  paperId: string | null,
  ready: boolean,
  focusAnchor: (anchor: Anchor, opts?: { flash?: boolean }) => void,
): void {
  const nodeId = useSearchParams()?.get('focus') ?? null;
  const done = useRef<string | null>(null);
  const latest = useRef(focusAnchor);
  latest.current = focusAnchor;

  useEffect(() => {
    if (paperId === null || nodeId === null || !ready || done.current === nodeId) return undefined;
    done.current = nodeId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    boardsApi.get(paperId).then(
      (view) => {
        const anchor = view.nodes.find((n) => n.node_id === nodeId)?.source_anchor ?? null;
        if (cancelled || anchor === null) return;
        timer = setTimeout(() => latest.current(anchor), FOCUS_SETTLE_MS);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [paperId, nodeId, ready]);
}
