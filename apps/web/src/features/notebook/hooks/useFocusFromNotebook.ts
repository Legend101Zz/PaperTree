'use client';

/**
 * useFocusFromNotebook — the reader's half of the notebook's "Show in paper" and its "From your
 * question" link (S5c, #208). The notebook links to `/paper/<id>/read?nb=<page>&item=<item>`; once
 * the parse is loaded this reads that page back, takes the item's STORED Anchor (a quote card's
 * own, or the exchange's origin) and calls the reader's `focusAnchor` (resolve, scroll, flash), as
 * `useFocusFromCanvas` does for `?focus=<node>`. A page or item that is gone is a quiet no-op: the
 * reader has already opened on the paper.
 */
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { notebookApi } from '../api/notebookApi';
import { parseExchangeBody } from '../model/wire';

import type { NotebookItemWire } from '../api/notebookApi';
import type { Anchor } from '@papertree/anchoring';

/** Long enough for the page list to mount and the scroll to settle before the flash starts. */
const SETTLE_MS = 400;

/**
 * The Anchor a notebook item points at in the paper.
 *
 * @param item - A stored item.
 * @returns A quote's Anchor, an exchange's origin Anchor, or null for anything else.
 */
export function anchorOfItem(item: NotebookItemWire): Anchor | null {
  if (item.kind === 'quote') return item.anchor;
  if (item.kind === 'exchange') return parseExchangeBody(item.body)?.call.originAnchor ?? null;
  return null;
}

/**
 * Flashes the passage a notebook link named, once per link.
 *
 * @param paperId - The paper open in the reader (null for a fixture).
 * @param ready - True once the parse is loaded and `focusAnchor` can resolve.
 * @param focusAnchor - The reader's resolve-scroll-flash.
 */
export function useFocusFromNotebook(
  paperId: string | null,
  ready: boolean,
  focusAnchor: (anchor: Anchor, opts?: { flash?: boolean }) => void,
): void {
  const params = useSearchParams();
  const pageId = params?.get('nb') ?? null;
  const itemId = params?.get('item') ?? null;
  const done = useRef<string | null>(null);
  const latest = useRef(focusAnchor);
  latest.current = focusAnchor;

  useEffect(() => {
    const key = `${pageId ?? ''}/${itemId ?? ''}`;
    if (paperId === null || pageId === null || itemId === null || !ready || done.current === key) {
      return undefined;
    }
    done.current = key;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    notebookApi.getPage(pageId).then(
      (view) => {
        const item = view.items.find((i) => i.item_id === itemId);
        const anchor = item === undefined ? null : anchorOfItem(item);
        if (cancelled || anchor === null || view.page.paper_id !== paperId) return;
        timer = setTimeout(() => latest.current(anchor), SETTLE_MS);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [paperId, pageId, itemId, ready]);
}
