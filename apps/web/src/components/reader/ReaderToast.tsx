'use client';

/**
 * reader/ReaderToast — one short sentence about something that did not work, with its next action.
 *
 * Errors are designed sentences ("Couldn't save this highlight: PaperTree is not reachable…"),
 * never a status code or an id. A polite live region, dismissed after 8 s or by the reader.
 */

import { useEffect } from 'react';

export interface ReaderToastProps {
  readonly message: string | null;
  readonly onDismiss: () => void;
}

export function ReaderToast({ message, onDismiss }: ReaderToastProps): JSX.Element | null {
  useEffect(() => {
    if (message === null) return undefined;
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  if (message === null) return null;
  return (
    <div className="pt-toast" role="status" aria-live="polite">
      <div className="pt-toast__body">
        <span>{message}</span>
        <button type="button" className="pt-btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
