'use client';

/**
 * reader/UnanchoredTray — the orphans tab, sixteen years after Hypothesis shipped theirs.
 *
 * A FAILED ANCHOR IS NEVER DELETED. It is SHOWN. That is not a nicety; it is the product decision
 * Hypothesis made in 2017 after the alternative — dropping annotations that no longer resolved —
 * turned out to mean a user's year of work disappearing with no notice and no recourse. The
 * anchoring package encodes the same decision at the bottom of the ladder: `resolveAnchor` never
 * returns null and never throws for a document that no longer contains the anchor. T6 is a REAL
 * answer, with `state: 'orphan'`, the stored quote intact and a page-level jump still available.
 * This component is where that answer reaches the user, and without it the guarantee is theoretical.
 *
 * WHAT EACH ROW MUST CARRY, per `reparse.spec`'s "every failure is visible":
 *
 *   1. the STORED QUOTE — `TextQuoteSelector.exact`, raw, because that is what the user chose and
 *      they should recognise it;
 *   2. the REASON, as a sentence rather than a code. `AnchorFailureReason` is deliberately a closed
 *      union so this map is exhaustive: a reason that only ever reaches a log satisfies nothing;
 *   3. a PAGE-LEVEL JUMP. Losing the exact region does not mean losing the page — `PageSelector`
 *      survives every tier, so "we cannot show you where, but we can show you which page" is almost
 *      always true and is far more use than an apology.
 *
 * Approximate anchors are listed too, in their own group. They are not failures — T4 and T5 are
 * legitimate answers — but "we placed this by geometry, not by text" is a different claim from
 * "this is the paragraph you highlighted", and §19 forbids presenting the two identically.
 */

import { useMemo } from 'react';

import type {
  Anchor,
  AnchorFailureReason,
  PageSelector,
  Resolution,
  TextQuoteSelector,
} from '@papertree/anchoring';

/** Every reason code, as something a reader can act on. The union is closed; this is exhaustive. */
const REASON_TEXT: Record<AnchorFailureReason, string> = {
  block_id_missing:
    'The paragraph this was attached to is not in the current parse of the paper — it was probably merged into another one or split apart.',
  block_text_changed:
    'The paragraph is still there, but its text has changed since you highlighted it, so we will not claim this is the same passage.',
  quote_below_threshold:
    'We searched the whole paper for the quoted text and the closest match was not close enough to trust.',
  quote_too_short_no_context:
    'The highlighted text was too short to identify on its own, and the surrounding context did not survive.',
  no_geometric_overlap:
    'Nothing in the current parse overlaps the region on the page where this was drawn.',
  section_not_found: 'The section this was in no longer exists in the current parse.',
  page_out_of_range: 'That page is not in this document any more.',
  no_selectors:
    'This record was stored without any selectors, so there is nothing to search for. It cannot be recovered.',
};

const APPROXIMATE_TEXT =
  'Placed approximately. We found this by geometry or by section rather than by matching the text, so the position is close but may not be exact.';

export interface UnanchoredTrayItem {
  readonly anchor: Anchor;
  readonly resolution: Resolution;
}

export interface UnanchoredTrayProps {
  /** Pass everything; the tray does its own filtering so nothing can be dropped before it gets here. */
  readonly items: readonly UnanchoredTrayItem[];
  readonly onJumpToPage: (pageIndex: number, anchorId: string) => void;
  /** Optional: a user-initiated delete. NEVER call this from a failed resolution — see the header. */
  readonly onForget?: (anchorId: string) => void;
  readonly onDismiss?: () => void;
  readonly className?: string;
}

function quoteOf(anchor: Anchor): string {
  const quote = anchor.selectors.find(
    (selector): selector is TextQuoteSelector => selector.type === 'TextQuoteSelector',
  );
  return quote?.exact ?? '';
}

/**
 * The page to jump to.
 *
 * The resolution's own page first — a tier that placed the anchor knows better than the capture
 * record. `PageSelector` next, because it survives even when every text tier has failed, and it is
 * the reason an orphan is still navigable at all.
 */
function pageOf(item: UnanchoredTrayItem): number | null {
  if (item.resolution.pageIndex !== null) return item.resolution.pageIndex;
  const page = item.anchor.selectors.find(
    (selector): selector is PageSelector => selector.type === 'PageSelector',
  );
  return page?.index ?? null;
}

function Row({
  item,
  onJumpToPage,
  onForget,
}: {
  readonly item: UnanchoredTrayItem;
  readonly onJumpToPage: UnanchoredTrayProps['onJumpToPage'];
  readonly onForget: UnanchoredTrayProps['onForget'];
}): JSX.Element {
  const quote = quoteOf(item.anchor);
  const pageIndex = pageOf(item);
  const reason = item.resolution.reason;
  const explanation =
    reason !== undefined
      ? REASON_TEXT[reason]
      : item.resolution.state === 'approximate'
        ? APPROXIMATE_TEXT
        : 'This anchor did not resolve, and the resolver did not record a reason. That is a bug — please report it.';

  return (
    <li
      className="border-b border-stone-200 px-3 py-3 last:border-b-0"
      data-anchor-id={item.anchor.id}
      data-state={item.resolution.state}
    >
      <blockquote className="mb-2 border-l-2 border-stone-300 pl-3 text-sm italic text-stone-700">
        {quote === '' ? (
          <span className="not-italic text-stone-500">
            (no quote was stored — this was a whole-block or figure target)
          </span>
        ) : (
          `“${quote}”`
        )}
      </blockquote>

      <p className="mb-2 text-xs leading-relaxed text-stone-600">{explanation}</p>

      <div className="flex flex-wrap items-center gap-2">
        {pageIndex === null ? (
          <span className="text-xs text-stone-500">No page survived — nowhere to jump to.</span>
        ) : (
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center rounded-lg border border-stone-300 px-3 text-sm text-stone-800 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
            style={{ touchAction: 'manipulation' }}
            aria-label={`Go to page ${String(pageIndex + 1)}`}
            onPointerUp={() => onJumpToPage(pageIndex, item.anchor.id)}
            onClick={(event) => {
              if (event.detail === 0) onJumpToPage(pageIndex, item.anchor.id);
            }}
          >
            {`Go to page ${String(pageIndex + 1)}`}
          </button>
        )}

        {onForget === undefined ? null : (
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center rounded-lg px-3 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
            style={{ touchAction: 'manipulation' }}
            aria-label="Forget this highlight"
            onPointerUp={() => onForget(item.anchor.id)}
            onClick={(event) => {
              if (event.detail === 0) onForget(item.anchor.id);
            }}
          >
            Forget
          </button>
        )}
      </div>
    </li>
  );
}

export function UnanchoredTray({
  items,
  onJumpToPage,
  onForget,
  onDismiss,
  className,
}: UnanchoredTrayProps): JSX.Element {
  const { orphans, approximate } = useMemo(() => {
    const orphaned: UnanchoredTrayItem[] = [];
    const approximated: UnanchoredTrayItem[] = [];
    for (const item of items) {
      if (item.resolution.state === 'orphan') orphaned.push(item);
      else if (item.resolution.state === 'approximate' || item.resolution.approximate) {
        approximated.push(item);
      }
    }
    return { orphans: orphaned, approximate: approximated };
  }, [items]);

  const total = orphans.length + approximate.length;

  return (
    <section
      className={`pt-unanchored-tray flex h-full flex-col bg-white ${className ?? ''}`}
      aria-label="Highlights that could not be placed"
    >
      <header className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
        <h2 className="text-sm font-medium text-stone-800">
          {`Unanchored (${String(total)})`}
        </h2>
        {onDismiss === undefined ? null : (
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
            style={{ touchAction: 'manipulation' }}
            aria-label="Close the unanchored tray"
            onPointerUp={onDismiss}
            onClick={(event) => {
              if (event.detail === 0) onDismiss();
            }}
          >
            ✕
          </button>
        )}
      </header>

      {total === 0 ? (
        <p className="px-3 py-6 text-sm text-stone-500">
          Every highlight in this paper is anchored to the text it was taken from.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {orphans.length === 0 ? null : (
            <>
              <h3 className="sticky top-0 bg-stone-50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                {`Could not be placed (${String(orphans.length)})`}
              </h3>
              <ul>
                {orphans.map((item) => (
                  <Row
                    key={item.anchor.id}
                    item={item}
                    onJumpToPage={onJumpToPage}
                    onForget={onForget}
                  />
                ))}
              </ul>
            </>
          )}

          {approximate.length === 0 ? null : (
            <>
              <h3 className="sticky top-0 bg-stone-50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                {`Placed approximately (${String(approximate.length)})`}
              </h3>
              <ul>
                {approximate.map((item) => (
                  <Row
                    key={item.anchor.id}
                    item={item}
                    onJumpToPage={onJumpToPage}
                    onForget={onForget}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
