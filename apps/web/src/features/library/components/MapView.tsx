/**
 * MapView: the library's Map view (#198, frame 01e): "Plan of the reading room". Topic islands (the
 * topics you accepted, then a dashed Unshelved), their papers as spines with their short titles,
 * and ONLY the real links: the citation links `GET /library/links` found between your own papers,
 * each tagged with how it matched. Nothing is drawn for papers that are merely alike, and "Papers
 * you linked on a board" says "none yet" because a board holds one paper (S2c). The plan is a
 * picture with a name; `MapList` after it says the same in words and is reached by Tab.
 */
'use client';

import { SproutMark } from '@papertree/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useRef } from 'react';

import { papersApi } from '@/lib/api/papers';

import { useElementWidth } from '../hooks/useElementWidth';
import { useTopics } from '../hooks/useTopics';
import { layoutMap, mapGroups, mapLinks } from '../model/map';
import { MapList } from './MapList';
import { MapPlan } from './MapPlan';
import './map.css';

import type { LibraryBook } from '../hooks/useLibrary';
import type { ReactNode } from 'react';

/** Props for `MapView`. */
export interface MapViewProps {
  readonly books: readonly LibraryBook[];
  readonly matches: ReadonlySet<string> | null;
}

/**
 * The Map view.
 *
 * @example
 * <MapView books={books} matches={matches} />
 */
export function MapView({ books, matches }: MapViewProps): ReactNode {
  const { topics, query } = useTopics();
  // A sample paper (fixtures on) is not the person's: it is on no topic and cites nothing of theirs.
  const own = useMemo(() => books.filter((book) => book.isSample !== true), [books]);
  // A paper's links are found once it is read, so the links are asked again when a state changes.
  const states = useMemo(() => own.map((b) => `${b.id}:${b.processing}`).join(','), [own]);
  const links = useQuery({
    queryKey: ['library-links', states],
    queryFn: () => papersApi.links(),
    // The last links stay drawn while the next answer comes, so a parse finishing never blanks them.
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });
  const host = useRef<HTMLDivElement>(null);
  const width = useElementWidth(host);
  const headingId = useId();
  const groups = useMemo(() => mapGroups(topics, own), [topics, own]);
  const layout = useMemo(() => layoutMap(groups, width), [groups, width]);
  const drawn = useMemo(() => mapLinks(layout, links.data?.links ?? []), [layout, links.data]);
  const count = links.data === undefined ? null : drawn.length;
  return (
    <section className="pt-map" aria-labelledby={headingId}>
      <div className="pt-map__legend">
        <h2 id={headingId} className="pt-map__title">
          <SproutMark size={20} />
          Plan of the reading room
        </h2>
        <ul className="pt-map__keys">
          <li>
            <span className="pt-map__key pt-map__key--isle" aria-hidden="true" />A topic you
            accepted
          </li>
          <li>
            <span className="pt-map__key pt-map__key--cite" aria-hidden="true" />A paper cites
            another of yours (matched by its title or arXiv id) ·{' '}
            {count === null ? 'looking' : count === 0 ? 'none yet' : String(count)}
          </li>
          <li>
            <span className="pt-map__key pt-map__key--board" aria-hidden="true" />
            Papers you linked on a board · none yet
          </li>
          <li>
            <span className="pt-map__key pt-map__key--ribbon" aria-hidden="true" />
            Reading now
          </li>
        </ul>
        <p className="pt-map__note">
          Papers sit inside the topic you accepted. A line is drawn only where one paper’s
          bibliography cites another paper in your library; papers that are merely alike are never
          joined.
          {topics.length === 0 ? ' No topics yet: every paper stands in Unshelved.' : ''}
        </p>
      </div>
      <div ref={host} className="pt-map__host">
        {width === 0 || query.isLoading ? null : (
          <MapPlan layout={layout} links={drawn} matches={matches} />
        )}
      </div>
      <MapList groups={groups} links={links.data?.links ?? null} books={own} />
    </section>
  );
}
