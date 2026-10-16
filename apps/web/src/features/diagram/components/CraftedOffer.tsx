'use client';

/**
 * The 07d offer, as information only: a crafted figure is the slow, optional sequel to a quick
 * plate, and the job that would build it is not part of v0.2 (#217). So the card says what it will
 * be and that it is not available yet, and offers only "Not now": no "Queue the job" button that
 * would do nothing.
 */
import { useState, type ReactNode } from 'react';

/** Props for `CraftedOffer`. */
export interface CraftedOfferProps {
  /** The plate's title, e.g. "Scaled dot-product attention". */
  readonly title: string;
}

/** "Optional · slow": a crafted figure of the plate's idea, not available yet; Not now hides it. */
export function CraftedOffer({ title }: CraftedOfferProps): ReactNode {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <div className="pt-crafted" role="note" aria-label="A crafted figure, not available yet">
      <p className="pt-crafted__kicker">Optional · slow</p>
      <h3 className="pt-crafted__title">A crafted figure, later</h3>
      <p className="pt-crafted__body">
        An agent will be able to build a hand-tuned figure of “{title}” that you can turn and
        explore. It will take an hour or more and cost more than a diagram, and you will see the
        estimate before it starts. It is not available yet; your quick plate stays as it is.
      </p>
      <button type="button" className="pt-crafted__dismiss" onClick={() => setShown(false)}>
        Not now
      </button>
    </div>
  );
}
