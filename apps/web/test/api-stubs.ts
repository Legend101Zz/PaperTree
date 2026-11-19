/**
 * In-process answers for the API reads a spec makes only because the screen it mounts makes them
 * (#310): the library reads `GET /topics` for its stats line, an opened book reads its figures,
 * abstract and summary, and the reader reads the paper's highlights. A spec that is not about those reads mocks the module with one of these instead of
 * letting the read reach `localhost:8000`, which `setup-no-network.ts` fails. Only the read is
 * replaced: the writes stay real, so a spec that makes one still trips the guard.
 *
 * Each answers a SUCCEEDED read (`[]`). Before #310 these specs' reads failed (nothing listened),
 * so a spec that wants the failed state now says so, per read: the stub is a `vi.fn`, e.g.
 * `vi.mocked(topicsApi.list).mockRejectedValueOnce(new NetworkError('offline'))`.
 *
 * Not a `.spec.` file, so vitest does not collect it.
 */
import { vi } from 'vitest';

import type * as BookApi from '@/features/book/api/bookApi';
import type * as Highlights from '@/lib/api/highlights';
import type * as Summary from '@/lib/api/summary';
import type * as Topics from '@/lib/api/topics';
import type { Highlight } from '@/lib/api/types';

/**
 * `@/lib/api/topics` for a person who has made no topics: `GET /topics` answers `[]`.
 *
 * @param actual - The real module, from the `vi.mock` factory's `importOriginal()`.
 * @returns The module with `topicsApi.list` answering in-process (a `vi.fn`, so a spec can
 *   override or count it).
 * @example
 *   vi.mock('@/lib/api/topics', async (importOriginal) =>
 *     (await import('./api-stubs')).withNoTopics(await importOriginal()),
 *   );
 */
export function withNoTopics(actual: typeof Topics): typeof Topics {
  return {
    ...actual,
    topicsApi: { ...actual.topicsApi, list: vi.fn(async (): Promise<Topics.Topic[]> => []) },
  };
}

/**
 * `@/lib/api/highlights` for a paper with no highlights yet: `GET /papers/{id}/highlights`
 * answers `[]`.
 *
 * @param actual - The real module, from the `vi.mock` factory's `importOriginal()`.
 * @returns The module with `highlightsApi.list` answering in-process (a `vi.fn`).
 * @example
 *   vi.mock('@/lib/api/highlights', async (importOriginal) =>
 *     (await import('./api-stubs')).withNoHighlights(await importOriginal()),
 *   );
 */
export function withNoHighlights(actual: typeof Highlights): typeof Highlights {
  return {
    ...actual,
    highlightsApi: {
      ...actual.highlightsApi,
      list: vi.fn(async (): Promise<Highlight[]> => []),
    },
  };
}

/**
 * `@/features/book/api/bookApi` for a paper the parser found no figures or abstract in: the two
 * reads an opened book makes answer "nothing there". The writes (the plate) stay real.
 *
 * @param actual - The real module, from the `vi.mock` factory's `importOriginal()`.
 * @returns The module with `bookApi.figures` and `bookApi.abstract` answering in-process.
 * @example
 *   vi.mock('@/features/book/api/bookApi', async (importOriginal) =>
 *     (await import('./api-stubs')).withEmptyBook(await importOriginal()),
 *   );
 */
export function withEmptyBook(actual: typeof BookApi): typeof BookApi {
  return {
    ...actual,
    bookApi: {
      ...actual.bookApi,
      figures: vi.fn(async () => []),
      abstract: vi.fn(async () => ({ text: null, page_index: null, anchor: null })),
    },
  };
}

/**
 * `@/lib/api/summary` for a paper with no summary yet: `GET /papers/{id}/summary` answers `none`.
 *
 * @param actual - The real module, from the `vi.mock` factory's `importOriginal()`.
 * @returns The module with `summaryApi.get` answering in-process (a `vi.fn`).
 * @example
 *   vi.mock('@/lib/api/summary', async (importOriginal) =>
 *     (await import('./api-stubs')).withNoSummary(await importOriginal()),
 *   );
 */
export function withNoSummary(actual: typeof Summary): typeof Summary {
  return {
    ...actual,
    summaryApi: {
      ...actual.summaryApi,
      get: vi.fn(async (): Promise<Summary.SummaryStatus> => ({ state: 'none', summary: null })),
    },
  };
}
