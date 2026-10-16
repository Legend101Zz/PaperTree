/**
 * lib/readingStateSync — tells the server which page the reader is on (#192), without chattering.
 *
 * The reader already keeps its exact place in `localStorage` (`ReaderWorkspace`); this is the
 * cross-device half the library's "reading now" and "Continue" are built from. It is a
 * convenience like the local save: a failed write is dropped silently and NEVER retried in a loop
 * (the next page change sends the then-current page anyway). Timers and the sender are injected so
 * the debounce is testable without a clock or a network.
 */
import type { ReadingMode } from '@/lib/api/types';

/** How long after the page stops changing the write goes out. */
export const READING_STATE_DEBOUNCE_MS = 2000;

/** Sends one write; the real one is `papersApi.putReadingState`. */
export type SendReadingState = (
  page: number,
  mode: ReadingMode,
  options: { readonly keepalive: boolean },
) => Promise<unknown>;

export interface ReadingStateSync {
  /**
   * The reader is showing `page` (zero-based) in `mode` now. Restarts the debounce. A `null` page
   * means the reader has not shown any page yet (mount, a mode or zoom change before the PDF
   * reported a position) and is ignored: nothing is written for a place nobody has seen.
   */
  update(page: number | null, mode: ReadingMode): void;
  /**
   * Send a pending change immediately. A no-op when nothing is pending. Pass `keepalive` from a
   * page-hide handler so the browser lets the request outlive the page.
   */
  flush(options?: { readonly keepalive?: boolean }): void;
}

export interface ReadingStateSyncOptions {
  readonly send: SendReadingState;
  readonly delayMs?: number;
  /** Injectable for tests; default `setTimeout`/`clearTimeout`. */
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * A debounced, de-duplicated writer of the reading state.
 *
 * Only the latest `(page, mode)` is ever sent, and the same pair is never sent twice in a row, so
 * scrolling within one page costs nothing.
 *
 * @example
 * const sync = createReadingStateSync({ send: (p, m) => papersApi.putReadingState(id, p, m) });
 * sync.update(3, 'source'); // sent about 2 s later unless the page changes again
 */
export function createReadingStateSync(options: ReadingStateSyncOptions): ReadingStateSync {
  const delayMs = options.delayMs ?? READING_STATE_DEBOUNCE_MS;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let pending: { page: number; mode: ReadingMode } | null = null;
  let sent: { page: number; mode: ReadingMode } | null = null;
  let timer: unknown = null;

  const cancelTimer = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const flush = (flushOptions: { readonly keepalive?: boolean } = {}): void => {
    cancelTimer();
    const next = pending;
    pending = null;
    if (next === null) return;
    if (sent !== null && sent.page === next.page && sent.mode === next.mode) return;
    sent = next;
    // Silent on purpose, and not retried: see the module header.
    void options
      .send(next.page, next.mode, { keepalive: flushOptions.keepalive === true })
      .catch(() => undefined);
  };

  return {
    update(page, mode) {
      if (page === null) return;
      pending = { page, mode };
      cancelTimer();
      timer = setTimer(() => flush(), delayMs);
    },
    flush,
  };
}
