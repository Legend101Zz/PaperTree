/**
 * The thread menu's order and the thread a panel opens on (#202). "Thread n of N" counts threads
 * oldest first by `created_at`: the API lists newest first and a follow-up must never renumber a
 * thread (GAP-A2 Risks 4). Pure; `useThreads` feeds it the list.
 */
import type { Anchor } from '@papertree/anchoring';
import type { Thread } from '@/lib/api/types';

/**
 * Threads in menu order: `created_at` ascending, `thread_id` breaking ties (ULIDs sort by time).
 *
 * @param threads The list as the API returned it.
 * @returns A new array, oldest first.
 */
export function sortThreads(threads: readonly Thread[]): Thread[] {
  return [...threads].sort((a, b) => {
    const at = Date.parse(a.created_at);
    const bt = Date.parse(b.created_at);
    if (at !== bt) return at - bt;
    return a.thread_id < b.thread_id ? -1 : a.thread_id > b.thread_id ? 1 : 0;
  });
}

/**
 * Where a thread sits in the menu.
 *
 * @param sorted Threads from `sortThreads`.
 * @param threadId The current thread, or null.
 * @returns Its 1-based position and the total; position 0 when it is not (yet) in the list.
 */
export function threadPosition(
  sorted: readonly Thread[],
  threadId: string | null,
): { readonly position: number; readonly total: number } {
  const index = threadId === null ? -1 : sorted.findIndex((t) => t.thread_id === threadId);
  return { position: index + 1, total: sorted.length };
}

/**
 * The selection a stored thread was opened on, as the panel's request: its origin Anchor and the
 * Anchor's own exact words. Null for a free question, or an Anchor with no quote selector.
 *
 * @param thread A thread from the list.
 * @returns The origin, or null.
 */
export function originOf(
  thread: Pick<Thread, 'origin_anchor'>,
): { readonly anchor: Anchor; readonly quote: string } | null {
  const anchor = thread.origin_anchor;
  if (anchor === null) return null;
  const selectors = (anchor as { selectors?: readonly { type?: string; exact?: unknown }[] })
    .selectors;
  const exact = selectors?.find((s) => s.type === 'TextQuoteSelector')?.exact;
  return typeof exact === 'string' ? { anchor, quote: exact } : null;
}

/** The panel state `opensOnNewest` reads. */
export interface PanelSnapshot {
  readonly open: boolean;
  readonly view: 'thread' | 'summary';
  readonly threadId: string | null;
  readonly hasRequest: boolean;
  readonly messageCount: number;
}

/**
 * The thread an empty panel should open on: the newest stored one. Only when the panel is open on
 * the thread view with nothing in it (no thread, no selection, no message), so it never replaces
 * what the person is reading or asking.
 *
 * @param panel The panel's state.
 * @param sorted Threads from `sortThreads`.
 * @returns The thread to select, or null to leave the panel as it is.
 */
export function opensOnNewest(panel: PanelSnapshot, sorted: readonly Thread[]): Thread | null {
  const empty =
    panel.open &&
    panel.view === 'thread' &&
    panel.threadId === null &&
    !panel.hasRequest &&
    panel.messageCount === 0;
  return empty ? (sorted[sorted.length - 1] ?? null) : null;
}
