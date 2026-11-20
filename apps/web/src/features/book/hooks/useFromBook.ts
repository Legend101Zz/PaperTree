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
 * @param target - `abstract` flashes it; `summary` opens the summary; `{ page }` opens at that page
 *   (1-based: the page a block of the "At a glance" sheet cites, or 1 for "from the start").
 * @returns A path such as `/paper/ppr_1/read?from=book&at=abstract` or `…?from=book&page=3`.
 */
export function bookReaderHref(
  paperId: string,
  target?: 'abstract' | 'summary' | { readonly page: number },
): string {
  const base = `/paper/${encodeURIComponent(paperId)}/read`;
  if (target === undefined) return base;
  if (typeof target === 'object') return `${base}?from=book&page=${String(target.page)}`;
  const query = target === 'abstract' ? 'from=book&at=abstract' : 'from=book&open=summary';
  return `${base}?${query}`;
}

/**
 * The 1-based page `?page=` names, or null when the address has none or it is not a page number.
 *
 * @param value - The query value.
 * @returns A whole number of at least 1, else null.
 */
export function pageFromQuery(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^[1-9][0-9]{0,5}$/.test(value)) return null;
  return Number(value);
}

/**
 * Takes the book's own query off the address once its action has run, so a reload neither flashes
 * the abstract again nor reopens the summary (review nit). Other parameters are kept; the history
 * entry is replaced, not added.
 */
function dropBookParams(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const key of ['from', 'at', 'open', 'page']) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
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
        timer = setTimeout(() => {
          latest.current(anchor);
          // Only now: dropping the query changes `wanted`, whose cleanup would cancel this.
          dropBookParams();
        }, FOCUS_SETTLE_MS);
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
    dropBookParams();
    latest.current();
  }, [wanted, paperId]);
}

/**
 * Opens the reader at a page when it was opened from the book: a block of the "At a glance" sheet
 * (`p. 3 ›`) or "from the start" (page 1). Once the parse is loaded, jumps there; runs once per
 * paper and page.
 *
 * @param paperId - The paper open in the reader (null for a sample).
 * @param ready - True once the parse is loaded and `jumpToPage` can scroll.
 * @param jumpToPage - The reader's jump, by ZERO-based page index.
 */
export function usePageFromBook(
  paperId: string | null,
  ready: boolean,
  jumpToPage: (pageIndex: number) => void,
): void {
  const params = useSearchParams();
  const page = params?.get('from') === 'book' ? pageFromQuery(params.get('page')) : null;
  const done = useRef<string | null>(null);
  const latest = useRef(jumpToPage);
  latest.current = jumpToPage;
  useEffect(() => {
    if (
      page === null ||
      paperId === null ||
      !ready ||
      done.current === `${paperId}:${String(page)}`
    )
      return undefined;
    done.current = `${paperId}:${String(page)}`;
    const timer = setTimeout(() => {
      latest.current(page - 1);
      dropBookParams();
    }, FOCUS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [page, paperId, ready]);
}
