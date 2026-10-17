'use client';

/**
 * A paper's notebook pages (S5c, #208): `/paper/<id>/notebook`. Every page listed is one the
 * person made; with none, it says where a page comes from and invents nothing.
 */
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { notebookApi, notebookKeys } from '../api/notebookApi';
import { notebookHref, readerHref } from '../model/links';

import './notebook.css';

import type { NotebookCounts } from '../api/notebookApi';
import type { ReactNode } from 'react';

/** Props for `NotebookPageList`. */
export interface NotebookPageListProps {
  readonly paperId: string;
}

/**
 * "4 quotes · 1 sticky": the non-zero counts of a page, in words.
 *
 * @param counts - A page's counts.
 * @returns The phrase, or "Empty page".
 */
export function countsPhrase(counts: NotebookCounts): string {
  const parts: [number, string, string][] = [
    [counts.quotes, 'quote', 'quotes'],
    [counts.text, 'typed note', 'typed notes'],
    [counts.stickies, 'sticky', 'stickies'],
    [counts.shapes, 'shape', 'shapes'],
  ];
  const words = parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${String(n)} ${n === 1 ? one : many}`);
  if (counts.strokes > 0) words.push('your ink');
  return words.length === 0 ? 'Empty page' : words.join(' · ');
}

/**
 * A page that could not be opened (deleted elsewhere, or no server), with the way back. The page
 * screen shows it in place of its desk (S5e moved it here from `NotebookView`).
 *
 * @param props - The paper.
 * @param props.paperId - Whose reader "Back to the paper" opens.
 * @returns The designed failure.
 */
export function PageGone({ paperId }: { readonly paperId: string }): ReactNode {
  return (
    <div className="pt-state" role="alert">
      <h1 className="pt-state__title">This page could not be opened</h1>
      <p className="pt-state__body">It may have been deleted, or the server is not answering.</p>
      <Link className="pt-btn pt-btn--primary" href={readerHref(paperId)}>
        Back to the paper
      </Link>
    </div>
  );
}

/** The list of a paper's notebook pages, or the honest empty state. */
export function NotebookPageList({ paperId }: NotebookPageListProps): ReactNode {
  const query = useQuery({
    queryKey: notebookKeys.pages(paperId),
    queryFn: () => notebookApi.listPages(paperId),
  });
  const pages = query.data ?? [];
  return (
    <main className="pt-nb-list" aria-labelledby="pt-nb-list-title">
      <h1 id="pt-nb-list-title">Notebook</h1>
      {query.isLoading ? (
        <p role="status">Opening the notebook…</p>
      ) : query.isError ? (
        <p role="alert">The notebook could not be read. Check the connection and reload.</p>
      ) : pages.length === 0 ? (
        <p>No pages yet. A page starts from one of the AI’s answers about this paper.</p>
      ) : (
        <ul>
          {pages.map((p) => (
            <li key={p.page_id}>
              <Link href={notebookHref(paperId, p.page_id)}>{p.title}</Link>
              <span>{countsPhrase(p.counts)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link className="pt-nb-list__back" href={readerHref(paperId)}>
        Back to the paper
      </Link>
    </main>
  );
}
