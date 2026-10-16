'use client';

/**
 * What the explain panel says when a stored thread (or the thread list) cannot be read (#202):
 * a sentence, what to do next, and a way on (Try again, New thread), never a blank panel.
 */
import type { ThreadReadFailureKind } from '../hooks/useThreads';
import type { ReactNode } from 'react';

/** Props for `ThreadReadFailure`. */
export interface ThreadReadFailureProps {
  readonly kind: ThreadReadFailureKind;
  /** The current thread failed, or only the list of threads. */
  readonly of: 'thread' | 'list';
  readonly onRetry: () => void;
  /** Leave the thread for an empty panel; omitted when the list failed (the panel is usable). */
  readonly onStartFresh?: () => void;
}

const COPY = {
  thread: {
    not_found: [
      'This conversation is no longer here.',
      'It may have been deleted in another tab. Start a new thread, or pick another one from the thread menu.',
    ],
    failed: [
      'This conversation could not be loaded.',
      'The server did not answer. Try again, or start a new thread.',
    ],
  },
  list: {
    not_found: [
      'Your earlier threads could not be found.',
      'You can still ask a question below: it starts a new thread.',
    ],
    failed: [
      'Your earlier threads could not be loaded.',
      'You can still ask a question below: it starts a new thread.',
    ],
  },
} as const;

/** A designed failure for a thread read, in the interface's voice. */
export function ThreadReadFailure({
  kind,
  of,
  onRetry,
  onStartFresh,
}: ThreadReadFailureProps): ReactNode {
  const [sentence, next] = COPY[of][kind];
  return (
    <div className="pt-explain__error" role="alert" data-thread-read-failure={kind}>
      <p className="pt-explain__error-title">{sentence}</p>
      <p>{next}</p>
      <div className="pt-explain__actions">
        {kind === 'not_found' && of === 'thread' ? null : (
          <button type="button" className="pt-btn pt-btn--outline" onClick={onRetry}>
            Try again
          </button>
        )}
        {onStartFresh === undefined ? null : (
          <button type="button" className="pt-btn" onClick={onStartFresh}>
            New thread
          </button>
        )}
      </div>
    </div>
  );
}
