/**
 * LibraryTitle: "Your library" with its stats line and the one alert, "N need a look" (#195,
 * frame 01), then the view tabs and Arrange by. Only the Shelf view exists in this release so far;
 * Topics, Map and Table are shown, disabled, and say "Coming in this release" (S2f, S2g).
 */
'use client';

import { ToolbarButton } from '@papertree/ui';
import { ChevronDown, LayoutGrid, Library, Network, Table2 } from 'lucide-react';
import { useId } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { useTouchTargets } from '../hooks/useTouchTargets';
import { ARRANGEMENTS, type Arrangement, type LibraryStats } from '../model/shelf';
import { statsLine } from '../model/states';

import type { ReactNode } from 'react';

/** Props for `LibraryTitle`. */
export interface LibraryTitleProps {
  /** The counts, or null while the library has not loaded (no number is shown until then). */
  readonly stats: LibraryStats | null;
  /** The shelf is laid out in rows (a library at scale): the stats line drops the pages. */
  readonly atScale?: boolean;
  /** The "need a look" filter is on. */
  readonly needALookOnly: boolean;
  readonly onNeedALook: (on: boolean) => void;
  readonly arrangement: Arrangement;
  readonly onArrange: (next: Arrangement) => void;
}

const VIEWS = [
  { label: 'Topics', icon: <LayoutGrid size={20} strokeWidth={1.5} /> },
  { label: 'Map', icon: <Network size={20} strokeWidth={1.5} /> },
  { label: 'Table', icon: <Table2 size={20} strokeWidth={1.5} /> },
] as const;

/**
 * The title block and the view row.
 *
 * @example
 * <LibraryTitle stats={libraryStats(books)} needALookOnly={false} onNeedALook={set} arrangement="topic" onArrange={setA} />
 */
export function LibraryTitle({
  stats,
  atScale = false,
  needALookOnly,
  onNeedALook,
  arrangement,
  onArrange,
}: LibraryTitleProps): ReactNode {
  const soonId = useId();
  const arrangeId = useId();
  const touch = useTouchTargets();
  const size = touch ? 'touch' : 'md';
  const target = touch ? TOUCH_TARGET : undefined;
  return (
    <>
      <div className="pt-libtitle">
        <h1 className="pt-libtitle__h1">Your library</h1>
        {stats === null ? null : stats.papers === 0 ? (
          // Frame 01b: an empty library says so in the stats slot rather than "0 papers".
          <p className="pt-libtitle__stats">No papers yet</p>
        ) : (
          <p className="pt-libtitle__stats">
            {statsLine(stats, atScale).map(([count, noun], index) => (
              <span key={noun}>
                {index === 0 ? null : (
                  <span className="pt-libtitle__sep" aria-hidden="true">
                    {' · '}
                  </span>
                )}
                <b>{count}</b> {noun}
              </span>
            ))}
          </p>
        )}
        {stats !== null && stats.needALook > 0 ? (
          // Filters the shelf to those papers for now; it will open the Table, filtered, in S2f.
          <button
            type="button"
            className={['pt-libtitle__alert', target].filter(Boolean).join(' ')}
            aria-pressed={needALookOnly}
            onClick={() => onNeedALook(!needALookOnly)}
          >
            <span className="pt-libtitle__dot" aria-hidden="true" />
            {stats.needALook} need a look
          </button>
        ) : null}
      </div>
      <div className="pt-libviews">
        <div role="group" aria-label="View" className="pt-libviews__tabs">
          <ToolbarButton
            label="Shelf"
            icon={<Library size={20} strokeWidth={1.5} />}
            pressed
            size={size}
            className={target}
          />
          {VIEWS.map((view) => (
            <ToolbarButton
              key={view.label}
              size={size}
              className={target}
              label={view.label}
              icon={view.icon}
              pressed={false}
              disabled
              title="Coming in this release"
              aria-describedby={soonId}
            />
          ))}
          <span id={soonId} className="pt-sr-only">
            Coming in this release
          </span>
        </div>
        {/* Nothing to arrange on an empty shelf (01b keeps the view tabs, not Arrange by). */}
        {stats !== null && stats.papers === 0 ? null : (
          <label className="pt-libviews__arrange" htmlFor={arrangeId}>
            Arrange by
            <span className="pt-libviews__select">
              <select
                id={arrangeId}
                className={target}
                value={arrangement}
                onChange={(event) => onArrange(event.target.value as Arrangement)}
              >
                {ARRANGEMENTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </label>
        )}
      </div>
    </>
  );
}
