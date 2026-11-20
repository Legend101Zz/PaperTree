import { NetworkError } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';

/**
 * Every failure is a state with a designed sentence. The server's `detail` and an exception's
 * `message` are developer text ("validation_failed", a stack's first line) and are never shown
 * (s4-review.md F7); `retryable` says whether "Try again" can help.
 */
export type Failure =
  | { readonly kind: 'not_parsed' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'error'; readonly retryable: boolean };

/**
 * Classify a load error as one of the designed failure states.
 * @param error Whatever the load threw.
 * @returns The failure state to show.
 */
export function failureOf(error: unknown): Failure {
  if (error instanceof NetworkError) return { kind: 'unreachable' };
  if (error instanceof ApiError) {
    if (error.code === 'not_parsed' || error.status === 409) return { kind: 'not_parsed' };
    if (error.status === 404) return { kind: 'not_found' };
    return { kind: 'error', retryable: error.retryable || error.status >= 500 };
  }
  return { kind: 'error', retryable: true };
}
