/**
 * useFromBook — the reader's half of the opened book's two links (#200). The abstract's
 * "p. 1 · Abstract" tab goes to `/paper/<id>/read?from=book&at=abstract`: once the parse is loaded
 * the reader asks for the abstract's Anchor (`GET /papers/{id}/abstract`, a URL cannot carry one)
 * and flashes it, as the notebook's "Show in paper" does. Summary goes to `…?from=book&open=summary`
 * and opens the explain panel on the summary (the cached one when there is one). Each runs once
 * per link; a paper without an abstract simply opens.
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { FOCUS_SETTLE_MS } from '@/components/canvas/useFocusFromCanvas';

import { bookApi } from '../api/bookApi';

import type { Anchor } from '@papertree/anchoring';

/**
 * The reader's URL from the book, optionally aimed at the abstract or the summary.
 *
 * @param paperId - The paper.
 * @param target - `abstract` flashes it; `summary` opens the summary.
 * @returns A path such as `/paper/ppr_1/read?from=book&at=abstract`.
 */
export function bookReaderHref(paperId: string, target?: 'abstract' | 'summary'): string {
  const base = `/paper/${encodeURIComponent(paperId)}/read`;
  if (target === undefined) return base;
  const query = target === 'abstract' ? 'from=book&at=abstract' : 'from=book&open=summary';
  return `${base}?${query}`;
}

/**
 * Flashes the abstract when the reader was opened from its tab.
 *
 * @param paperId - The paper open in the reader (null for a sample).
 * @param ready - True once the parse is loaded and `focusAnchor` can resolve.
 * @param focusAnchor - The reader's resolve-scroll-flash.
 */
export function useFocusFromBook(
  paperId: string | null,
  ready: boolean,
  focusAnchor: (anchor: Anchor, opts?: { flash?: boolean }) => void,
): void {
  const params = useSearchParams();
  const wanted = params?.get('from') === 'book' && params.get('at') === 'abstract';
  const done = useRef<string | null>(null);
  const latest = useRef(focusAnchor);
  latest.current = focusAnchor;
  useEffect(() => {
    if (!wanted || paperId === null || !ready || done.current === paperId) return undefined;
    done.current = paperId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    bookApi.abstract(paperId).then(
      (found) => {
        const anchor = found.anchor;
        if (cancelled || anchor === null) return;
        timer = setTimeout(() => latest.current(anchor), FOCUS_SETTLE_MS);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [wanted, paperId, ready]);
}

/**
 * Opens the summary when the reader was opened from the book's Summary.
 *
 * @param paperId - The paper (null for a sample: no summary to ask for).
 * @param openSummary - Opens the explain panel on the summary.
 */
export function useSummaryFromBook(paperId: string | null, openSummary: () => void): void {
  const params = useSearchParams();
  const wanted = params?.get('from') === 'book' && params.get('open') === 'summary';
  const done = useRef<string | null>(null);
  const latest = useRef(openSummary);
  latest.current = openSummary;
  useEffect(() => {
    if (!wanted || paperId === null || done.current === paperId) return;
    done.current = paperId;
    latest.current();
  }, [wanted, paperId]);
}
