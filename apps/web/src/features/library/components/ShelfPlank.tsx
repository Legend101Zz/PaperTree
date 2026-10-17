/**
 * ShelfPlank: the furniture the books stand on (#195, frame 00): a walnut plank with a front lip,
 * a brass bookend at each end, and a brass `LabelHolder` under each row. Decoration only: the
 * holder's name reaches assistive technology through its row's group label, not twice.
 */
import { LabelHolder } from '@papertree/ui';

import type { ReactNode } from 'react';

/** Props for `ShelfPlank`. */
export interface ShelfPlankProps {
  /** The rows of spines, each ending in a `PlankHolder`. */
  readonly children: ReactNode;
}

/**
 * The plank and its bookends around the shelf's rows. The rows scroll sideways between the
 * bookends when they are wider than the page; the plank stays put.
 *
 * @example
 * <ShelfPlank><ShelfRow …/></ShelfPlank>
 */
export function ShelfPlank({ children }: ShelfPlankProps): ReactNode {
  return (
    <div className="pt-plank">
      <span className="pt-plank__wood" aria-hidden="true" />
      <span className="pt-plank__bookend pt-plank__bookend--start" aria-hidden="true" />
      {children}
      <span className="pt-plank__bookend pt-plank__bookend--end" aria-hidden="true" />
    </div>
  );
}

/** Props for `PlankHolder`. */
export interface PlankHolderProps {
  /** The row's name, e.g. "Unshelved" or "Transformers & attention". */
  readonly name: string;
  readonly count: number;
}

/**
 * The brass holder that sits on the plank's front under its row.
 *
 * @example
 * <PlankHolder name="Unshelved" count={4} />
 */
export function PlankHolder({ name, count }: PlankHolderProps): ReactNode {
  return (
    <span className="pt-plank__holder" aria-hidden="true">
      <LabelHolder name={name} count={count} />
    </span>
  );
}
