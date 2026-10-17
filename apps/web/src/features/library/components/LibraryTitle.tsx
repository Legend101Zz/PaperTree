/**
 * LibraryTitle: "Your library" with its stats line and the one alert, "N need a look" (#195,
 * frame 01), then the view tabs and, for the shelf, Arrange by (the Table puts its Columns menu
 * there instead, frame 01d). Shelf and Table are live (#197); Topics and Map are shown, disabled,
 * and say "Coming in this release" (S2g).
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

/** The library's views that exist so far. */
export type LibraryViewName = 'shelf' | 'table';

/** Props for `LibraryTitle`. */
export interface LibraryTitleProps {
  /** The counts, or null while the library has not loaded (no number is shown until then). */
  readonly stats: LibraryStats | null;
  /** The shelf is laid out in rows (a library at scale): the stats line drops the pages. */
  readonly atScale?: boolean;
  /** The Table is showing, filtered to the papers that need a look. */
  readonly needALookOnly: boolean;
  /** Opens the Table filtered to them (owner default; it filtered the shelf before #197). */
  readonly onNeedALook: (on: boolean) => void;
  readonly view: LibraryViewName;
  readonly onView: (view: LibraryViewName) => void;
  /** What stands at the right of the view row in the Table view (its Columns menu). */
  readonly tableTools?: ReactNode;
  readonly arrangement: Arrangement;
  readonly onArrange: (next: Arrangement) => void;
}

const VIEWS = [
  { id: 'shelf', label: 'Shelf', icon: <Library size={20} strokeWidth={1.5} /> },
  { id: 'topics', label: 'Topics', icon: <LayoutGrid size={20} strokeWidth={1.5} /> },
  { id: 'map', label: 'Map', icon: <Network size={20} strokeWidth={1.5} /> },
  { id: 'table', label: 'Table', icon: <Table2 size={20} strokeWidth={1.5} /> },
] as const;

const isLive = (id: string): id is LibraryViewName => id === 'shelf' || id === 'table';

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
  view,
  onView,
  tableTools,
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
          {VIEWS.map((tab) =>
            isLive(tab.id) ? (
              <ToolbarButton
                key={tab.id}
                size={size}
                className={target}
                label={tab.label}
                icon={tab.icon}
                pressed={view === tab.id}
                data-view={tab.id}
                onClick={() => onView(tab.id as LibraryViewName)}
              />
            ) : (
              <ToolbarButton
                key={tab.id}
                size={size}
                className={target}
                label={tab.label}
                icon={tab.icon}
                pressed={false}
                disabled
                title="Coming in this release"
                aria-describedby={soonId}
              />
            ),
          )}
          <span id={soonId} className="pt-sr-only">
            Coming in this release
          </span>
        </div>
        {/* Nothing to arrange on an empty shelf (01b keeps the view tabs, not Arrange by). */}
        {stats !== null && stats.papers === 0 ? null : view === 'table' ? (
          <div className="pt-libviews__tools">{tableTools}</div>
        ) : (
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
