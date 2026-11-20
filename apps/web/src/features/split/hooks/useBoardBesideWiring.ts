import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBoardBeside } from './useBoardBeside';

import type { PaperRef } from '@/lib/paperSource';

/**
 * What the reader workspace needs to host "Board beside" (#344), wired in one place: the split
 * controller, the pages on screen (for the faint amber edge on the board's cards), the selection
 * menu's "open the board on this card", and `?beside=1` opening the split on arrival.
 * @param paper The paper, referentially stable.
 * @returns The controller, the visible pages and the menu's open-board action.
 */
export function useBoardBesideWiring(paper: PaperRef) {
  // A window with no room for two panes opens the full-width board instead, on the same card.
  const boardPath =
    paper.kind === 'api' ? `/paper/${encodeURIComponent(paper.paperId)}/board` : null;
  const beside = useBoardBeside(
    useCallback(
      (cardId: string | null) => {
        if (boardPath === null) return;
        const to = cardId === null ? boardPath : `${boardPath}?card=${encodeURIComponent(cardId)}`;
        window.location.assign(to);
      },
      [boardPath],
    ),
  );

  // As a set that changes only when the pages do, so the board does not redraw on every scroll.
  const [visiblePages, setVisiblePages] = useState<ReadonlySet<number>>(() => new Set());
  const onVisiblePages = useCallback((pages: readonly number[]) => {
    setVisiblePages((was) =>
      was.size === pages.length && pages.every((p) => was.has(p)) ? was : new Set(pages),
    );
  }, []);

  // `?beside=1` (a source click on the full-width board, B there) opens the split on arrival; the
  // board reads `?card=` itself and keeps that card on screen.
  const wantsBeside = useSearchParams()?.get('beside') === '1';
  const openedFromUrl = useRef(false);
  const openBeside = beside.openBeside;
  useEffect(() => {
    if (!wantsBeside || openedFromUrl.current || boardPath === null) return;
    openedFromUrl.current = true;
    openBeside();
  }, [wantsBeside, boardPath, openBeside]);

  // The selection menu's Board beside: the card is sent, then the board opens beside the paper on it.
  const onOpenBoard = useMemo(
    () => (boardPath === null ? undefined : (cardId: string | null) => beside.openOn(cardId)),
    [boardPath, beside],
  );

  return { beside, visiblePages, onVisiblePages, onOpenBoard };
}
