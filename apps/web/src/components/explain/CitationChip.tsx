'use client';

/**
 * explain/CitationChip — one cited passage, as a button (moved from `inspector/`, R12).
 *
 * KEYED BY `citation_id` (the server's id, stable across a reload), not by the `[bN]` handle the
 * model wrote: a handle is only meaningful inside one run. The chip says what it points at in
 * words ("p. 4") and what the server found when it checked the claim against the passage:
 * `supported === false` reads "not verified" in plain words, so the state is never colour alone.
 */
import type { ReactNode } from 'react';

import type { Citation } from '@/lib/api/types';

export interface CitationChipProps {
  readonly citation: Citation;
  /** Scroll to the passage and flash it. REQUIRED: a chip that does nothing is worse than none. */
  readonly onFocus: (citation: Citation) => void;
}

export function citationPageLabel(citation: Citation): string {
  return `p. ${String(citation.page_index + 1)}`;
}

export function CitationChip({ citation, onFocus }: CitationChipProps): ReactNode {
  const unverified = citation.supported === false;
  const page = citationPageLabel(citation);
  return (
    <button
      type="button"
      className="pt-chip"
      data-citation-id={citation.citation_id}
      data-supported={citation.supported === null ? 'unknown' : String(citation.supported)}
      aria-label={`Show the passage on ${page}${unverified ? ' (not verified)' : ''}`}
      title={
        unverified
          ? 'The cited passage does not clearly support this claim'
          : `Show the passage on ${page}`
      }
      onClick={() => onFocus(citation)}
    >
      <span className="pt-chip__page">{page}</span>
      {unverified ? <span className="pt-chip__flag">not verified</span> : null}
    </button>
  );
}
