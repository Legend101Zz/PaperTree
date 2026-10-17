/**
 * MapView: the library's Map view (#198, frame 01e): "Plan of the reading room". Topic islands (the
 * topics you made or accepted, then a dashed Unshelved), their papers as spines with their short
 * titles, and ONLY the real links: the citation links `GET /library/links` found between your own
 * papers, each tagged with how it matched. Nothing is drawn for papers that are merely alike, and
 * "Papers you linked on a board" says "none yet" because a board holds one paper (S2c). The plan is
 * a picture with a name; `MapList` after it says the same in words and is reached by Tab. A read
 * that is still loading or has failed says so, with Try again, and is never shown as "none".
 */
'use client';

import { SproutMark } from '@papertree/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useRef } from 'react';

import { papersApi } from '@/lib/api/papers';

import { useElementWidth } from '../hooks/useElementWidth';
import { useTopics } from '../hooks/useTopics';
import { layoutMap, mapGroups, mapLinks, type MapLinksState } from '../model/map';
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

/** A failed read in words, with its Try again. */
function ReadFailed({
  text,
  onRetry,
}: {
  readonly text: string;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <p role="alert" className="pt-map__failed">
      {text}{' '}
      <button type="button" className="pt-map__retry" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}

/** What the legend's citation line says after its "·". */
function citeCount(state: MapLinksState, drawn: number, untagged: number): string {
  if (state === 'loading') return 'loading';
  if (state === 'error') return 'could not be read';
  if (drawn === 0) return 'none yet';
  return untagged === 0
    ? String(drawn)
    : `${String(drawn)} (${String(untagged)} labelled only in the list)`;
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
  const samples = own.length < books.length;
  // A paper's links are found once it is read, so the links are asked again when a state changes.
  const states = useMemo(() => own.map((b) => `${b.id}:${b.processing}`).join(','), [own]);
  const links = useQuery({
    queryKey: ['library-links', states],
    queryFn: () => papersApi.links(),
    // The last links stay drawn while the next answer comes, so a parse finishing never blanks them.
    placeholderData: (previous) => previous,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const linksState: MapLinksState =
    links.data !== undefined ? 'ready' : links.isError ? 'error' : 'loading';
  const host = useRef<HTMLDivElement>(null);
  const width = useElementWidth(host);
  const headingId = useId();
  const groups = useMemo(() => mapGroups(topics, own), [topics, own]);
  const layout = useMemo(() => layoutMap(groups, width), [groups, width]);
  const drawn = useMemo(() => mapLinks(layout, links.data?.links ?? []), [layout, links.data]);
  const untagged = drawn.filter((d) => d.tag === null).length;
  return (
    <section className="pt-map" aria-labelledby={headingId}>
      <div className="pt-map__legend">
        <h2 id={headingId} className="pt-map__title">
          <SproutMark size={20} />
          Plan of the reading room
        </h2>
        <ul className="pt-map__keys">
          <li>
            <span className="pt-map__key pt-map__key--isle" aria-hidden="true" />A topic you made or
            accepted
          </li>
          <li>
            <span className="pt-map__key pt-map__key--cite" aria-hidden="true" />A paper cites
            another of yours (matched by its title or arXiv id) ·{' '}
            {citeCount(linksState, drawn.length, untagged)}
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
          Papers sit inside the topic they are on. A line is drawn only where one paper’s
          bibliography cites another paper in your library; papers that are merely alike are never
          joined.
          {!query.isError && query.data !== undefined && topics.length === 0
            ? ' No topics yet: every paper stands in Unshelved.'
            : ''}
          {samples ? ' The sample papers are not yours, so they are not on the plan.' : ''}
        </p>
        {query.isError ? (
          <ReadFailed
            text="Your topics could not be read, so a topic with no papers is missing from the plan."
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {linksState === 'error' ? (
          <ReadFailed
            text="The citation links could not be read, so no line is drawn."
            onRetry={() => void links.refetch()}
          />
        ) : null}
      </div>
      <div ref={host} className="pt-map__host">
        {width === 0 || query.isLoading ? null : (
          <MapPlan layout={layout} links={drawn} matches={matches} linksState={linksState} />
        )}
      </div>
      {/* While the topics load every paper would look unshelved: the list waits with the plan. */}
      {query.isLoading ? null : (
        <MapList
          groups={groups}
          links={links.data?.links ?? null}
          linksState={linksState}
          books={own}
        />
      )}
    </section>
  );
}
