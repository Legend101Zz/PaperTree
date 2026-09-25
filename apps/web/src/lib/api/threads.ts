/**
 * lib/api/threads — contracts.md §2.5/§2.6 (explain, ask, follow-up). Owned by S6 after S0.
 *
 * The two POSTs answer with an SSE stream, read by `streamSse` (fetch + ReadableStream, because
 * `EventSource` cannot send the Bearer header). Pre-stream failures — 409 `not_parsed`, 429
 * `budget_exhausted`, 503 `agent_unavailable` / `not_configured`, 409 `busy` — throw an `ApiError`
 * from the stream's first `next()`. The server answers 501 until S5 lands.
 */
import { request, streamSse } from './client';
import type { Anchor, Message, SseEvent, Thread } from './types';

const seg = encodeURIComponent;

export interface CreateThreadBody {
  readonly kind: 'explain' | 'ask';
  /** Required for `explain`. */
  readonly anchor?: Anchor;
  /** 1..2000; the server defaults it to "Explain this passage." */
  readonly question?: string;
}

export interface FollowUpBody {
  readonly question: string;
  /** Re-run a failed assistant message instead of appending a new user turn. */
  readonly retry_of?: string;
}

export const threadsApi = {
  create: (paperId: string, body: CreateThreadBody, signal?: AbortSignal): AsyncGenerator<SseEvent> =>
    streamSse(`/papers/${seg(paperId)}/threads`, body, signal),
  followUp: (
    paperId: string,
    threadId: string,
    body: FollowUpBody,
    signal?: AbortSignal,
  ): AsyncGenerator<SseEvent> =>
    streamSse(`/papers/${seg(paperId)}/threads/${seg(threadId)}/messages`, body, signal),
  list: (paperId: string) => request<Thread[]>(`/papers/${seg(paperId)}/threads`),
  get: (paperId: string, threadId: string) =>
    request<{ thread: Thread; messages: Message[] }>(
      `/papers/${seg(paperId)}/threads/${seg(threadId)}`,
    ),
  /** 202. The API propagates `DELETE /v1/runs/{run_id}` to the agent. */
  cancelRun: (runId: string) => request<void>(`/runs/${seg(runId)}/cancel`, { method: 'POST' }),
};
