/**
 * In-process answers for the API reads a spec makes only because the screen it mounts makes them
 * (#310): the library reads `GET /topics` for its stats line, and the reader reads the paper's
 * highlights. A spec that is not about those reads mocks the module with one of these instead of
 * letting the read reach `localhost:8000`, which `setup-no-network.ts` fails. Only the read is
 * replaced: the writes stay real, so a spec that makes one still trips the guard.
 *
 * Not a `.spec.` file, so vitest does not collect it.
 */
import { vi } from 'vitest';

import type * as Highlights from '@/lib/api/highlights';
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
