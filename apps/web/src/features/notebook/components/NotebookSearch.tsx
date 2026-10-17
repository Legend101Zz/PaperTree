'use client';

/**
 * The notebook search box (S5c, #208): S5a's search over typed text, stickies, quotes and the AI's
 * answer, never handwriting. Matches on this page are reported up so the page can light them;
 * matches on the paper's other pages are listed as links.
 */
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { notebookApi, notebookKeys } from '../api/notebookApi';
import { notebookHref } from '../model/links';

import type { NotebookItemKind } from '../api/notebookApi';
import type { ReactNode } from 'react';

/** Props for `NotebookSearch`. */
export interface NotebookSearchProps {
  readonly paperId: string;
  readonly pageId: string;
  /** The ids of this page's items that match, or an empty set when there is no query. */
  readonly onMatches: (ids: ReadonlySet<string>) => void;
}

/**
 * Whose words a hit's snippet is. An exchange hit can be the question or the answer, so it is left
 * unmarked rather than marked wrongly.
 */
const VOICE: Readonly<Partial<Record<NotebookItemKind, 'you' | 'paper'>>> = {
  text: 'you',
  sticky: 'you',
  quote: 'paper',
};

/** Waits this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 250;

/** The search field and what it found. */
export function NotebookSearch({ paperId, pageId, onMatches }: NotebookSearchProps): ReactNode {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const query = useQuery({
    queryKey: notebookKeys.search(paperId, q),
    queryFn: () => notebookApi.search(paperId, q),
    enabled: q.length > 0,
  });
  const hits = q.length > 0 ? (query.data ?? []) : [];
  const here = hits.filter((h) => h.page_id === pageId);
  const elsewhere = hits.filter((h) => h.page_id !== pageId);
  const hereKey = here.map((h) => h.item_id).join(' ');
  useEffect(() => {
    onMatches(new Set(hereKey === '' ? [] : hereKey.split(' ')));
  }, [hereKey, onMatches]);

  return (
    <div className="pt-nb-search" role="search">
      <label className="pt-sr-only" htmlFor="pt-nb-search">
        Search this paper’s notebook
      </label>
      <input
        id="pt-nb-search"
        type="search"
        placeholder="Search the notebook"
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      {q.length === 0 || query.isLoading ? null : (
        <p className="pt-nb-search__result" role="status">
          {query.isError
            ? 'Search did not answer. Try again.'
            : `${String(here.length)} on this page${elsewhere.length > 0 ? `, ${String(elsewhere.length)} on other pages` : ''}`}
        </p>
      )}
      {elsewhere.length === 0 ? null : (
        <ul className="pt-nb-search__elsewhere">
          {elsewhere.slice(0, 5).map((h) => (
            <li key={h.item_id}>
              <Link href={notebookHref(paperId, h.page_id)}>{h.page_title}</Link>
              <span {...(VOICE[h.kind] === undefined ? {} : { 'data-voice': VOICE[h.kind] })}>
                {h.snippet}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
