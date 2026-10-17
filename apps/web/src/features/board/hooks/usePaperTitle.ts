'use client';

/**
 * board/hooks/usePaperTitle — the paper's title for the board's header ("Board *Attention Is All You
 * Need*"). Read once per paper (`GET /papers/{id}`), never polled; a failed read leaves the header
 * saying "Board" alone rather than guessing a title.
 */
import { useEffect, useState } from 'react';

import { request } from '@/lib/api/client';

import type { LibraryPaper } from '@/lib/api/types';

/**
 * The title of the board's paper.
 *
 * @param paperId The paper.
 * @returns Its title, or null until read (or when the read failed).
 */
export function usePaperTitle(paperId: string): string | null {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    request<LibraryPaper>(`/papers/${encodeURIComponent(paperId)}`)
      .then((paper) => {
        if (alive) setTitle(paper.title.trim() === '' ? null : paper.title);
      })
      .catch(() => {
        // The header says "Board" alone; the board itself does not depend on the title.
      });
    return () => {
      alive = false;
    };
  }, [paperId]);
  return title;
}
