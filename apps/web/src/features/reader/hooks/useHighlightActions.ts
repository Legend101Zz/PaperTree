import { useCallback, useRef, useState } from 'react';

import type { Anchor } from '@papertree/anchoring';
import type { UseHighlights } from '@/components/reader/useHighlights';
import type { SelectionCapture } from '@/components/reader/useSelectionCapture';
import type { HighlightColor } from '@/lib/api/types';

/** Where a highlight's card opens from: the click, and the passage's top and bottom, client px. */
export type CardAt = {
  readonly clientX: number;
  readonly clientY: number;
  readonly top?: number;
  readonly bottom?: number;
};

/** The open highlight card: whose it is, where from, and whether the note field has focus. */
export interface OpenCard {
  readonly highlightId: string;
  readonly at: CardAt | null;
  readonly focusNote?: boolean;
}

/**
 * What the selection menu's Highlight and Note do, and which highlight's card is open. Owns the
 * "last colour picked" memory so a Note made from the menu uses the wash the reader chose last.
 * @param highlights The highlights controller.
 * @returns The open card and the selection menu's highlight and note actions.
 */
export function useHighlightActions(highlights: UseHighlights) {
  const [card, setCard] = useState<OpenCard | null>(null);

  /** The colour a new highlight gets: the wash pressed, else the last one picked (amber at first). */
  const lastColor = useRef<HighlightColor>('amber');
  const rememberColor = useCallback((color: HighlightColor) => {
    lastColor.current = color;
  }, []);

  /** Highlight these anchors in the colour pressed (words, or a picture's region, #348). */
  const onCreateAnchors = useCallback(
    (anchors: readonly Anchor[], color?: HighlightColor) => {
      if (color !== undefined) lastColor.current = color;
      void highlights.create(anchors, lastColor.current);
    },
    [highlights],
  );
  const onCreateHighlight = useCallback(
    (captured: SelectionCapture, color?: HighlightColor) =>
      onCreateAnchors(captured.anchors, color),
    [onCreateAnchors],
  );

  /** The selection menu's Note: a highlight, with its card open on the note field. */
  const onNoteAnchors = useCallback(
    async (anchors: readonly Anchor[], at: CardAt | null) => {
      const made = await highlights.create(anchors, lastColor.current);
      if (made !== null) setCard({ highlightId: made.highlightId, at, focusNote: true });
    },
    [highlights],
  );
  const onCreateNote = useCallback(
    (captured: SelectionCapture, at: CardAt | null) => onNoteAnchors(captured.anchors, at),
    [onNoteAnchors],
  );

  const onActivateHighlight = useCallback(
    (highlightId: string, at: CardAt | null) => setCard({ highlightId, at }),
    [],
  );

  return {
    card,
    closeCard: useCallback(() => setCard(null), []),
    rememberColor,
    onCreateAnchors,
    onCreateHighlight,
    onNoteAnchors,
    onCreateNote,
    onActivateHighlight,
  };
}
