'use client';

/**
 * A quote card: one passage the answer stands on, clipped to the page as an index card (S5c, #208).
 * Its number is the answer's marker number for that passage; its words are the paper's (Caslon,
 * `data-voice="paper"`); "Open source" and the marker both flash the passage in the paper from the
 * card's STORED Anchor, never from a block id (AGENTS.md §4).
 */
import { Button, NumberedMarker, PageTab, PaperText, formatPageLabel } from '@papertree/ui';
import { FileText } from 'lucide-react';
import { memo } from 'react';

import { dehyphenate } from '@/lib/markdown';

import type { Passage } from '../model/exchange';
import type { QuoteItem } from '../model/page';
import type { ReactNode } from 'react';

/** Props for `QuoteCard`. */
export interface QuoteCardProps {
  readonly item: QuoteItem;
  /** The answer's passage this card shows; null when the answer does not cite it (no number). */
  readonly passage: Passage | null;
  /** A slight tilt in degrees, so a row of cards reads as paper, not a grid. */
  readonly tilt?: number;
  /** True when the notebook search matched this card; it is lit. */
  readonly matched?: boolean;
  /** Scroll the paper to the card's Anchor and flash it. */
  readonly onFocusAnchor: (anchor: QuoteItem['anchor']) => void;
}

function PaperClip(): ReactNode {
  return (
    <svg
      className="pt-nb-quote__clip"
      width="18"
      height="34"
      viewBox="0 0 18 34"
      aria-hidden="true"
    >
      <path
        d="M5 30 V6 a4 4 0 0 1 8 0 V26 a2.5 2.5 0 0 1 -5 0 V9"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** One passage as an index card with its number, tab, citation count and words. */
export const QuoteCard = memo(function QuoteCard(props: QuoteCardProps): ReactNode {
  const { item, passage, tilt = 0, matched = false, onFocusAnchor } = props;
  const focus = (): void => onFocusAnchor(item.anchor);
  const where = passage === null ? null : formatPageLabel(passage.page, passage.para);
  const name = passage === null ? 'Quoted passage' : `Passage ${String(passage.n)}, ${where ?? ''}`;
  return (
    <article
      className="pt-nb-quote"
      aria-label={name}
      data-item-id={item.id}
      data-passage={passage?.n}
      data-match={matched ? 'true' : undefined}
      style={{
        left: item.x,
        top: item.y,
        width: item.w,
        minHeight: item.h,
        zIndex: item.z,
        rotate: `${String(tilt)}deg`,
      }}
    >
      <PaperClip />
      <div className="pt-nb-quote__head">
        {passage === null ? null : (
          <>
            <NumberedMarker
              n={passage.n}
              label={where ?? ''}
              notVerified={passage.supported === false}
              onFlash={focus}
            />
            <PageTab
              page={passage.page}
              para={passage.para}
              status={passage.supported === false ? 'not-verified' : 'cited'}
            />
            {passage.cited > 1 ? (
              <span
                className="pt-nb-quote__count"
                aria-label={`cited ${String(passage.cited)} times`}
              >
                ×{passage.cited}
              </span>
            ) : null}
          </>
        )}
      </div>
      <PaperText as="p" className="pt-paper-quote pt-nb-quote__text">
        {`“${dehyphenate(item.text).replace(/\s+/g, ' ').trim()}”`}
      </PaperText>
      <Button
        className="pt-nb-quote__open"
        // The card's own compact control (frame 05: 28 px); still above the 24 px minimum target.
        style={{ minHeight: 28 }}
        leadingIcon={<FileText size={16} />}
        aria-label={`Open source: show ${passage === null ? 'this passage' : `passage ${String(passage.n)}`} in the paper`}
        onClick={focus}
      >
        Open source
      </Button>
    </article>
  );
});
