import { useMemo } from 'react';

import { sendToCanvas } from '@/components/canvas/sendToCanvas';

import { draggedPassage, setDraggedPassage } from '../model/passageDrag';

import type { BoardBeside } from './useBoardBeside';

/**
 * The board's `dragIn` seam: a selection dragged across the divider lands as a card at the drop
 * point, and glows. A passage already on the board is moved to the drop point (when it has no tree
 * yet) and the view stays; otherwise the board pans to it and glows it.
 * @param paperId The paper being read, or null for a sample.
 * @param arriveAt Land a card on the board.
 * @param onNotice Said when an action fails.
 * @returns The `dragIn` object the board takes.
 */
export function useDragIn(
  paperId: string | null,
  arriveAt: BoardBeside['arriveAt'],
  onNotice: (message: string) => void,
) {
  return useMemo(
    () => ({
      current: () => draggedPassage(),
      drop: (at: { readonly x: number; readonly y: number }) => {
        const passage = draggedPassage();
        if (passage === null) return;
        setDraggedPassage(null);
        let landed: 'added' | 'moved' | 'existing' = 'added';
        sendToCanvas(paperId, {
          kind: 'excerpt',
          anchor: passage.anchor,
          // A picture has no words to quote: its caption is the card's body (#348).
          ...(passage.image === true ? { body: passage.text } : {}),
          toast: 'none',
          at,
          onOutcome: (outcome) => (landed = outcome),
        })
          .then((cardId) => {
            if (cardId !== null) arriveAt(cardId, landed === 'existing');
          })
          .catch(() => onNotice("Couldn't send this passage to the board. Try again."));
      },
    }),
    [paperId, arriveAt, onNotice],
  );
}
