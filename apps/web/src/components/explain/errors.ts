/**
 * explain/errors — every way an AI turn can fail, as a sentence with a next action (contracts.md
 * §2.9 and the SSE `done.error.code` list). The server's own `message` is never shown: it may name
 * an id or an upstream detail, and the reader cannot act on either.
 */
import { NetworkError } from '@/lib/api/client';
import { ApiError, type ErrorCode, type RunErrorCode } from '@/lib/api/types';

export type FailureCode = RunErrorCode | ErrorCode | 'network';

export interface Failure {
  readonly code: FailureCode;
  readonly retryable: boolean;
}

export interface FailureCopy {
  /** What happened, in plain words. */
  readonly sentence: string;
  /** What the reader can do now. */
  readonly next: string;
  /** Whether a Retry button makes sense (a retry that must fail again is not offered). */
  readonly canRetry: boolean;
}

const UNAVAILABLE: FailureCopy = {
  sentence: 'AI is not available on this server right now.',
  next: 'The paper itself still works. Ask whoever runs this server to start the AI service, then retry.',
  canRetry: true,
};

const COPY: Readonly<Partial<Record<FailureCode, FailureCopy>>> = {
  budget_exhausted: {
    sentence: "You've used today's AI budget.",
    next: 'The budget is counted over a rolling 24 hours, so questions work again as older ones age out. Reading, highlighting and the canvas are not affected.',
    canRetry: false,
  },
  agent_unavailable: UNAVAILABLE,
  not_configured: {
    sentence: 'AI is not available on this server.',
    next: 'It has not been set up with an AI key. Ask whoever runs this server to enable it. Reading and highlighting still work.',
    canRetry: false,
  },
  not_parsed: {
    sentence: 'This paper is still being read.',
    next: 'Questions start once reading finishes. Wait a moment, then retry.',
    canRetry: true,
  },
  busy: {
    sentence: 'Another answer is still being written.',
    next: 'Wait for it to finish, or stop it, then ask again.',
    canRetry: true,
  },
  validation_failed: {
    sentence: "That question couldn't be sent.",
    next: 'Questions are 1 to 2000 characters. Shorten it and ask again.',
    canRetry: false,
  },
  anchor_mismatch: {
    sentence: "That passage can't be matched to this paper.",
    next: 'Select it again in the reader and press Ask.',
    canRetry: false,
  },
  anchor_incomplete: {
    sentence: "That passage can't be matched to this paper.",
    next: 'Select it again in the reader and press Ask.',
    canRetry: false,
  },
  not_found: {
    sentence: 'This paper or conversation is no longer available.',
    next: 'Go back to the library and open the paper again.',
    canRetry: false,
  },
  provider_auth: {
    sentence: "The AI service rejected this server's credentials.",
    next: "Ask whoever runs this server to check the AI key. Retrying won't help until it is fixed.",
    canRetry: false,
  },
  rate_limited: {
    sentence: 'The AI service is busy.',
    next: 'Wait a minute, then retry.',
    canRetry: true,
  },
  quota: {
    sentence: "The AI provider's usage limit has been reached.",
    next: 'Try again later, or ask whoever runs this server to check the plan.',
    canRetry: false,
  },
  upstream_unavailable: {
    sentence: "The AI service didn't respond.",
    next: 'Retry in a moment.',
    canRetry: true,
  },
  timeout: {
    sentence: 'The answer took too long and was stopped.',
    next: 'Retry, or ask something narrower.',
    canRetry: true,
  },
  tool_failed: {
    sentence: "The assistant couldn't read part of the paper.",
    next: 'Retry. If it keeps failing, reload the page.',
    canRetry: true,
  },
  tool_budget_exhausted: {
    sentence: 'The assistant used up its reading budget before it could answer.',
    next: 'Ask a narrower question, for example about one section.',
    canRetry: true,
  },
  output_truncated: {
    sentence: 'The answer was cut off.',
    next: 'Retry, or ask for a shorter answer.',
    canRetry: true,
  },
  bad_request: {
    sentence: "The question couldn't be processed.",
    next: 'Rephrase it and ask again.',
    canRetry: false,
  },
  aborted: {
    sentence: 'The answer stopped before it finished.',
    next: 'What arrived is kept above. Retry to get the full answer.',
    canRetry: true,
  },
  network: {
    sentence: "Couldn't reach the server.",
    next: 'Check your connection, then retry.',
    canRetry: true,
  },
  internal: {
    sentence: 'Something went wrong on the server.',
    next: 'Retry. If it keeps happening, reload the page.',
    canRetry: true,
  },
};

export function describeFailure(failure: Failure): FailureCopy {
  const copy = COPY[failure.code] ?? COPY['internal'];
  return copy as FailureCopy;
}

/** A thrown value (an `ApiError` before the stream, a `TypeError` from fetch) as a `Failure`. */
export function failureOf(error: unknown): Failure {
  if (error instanceof ApiError) return { code: error.code, retryable: error.retryable };
  if (error instanceof NetworkError || error instanceof TypeError)
    return { code: 'network', retryable: true };
  return { code: 'internal', retryable: true };
}
