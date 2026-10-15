import { NetworkError } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';

/**
 * The sentence to show on a sign-in or register form. The server's own `detail` wins for the
 * answers that carry one a person can act on (401 wrong password, 409 email taken, 422 invalid
 * field); a transport failure and a 5xx get a sentence of their own.
 */
export function authFailure(error: unknown, fallback: string): string {
  if (error instanceof NetworkError) {
    return 'PaperTree could not be reached. Check your connection and try again.';
  }
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'The server had a problem. Try again in a moment.';
    const detail = error.detail.trim();
    if (detail.length > 0 && !/^\s*[{[]/.test(detail)) return detail;
  }
  return fallback;
}
