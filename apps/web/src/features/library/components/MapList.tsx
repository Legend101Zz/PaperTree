/**
 * MapList: the Map view in words (#198), for the keyboard and a screen reader: a disclosure after
 * the plan, reached by Tab, listing the topics (then Unshelved) with their papers (each a link to
 * the reader, with the state the plan shows: being read, could not read, reading now), then every
 * real link ("BERT cites Attention Is All You Need · matched by title"), then the board links, which
 * do not exist yet. It reads the same data the plan draws, and says so when the links are loading or
 * could not be read.
 */
'use client';

import Link from 'next/link';

import { mapNote, type MapGroup, type MapLinksState } from '../model/map';
import { isReadingNow, spineTitle } from '../model/shelf';
import { readerHref } from '../model/table';

import type { LibraryBook } from '../hooks/useLibrary';
import type { LibraryLink } from '@/lib/api/types';
import type { ReactNode } from 'react';

/** Props for `MapList`. */
export interface MapListProps {
  readonly groups: readonly MapGroup<LibraryBook>[];
  /** `GET /library/links`, or null while it loads. */
  readonly links: readonly LibraryLink[] | null;
  readonly linksState: MapLinksState;
  readonly books: readonly LibraryBook[];
}

/**
 * The plan as a list.
 *
 * @example
 * <MapList groups={groups} links={links} linksState="ready" books={books} />
 */
export function MapList({ groups, links, linksState, books }: MapListProps): ReactNode {
  const short = (id: string): string => {
    const book = books.find((b) => b.id === id);
    return book === undefined ? 'a paper' : spineTitle(book.title);
  };
  return (
    <details className="pt-map__list">
      <summary>The plan as a list</summary>
      <h3>Topics</h3>
      <ul>
        {groups.map((group) => (
          <li key={group.key}>
            <b>{group.label}</b> · {group.meta}
            {group.papers.length === 0 ? null : (
              <ul>
                {group.papers.map((paper) => (
                  <li key={paper.id} data-paper-id={paper.id}>
                    <Link href={readerHref(paper.id)}>{paper.title}</Link>
                    {[mapNote(paper), isReadingNow(paper) ? 'reading now' : null]
                      .filter((note) => note !== null)
                      .map((note) => ` · ${note}`)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <h3>Links</h3>
      {linksState === 'loading' || links === null ? (
        <p>
          {linksState === 'error'
            ? 'The citation links could not be read (Try again, above the plan).'
            : 'Looking for papers that cite each other.'}
        </p>
      ) : links.length === 0 ? (
        <p>None yet: no paper here cites another paper in your library.</p>
      ) : (
        <ul data-map-links="">
          {links.map((link) => (
            <li key={`${link.from_paper_id}>${link.to_paper_id}`}>
              {short(link.from_paper_id)} cites {short(link.to_paper_id)} · matched by{' '}
              {link.matched_by === 'arxiv_id' ? 'arXiv id' : 'title'}
            </li>
          ))}
        </ul>
      )}
      <p>Papers you linked on a board: none yet (a board holds one paper).</p>
    </details>
  );
}
