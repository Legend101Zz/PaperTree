/**
 * board/components/BoardStates — what the board says outside its cards: the notice line (a refused
 * thread, a failed save), the loading skeleton, the board that did not load, and the Undo toast.
 * `BoardView` places them; the controller decides when each shows.
 */
import type { ReactNode } from 'react';

/**
 * The notice line under the header (an alert), with Dismiss.
 *
 * @example
 * <BoardNotice text="That pin does not take that thread." onDismiss={clear} />
 */
export function BoardNotice({
  text,
  onDismiss,
}: {
  readonly text: string;
  readonly onDismiss: () => void;
}): ReactNode {
  return (
    <div className="pt-cv__notice" role="alert">
      <span>{text}</span>
      <button type="button" className="pt-btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** The board while its first read is on the way. */
export function BoardLoading(): ReactNode {
  return (
    <div className="pt-cv__skeleton" role="status" aria-label="Loading your board">
      <div className="pt-skeleton__page" />
    </div>
  );
}

/**
 * The board that did not load: the reason (or the usual advice) and Try again.
 *
 * @example
 * <BoardFailed reason={ctl.notice} onRetry={() => void ctl.reload()} />
 */
export function BoardFailed({
  reason,
  onRetry,
}: {
  readonly reason: string | null;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <div className="pt-state" role="alert">
      <h2 className="pt-state__title">Your board didn&apos;t load</h2>
      <p className="pt-state__body">{reason ?? 'Check your connection, then try again.'}</p>
      <button type="button" className="pt-btn pt-btn--primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/**
 * The Undo offer after a delete or a new thread (8 s, the controller's clock); its own live region.
 *
 * @example
 * <UndoToast message="Deleted a note." onUndo={undo} onDismiss={dismiss} />
 */
export function UndoToast({
  message,
  onUndo,
  onDismiss,
}: {
  readonly message: string;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}): ReactNode {
  return (
    <div
      className="pt-toast pt-toast--lift"
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
    >
      <div className="pt-toast__body">
        <span>{message}</span>
        <button type="button" className="pt-btn pt-btn--outline" onClick={onUndo}>
          Undo
        </button>
        <button type="button" className="pt-btn" aria-label="Dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
