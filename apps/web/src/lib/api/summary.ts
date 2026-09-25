/**
 * lib/api/summary — contracts.md §2.5 (paper summary). Owned by S6 after S0.
 *
 * `POST /papers/{id}/summary` answers in ONE OF TWO SHAPES, so `generate` says which it got rather
 * than making the caller sniff: a cached summary is `200 application/json {state: "ready",
 * summary}`, and anything else is the §2.6 SSE stream. The server answers 501 until S5 lands.
 */
import { apiFetch, readSseEvents, request } from './client';
import { ApiError, type SseEvent, type Summary } from './types';

const seg = encodeURIComponent;

export type SummaryState = 'none' | 'running' | 'ready' | 'partial' | 'failed';

export interface SummaryStatus {
  readonly state: SummaryState;
  readonly summary: Summary | null;
}

export type SummaryStart =
  | { readonly kind: 'cached'; readonly status: SummaryStatus }
  | { readonly kind: 'stream'; readonly events: AsyncGenerator<SseEvent> };

export const summaryApi = {
  get: (paperId: string) => request<SummaryStatus>(`/papers/${seg(paperId)}/summary`),

  generate: async (
    paperId: string,
    body: { readonly regenerate?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<SummaryStart> => {
    const response = await apiFetch(`/papers/${seg(paperId)}/summary`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      return { kind: 'cached', status: (await response.json()) as SummaryStatus };
    }
    if (response.body === null) {
      throw new ApiError(response.status, 'internal', 'The server sent an empty event stream.', true);
    }
    return { kind: 'stream', events: readSseEvents(response.body) };
  },
};
