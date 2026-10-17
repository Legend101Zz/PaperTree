/**
 * The Table view's test library (#197): four papers that cover its cells (a reading place, one
 * author, a topic from arXiv, a paper we could not read) and the helpers that render the page and
 * read its rows. Each spec mocks `papersApi` and `next/navigation` itself (the mocks are hoisted).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { LibraryView } from '@/features/library';
import type { LibraryPaper } from '@/lib/api/types';

export const VASWANI = [
  'Ashish Vaswani',
  'Noam Shazeer',
  'Niki Parmar',
  'Jakob Uszkoreit',
  'Llion Jones',
  'Aidan N. Gomez',
  'Lukasz Kaiser',
  'Illia Polosukhin',
];

export function row(
  id: string,
  title: string,
  overrides: Partial<LibraryPaper> = {},
): LibraryPaper {
  return {
    paper_id: id,
    title,
    authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren'],
    original_filename: `${title}.pdf`,
    source_hash: 'sha256:00',
    page_count: 12,
    processing: 'ready',
    job: null,
    generation: 1,
    parser_version: '1.0.0',
    highlight_count: 0,
    created_at: '2026-10-01T10:00:00+00:00',
    updated_at: '2026-10-15T10:00:00+00:00',
    reading: null,
    year: 2015,
    arxiv_id: null,
    arxiv_category: 'cs.CV',
    thread_count: 0,
    has_summary: false,
    topic: null,
    notebook_count: 0,
    plate: null,
    ...overrides,
  };
}

export const TRANSFORMERS = {
  topic_id: 'top_t',
  name: 'Transformers & attention',
  cloth: 'transformers' as const,
  source: 'arxiv_category' as const,
  source_detail: 'cs.CL',
};

export const ROWS = (): LibraryPaper[] => [
  row('ppr_1', 'Attention Is All You Need', {
    authors: VASWANI,
    page_count: 15,
    year: 2017,
    highlight_count: 3,
    topic: TRANSFORMERS,
    reading: {
      last_page: 3,
      furthest_page: 3,
      page_count: 15,
      opened_at: '2026-10-16T10:00:00Z',
      finished_at: null,
      state: 'reading',
    },
  }),
  row('ppr_2', 'FlashAttention: Fast and Memory-Efficient Exact Attention', {
    authors: ['Tri Dao'],
    page_count: 34,
    year: 2022,
    topic: TRANSFORMERS,
  }),
  row('ppr_3', 'Deep Residual Learning for Image Recognition'),
  row('ppr_4', 'garbage', { processing: 'failed', page_count: null, year: null, authors: [] }),
];

/** Renders the library page and waits for the shelf; returns the query client (to poll by hand). */
export async function renderLibrary(): Promise<QueryClient> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  await screen.findByRole('toolbar', { name: 'Shelf' });
  return client;
}

/** Renders the page and opens the Table tab. */
export async function openTable(): Promise<HTMLElement> {
  await renderLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  return screen.getByRole('table', { name: 'Papers' });
}

export const rowIds = (table: HTMLElement) =>
  [...table.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')].map((r) => r.dataset['rowId']);
export const rowOf = (table: HTMLElement, id: string) =>
  table.querySelector<HTMLElement>(`tr[data-row-id="${id}"]`) as HTMLElement;
export const header = (table: HTMLElement, name: string) =>
  within(table).getByRole('columnheader', { name: new RegExp(`^${name}`) });
