/**
 * MapList: the Map view in words (#198), for the keyboard and a screen reader: a disclosure after
 * the plan, reached by Tab, listing the topics (then Unshelved) with their papers (each a link to
 * the reader), then every real link ("BERT cites Attention Is All You Need · matched by title"),
 * then the board links, which do not exist yet. It reads the same data the plan draws.
 */
'use client';

import Link from 'next/link';

import { isReadingNow, spineTitle } from '../model/shelf';
import { readerHref } from '../model/table';

import type { LibraryBook } from '../hooks/useLibrary';
import type { MapGroup } from '../model/map';
import type { LibraryLink } from '@/lib/api/types';
import type { ReactNode } from 'react';

/** Props for `MapList`. */
export interface MapListProps {
  readonly groups: readonly MapGroup<LibraryBook>[];
  /** `GET /library/links`, or null while it loads. */
  readonly links: readonly LibraryLink[] | null;
  readonly books: readonly LibraryBook[];
}

/**
 * The plan as a list.
 *
 * @example
 * <MapList groups={groups} links={links} books={books} />
 */
export function MapList({ groups, links, books }: MapListProps): ReactNode {
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
                  <li key={paper.id}>
                    <Link href={readerHref(paper.id)}>{paper.title}</Link>
                    {isReadingNow(paper) ? ' · reading now' : ''}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <h3>Links</h3>
      {links === null ? (
        <p>Looking for papers that cite each other.</p>
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
