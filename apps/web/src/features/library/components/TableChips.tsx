/**
 * TableChips: the state chips over the Table (#197, frame 01d): All and the four states, each
 * with its count over the papers the search and the Filter leave, so a chip's number is the rows
 * it shows. With "need a look" on, All and that chip (its × goes back to All).
 */
'use client';

import { X } from 'lucide-react';
import { useMemo } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { chipCounts, STATE_CHIPS, type StateChip } from '../model/table';

import type { ShelfPaper } from '../model/shelf';
import type { ReactNode } from 'react';

/** Props for `TableChips`. */
export interface TableChipsProps {
  /** The papers the search and the Filter leave (`tablePool`). */
  readonly counted: readonly ShelfPaper[];
  readonly chip: StateChip;
  readonly onChip: (chip: StateChip) => void;
  /** 44 px targets on touch. */
  readonly touch: boolean;
}

/**
 * The chips row.
 *
 * @example
 * <TableChips counted={pool} chip={table.chip} onChip={table.setChip} touch={false} />
 */
export function TableChips({ counted, chip, onChip, touch }: TableChipsProps): ReactNode {
  const counts = useMemo(() => chipCounts(counted), [counted]);
  // "need a look" shows while something needs one, and while it is pressed (a search can leave 0).
  const shown = STATE_CHIPS.filter((c) =>
    c.id === 'look' ? counts.look > 0 || chip === 'look' : chip !== 'look' || c.id === 'all',
  );
  return (
    <div role="group" aria-label="Show papers" className="pt-libtable__chips">
      {shown.map((c) => {
        const look = c.id === 'look';
        const pressed = chip === c.id;
        return (
          <button
            key={c.id}
            type="button"
            className={['pt-libtable__chip', touch ? TOUCH_TARGET : ''].join(' ')}
            data-look={look || undefined}
            aria-pressed={pressed}
            // Pressing the pressed "need a look" chip (its ×) goes back to All.
            onClick={() => onChip(look && pressed ? 'all' : c.id)}
          >
            {look ? <span className="pt-libtable__dot" aria-hidden="true" /> : null}
            {look ? `${String(counts.look)} ${c.label}` : c.label}
            {look ? null : <span className="pt-libtable__count">{counts[c.id]}</span>}
            {look && pressed ? <X size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
