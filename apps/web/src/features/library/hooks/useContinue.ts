/**
 * useContinue: Continue opens the reader at the page the server has for you (#196). The reader
 * restores its place from `papertree/reader/<paper_id>` (contracts.md §5), so Continue writes the
 * server's page there first (`planContinue`) and then opens the paper: a place read on another
 * device is honoured, a place already on that page keeps its exact line, and a later place here
 * (a write the server never got) is kept and sent again.
 */
'use client';

import { useCallback } from 'react';

import { papersApi } from '@/lib/api/papers';
import { readerStorageKey, resolvePaperRef } from '@/lib/paperSource';

import { planContinue } from '../model/states';

import type { ShelfPaper } from '../model/shelf';

/**
 * Prepares the reader for Continue: stores the server's page as the reader's place, or keeps a
 * later place this browser holds and sends it to the server again. Storage that is blocked costs
 * the exact place: the reader then opens at its own default.
 *
 * @param paperId - The paper.
 * @param lastPage - The server's zero-based page.
 */
function prepareContinue(paperId: string, lastPage: number): void {
  const key = readerStorageKey(resolvePaperRef(paperId));
  try {
    const raw = window.localStorage.getItem(key);
    let saved: unknown = null;
    try {
      saved = raw === null ? null : JSON.parse(raw);
    } catch {
      saved = null; // a corrupt entry is replaced, as the reader would ignore it
    }
    const plan = planContinue(saved, lastPage, window.innerWidth < 768);
    if (plan.store !== null) window.localStorage.setItem(key, JSON.stringify(plan.store));
    if (plan.resend !== null) {
      // Best effort, as the reader's own writes are; the reader writes again once it shows the page.
      papersApi.putReadingState(paperId, plan.resend.page, plan.resend.mode).catch(() => undefined);
    }
  } catch {
    // Private mode or full storage: the reader opens where it can, never a crash.
  }
}

/**
 * The Continue action for a paper with a reading place.
 *
 * @param open - Opens the reader for a paper id (the library's Read).
 * @returns Continue for a paper: stores its place, then opens it.
 * @example
 * const resume = useContinue(read);
 * <ReadingNowRow onContinue={() => resume(book)} … />
 */
export function useContinue(open: (paperId: string) => void): (paper: ShelfPaper) => void {
  return useCallback(
    (paper: ShelfPaper) => {
      const page = paper.reading?.last_page;
      if (typeof page === 'number') prepareContinue(paper.id, page);
      open(paper.id);
    },
    [open],
  );
}
