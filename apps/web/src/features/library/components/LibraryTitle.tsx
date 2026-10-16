/**
 * LibraryTitle: "Your library" with its stats line and the one alert, "N need a look" (#195,
 * frame 01), then the view tabs and Arrange by. Only the Shelf view exists in this release so far;
 * Topics, Map and Table are shown, disabled, and say "Coming in this release" (S2f, S2g).
 */
'use client';

import { ToolbarButton } from '@papertree/ui';
import { ChevronDown, LayoutGrid, Library, Network, Table2 } from 'lucide-react';
import { useId } from 'react';

import { ARRANGEMENTS, type Arrangement, type LibraryStats } from '../model/shelf';

import type { ReactNode } from 'react';

/** Props for `LibraryTitle`. */
export interface LibraryTitleProps {
  readonly stats: LibraryStats;
  /** The "need a look" filter is on. */
  readonly needALookOnly: boolean;
  readonly onNeedALook: (on: boolean) => void;
  readonly arrangement: Arrangement;
  readonly onArrange: (next: Arrangement) => void;
}

/** "24 papers · 6 topics · 3 reading now · 484 pages", leaving out what is zero and unknown. */
function statsParts(stats: LibraryStats): readonly [number, string][] {
  const parts: [number, string][] = [[stats.papers, stats.papers === 1 ? 'paper' : 'papers']];
  if (stats.topics > 0) parts.push([stats.topics, stats.topics === 1 ? 'topic' : 'topics']);
  if (stats.readingNow > 0) parts.push([stats.readingNow, 'reading now']);
  if (stats.pages > 0) parts.push([stats.pages, stats.pages === 1 ? 'page' : 'pages']);
  return parts;
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
  needALookOnly,
  onNeedALook,
  arrangement,
  onArrange,
}: LibraryTitleProps): ReactNode {
  const soonId = useId();
  const arrangeId = useId();
  return (
    <>
      <div className="pt-libtitle">
        <h1 className="pt-libtitle__h1">Your library</h1>
        <p className="pt-libtitle__stats">
          {statsParts(stats).map(([count, noun], index) => (
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
        {stats.needALook > 0 ? (
          // Filters the shelf to those papers for now; it will open the Table, filtered, in S2f.
          <button
            type="button"
            className="pt-libtitle__alert"
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
          <ToolbarButton label="Shelf" icon={<Library size={20} strokeWidth={1.5} />} pressed />
          {VIEWS.map((view) => (
            <ToolbarButton
              key={view.label}
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
        <label className="pt-libviews__arrange" htmlFor={arrangeId}>
          Arrange by
          <span className="pt-libviews__select">
            <select
              id={arrangeId}
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
      </div>
    </>
  );
}
