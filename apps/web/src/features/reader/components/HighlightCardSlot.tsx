import { HighlightCard } from '@/components/reader/HighlightCard';

import type { UseHighlights } from '@/components/reader/useHighlights';
import type { HighlightColor } from '@/lib/api/types';
import type { OpenCard } from '../hooks/useHighlightActions';

/** The open highlight's card, looked up live so an edit or a delete is never shown stale. */
export function HighlightCardSlot({
  highlights,
  card,
  onClose,
  onColor,
}: {
  readonly highlights: UseHighlights;
  readonly card: OpenCard;
  readonly onClose: () => void;
  readonly onColor: (color: HighlightColor) => void;
}) {
  const highlight = highlights.highlights.find((h) => h.highlightId === card.highlightId);
  if (highlight === undefined) return null;
  return (
    <HighlightCard
      key={highlight.highlightId}
      highlight={highlight}
      at={card.at}
      focusNote={card.focusNote === true}
      onColor={(color) => {
        onColor(color);
        void highlights.update(highlight.highlightId, { color });
      }}
      onNote={(note) => void highlights.update(highlight.highlightId, { note })}
      onDelete={() => {
        onClose();
        void highlights.remove(highlight.highlightId);
      }}
      onRetry={() => void highlights.retry(highlight.highlightId)}
      onClose={onClose}
    />
  );
}
