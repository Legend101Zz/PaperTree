/**
 * useContinue: Continue opens the reader at the page the server has for you (#196). The reader
 * restores its place from `papertree/reader/<paper_id>` (contracts.md §5), so Continue writes the
 * server's page there first (`placeForContinue`) and then opens the paper: a place read on another
 * device is honoured, and a place already on that page keeps its exact line.
 */
'use client';

import { useCallback } from 'react';

import { readerStorageKey, resolvePaperRef } from '@/lib/paperSource';

import { placeForContinue } from '../model/states';

import type { ShelfPaper } from '../model/shelf';

/**
 * Stores the reader place for Continue; storage that is blocked only costs the exact page.
 *
 * @param paperId - The paper.
 * @param lastPage - The server's zero-based page.
 */
function storeContinuePlace(paperId: string, lastPage: number): void {
  const key = readerStorageKey(resolvePaperRef(paperId));
  try {
    const raw = window.localStorage.getItem(key);
    let saved: unknown = null;
    try {
      saved = raw === null ? null : JSON.parse(raw);
    } catch {
      saved = null; // a corrupt entry is replaced, as the reader would ignore it
    }
    const next = placeForContinue(saved, lastPage, window.innerWidth < 768);
    if (next !== null) window.localStorage.setItem(key, JSON.stringify(next));
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
      if (typeof page === 'number') storeContinuePlace(paper.id, page);
      open(paper.id);
    },
    [open],
  );
}
