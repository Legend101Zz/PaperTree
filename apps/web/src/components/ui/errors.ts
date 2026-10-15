/**
 * lib/errors — an error as one sentence a reader can act on (S3).
 *
 * The transport already turns a server answer into an `ApiError` whose `detail` is the server's own
 * sentence, and a transport failure into a `NetworkError`. This picks the right sentence and never
 * returns raw JSON, a status line or an id.
 */
import { NetworkError } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';

const LOOKS_LIKE_JSON = /^\s*[{[]/;

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof NetworkError) {
    return 'PaperTree could not be reached. Check your connection and try again.';
  }
  if (error instanceof ApiError) {
    if (error.status >= 500) return `${fallback} The server had a problem; try again in a moment.`;
    const detail = error.detail.trim();
    if (detail.length > 0 && !LOOKS_LIKE_JSON.test(detail)) return detail;
    return fallback;
  }
  return fallback;
}

/** Upload-specific sentences for the three refusals the service gives (contracts.md §2.2). */
export function describeUploadError(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'The upload did not reach PaperTree. Check your connection and choose the file again.';
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return 'That file is empty. Choose a PDF that has content.';
      case 413:
        return 'That file is too large to upload. Choose a smaller PDF.';
      case 415:
        return 'That file is not a PDF. Choose a PDF file.';
      case 401:
        return 'Your session ended. Sign in again, then upload the file.';
      default:
        return describeError(error, 'The upload failed. Try again.');
    }
  }
  return 'The upload failed. Try again.';
}
