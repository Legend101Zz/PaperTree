'use client';

/**
 * The 07d offer, as information only: a crafted figure is the slow, optional sequel to a quick
 * plate, and the job that would build it is not part of v0.2 (#217). So the card says that one may
 * come later and is not available yet, promising nothing, and offers only "Not now" (no "Queue the
 * job" button that would do nothing). Not now is remembered for the plate in this browser (a
 * convenience: without storage the offer simply comes back).
 */
import { useState, type ReactNode } from 'react';

/** Props for `CraftedOffer`. */
export interface CraftedOfferProps {
  /** The plate's title, e.g. "Scaled dot-product attention". */
  readonly title: string;
  /** The plate's message id: Not now is remembered under it; null remembers nothing. */
  readonly plateId: string | null;
}

const KEY = 'papertree/crafted-offer/';

function dismissed(plateId: string | null): boolean {
  if (plateId === null) return false;
  try {
    return window.localStorage.getItem(KEY + plateId) === 'not-now';
  } catch {
    return false;
  }
}

function remember(plateId: string | null): void {
  if (plateId === null) return;
  try {
    window.localStorage.setItem(KEY + plateId, 'not-now');
  } catch {
    /* storage refused: the offer comes back next time, nothing else is lost */
  }
}

/** "Optional · slow": a crafted figure of the plate's idea may come later; Not now hides it. */
export function CraftedOffer({ title, plateId }: CraftedOfferProps): ReactNode {
  const [shown, setShown] = useState(() => !dismissed(plateId));
  if (!shown) return null;
  return (
    <div className="pt-crafted" role="note" aria-label="A crafted figure, not available yet">
      <p className="pt-crafted__kicker">Optional · slow</p>
      <h3 className="pt-crafted__title">A crafted figure of “{title}”</h3>
      <p className="pt-crafted__body">
        A slower, hand-tuned figure you could turn and explore may come later. It is not available
        yet; your quick plate stays as it is.
      </p>
      <button
        type="button"
        className="pt-crafted__dismiss"
        onClick={() => {
          remember(plateId);
          setShown(false);
        }}
      >
        Not now
      </button>
    </div>
  );
}
