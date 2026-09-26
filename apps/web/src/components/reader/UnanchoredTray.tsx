'use client';

/**
 * reader/UnanchoredTray — highlights that cannot be drawn on the page, SHOWN, never dropped.
 *
 * A FAILED ANCHOR IS NEVER DELETED. It is shown with its quote and a reason. That is the product
 * decision Hypothesis made in 2017 after dropping annotations that no longer resolved turned out to
 * mean a user's work disappearing with no notice. `resolveAnchor` encodes it at the bottom of the
 * ladder (T6 is a real answer with the quote intact), and this tray is where it reaches the reader.
 *
 * WHAT GOES IN IT (contracts.md §6): an anchor whose stored quads are unusable — made on another
 * PDF (`doc.pdfSha256` differs) or stored without any — AND for which the ladder found nothing.
 * Such an anchor is painted NOWHERE, least of all on whatever text now sits where it used to be.
 * `SourcePane.paintItemsOf` decides "painted or not" with the same `sourcePaint`, so every anchor
 * is either on the page or in this tray, never neither.
 *
 * EACH ROW CARRIES the stored quote, the reason as a sentence a reader can act on, and a page jump
 * when a page survived. Deleting is offered, and only ever by the reader's own hand.
 */

import { useMemo, useState } from 'react';

import type { Anchor, AnchorFailureReason, PageSelector, Resolution } from '@papertree/anchoring';

import { displayQuote } from './quote';

/** Every reason code, as something a reader can act on. The union is closed; this is exhaustive. */
const REASON_TEXT: Record<AnchorFailureReason, string> = {
  block_id_missing:
    'The paragraph it was attached to is not in the current reading of the paper — it was probably merged into another one or split apart.',
  block_text_changed:
    'The paragraph is still there, but its text changed since you highlighted it, so it is not claimed to be the same passage.',
  quote_below_threshold:
    'The quoted text was searched for across the whole paper, and the closest match was not close enough to trust.',
  quote_too_short_no_context:
    'The highlighted text was too short to find on its own, and the surrounding words did not survive.',
  no_geometric_overlap: 'Nothing in the current reading overlaps the place on the page where it was drawn.',
  section_not_found: 'The section it was in is not in the current reading.',
  page_out_of_range: 'That page is not in this document.',
  no_selectors: 'It was stored without anything to search for, so it cannot be placed.',
};

export interface UnanchoredTrayItem {
  readonly anchor: Anchor;
  readonly resolution: Resolution;
  readonly highlightId?: string;
  /**
   * How many OTHER passages of the same highlight are still painted. Delete removes the whole
   * highlight (a highlight's anchors are one record, §2.4), so the button says so when there are.
   */
  readonly placedElsewhere?: number;
}

export interface UnanchoredTrayProps {
  /** Every anchor that is painted nowhere. */
  readonly items: readonly UnanchoredTrayItem[];
  /** The paper's `source_hash`, to say when an anchor was made on a different PDF. */
  readonly sourceHash?: string;
  readonly onJumpToPage: (pageIndex: number, anchorId: string) => void;
  /** A reader-initiated delete. NEVER called from a failed resolution. */
  readonly onForget?: (anchorId: string) => void;
  readonly className?: string;
}

function quoteOf(anchor: Anchor): string {
  return displayQuote([anchor]);
}

function pageOf(item: UnanchoredTrayItem): number | null {
  if (item.resolution.pageIndex !== null) return item.resolution.pageIndex;
  const page = item.anchor.selectors.find(
    (selector): selector is PageSelector => selector.type === 'PageSelector',
  );
  return page?.index ?? null;
}

function explanation(item: UnanchoredTrayItem, sourceHash: string | undefined): string {
  if (sourceHash !== undefined && item.anchor.doc.pdfSha256 !== sourceHash) {
    // The stored shape belongs to other bytes, so the geometric tiers do not apply here at all;
    // naming a geometric reason after this sentence would contradict it.
    return quoteOf(item.anchor) === ''
      ? 'It was made on a different PDF file, so where it was drawn cannot be used here, and it carries no quote to search this one for.'
      : 'It was made on a different PDF file, so where it was drawn cannot be used here, and its words could not be found in this one.';
  }
  const parts: string[] = [];
  const reason = item.resolution.reason;
  if (reason !== undefined) parts.push(REASON_TEXT[reason]);
  else if (item.resolution.state !== 'orphan') {
    parts.push('It was found in the text, but there is no shape on the page to draw it with.');
  } else parts.push('It could not be placed, and no reason was recorded.');
  return parts.join(' ');
}

function Row({
  item,
  sourceHash,
  onJumpToPage,
  onForget,
}: {
  readonly item: UnanchoredTrayItem;
  readonly sourceHash: string | undefined;
  readonly onJumpToPage: UnanchoredTrayProps['onJumpToPage'];
  readonly onForget: UnanchoredTrayProps['onForget'];
}): JSX.Element {
  const quote = quoteOf(item.anchor);
  const pageIndex = pageOf(item);
  const placedElsewhere = item.placedElsewhere ?? 0;
  return (
    <li
      className="mx-auto max-w-[44rem] border-b border-[--pt-rule] px-4 py-3 last:border-b-0"
      data-anchor-id={item.anchor.id}
      data-state={item.resolution.state}
      data-reason={item.resolution.reason ?? ''}
    >
      <blockquote className="pt-paper m-0 mb-2 text-[0.9375rem]">
        {quote === '' ? (
          <span className="text-[--pt-ink-muted]">No quote was stored with this highlight.</span>
        ) : (
          `“${quote}”`
        )}
      </blockquote>
      <p className="m-0 mb-2 text-[0.8125rem] leading-relaxed text-[--pt-ink-muted]">
        {explanation(item, sourceHash)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {pageIndex === null ? null : (
          <button
            type="button"
            className="pt-btn pt-btn--outline"
            onClick={() => onJumpToPage(pageIndex, item.anchor.id)}
          >
            Go to page {pageIndex + 1}
          </button>
        )}
        {onForget === undefined ? null : (
          <button
            type="button"
            className="pt-btn pt-btn--danger"
            onClick={() => onForget(item.anchor.id)}
          >
            {placedElsewhere > 0 ? 'Delete the whole highlight' : 'Delete highlight'}
          </button>
        )}
      </div>
      {placedElsewhere > 0 && onForget !== undefined ? (
        <p className="m-0 mt-2 text-[0.8125rem] leading-relaxed text-[--pt-ink-muted]">
          {placedElsewhere === 1
            ? 'The rest of this highlight is still on the page; deleting removes it too.'
            : `The other ${String(placedElsewhere)} passages of this highlight are still on the page; deleting removes them too.`}
        </p>
      ) : null}
    </li>
  );
}

export function UnanchoredTray({
  items,
  sourceHash,
  onJumpToPage,
  onForget,
  className,
}: UnanchoredTrayProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const count = items.length;
  const summary = useMemo(
    () =>
      // Counted in PASSAGES (anchors): one highlight can hold several, and only some may be lost.
      count === 1
        ? '1 highlighted passage could not be placed on the page'
        : `${String(count)} highlighted passages could not be placed on the page`,
    [count],
  );
  if (count === 0) return null;
  return (
    <section
      className={`pt-tray pt-unanchored-tray ${className ?? ''}`}
      aria-label="Highlights that could not be placed"
    >
      <button
        type="button"
        className="pt-tray__bar"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 shrink-0 rounded-full bg-[--pt-danger]"
        />
        <span className="flex-1">{summary}</span>
        <span className="text-[--pt-ink-muted]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <ul className="pt-tray__body m-0 list-none p-0">
          {items.map((item) => (
            <Row
              key={item.anchor.id}
              item={item}
              sourceHash={sourceHash}
              onJumpToPage={onJumpToPage}
              onForget={onForget}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
