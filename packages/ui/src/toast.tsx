/**
 * ui/toast — the Ex Libris toast (v0.2, #189).
 *
 * One message, an optional Undo or other action, a Dismiss. It is a polite live region (it never interrupts a
 * screen reader), dismisses itself after `duration`, and holds still while the pointer or focus is
 * on it. `bottomInset` keeps it clear of whatever sits at the bottom edge: the v0.1 canvas toast
 * covered the composer at 390 px (#178), so the caller states the inset instead of hoping.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Button, joinClasses } from './controls.js';

/** Default time on screen before auto-dismiss, in ms. */
export const TOAST_DURATION_MS = 6000;

/** How long after mount the message is put into the (already present) live region, in ms. */
const ANNOUNCE_DELAY_MS = 50;

/** Gap kept between a toast and the inset it must not cover, in CSS px. */
export const TOAST_GAP_PX = 12;

/** Props for `Toast`. */
export interface ToastProps {
  /** What happened, in plain words. */
  readonly message: string;
  /** Shown as an Undo button when present. */
  readonly onUndo?: () => void;
  /** One more action, e.g. `{ label: 'Open board', onAction: open }`; shown before Dismiss. */
  readonly action?: { readonly label: string; readonly onAction: () => void };
  /** Called on Dismiss and on auto-dismiss. */
  readonly onDismiss: () => void;
  /** Milliseconds before auto-dismiss; `0` keeps the toast until dismissed. */
  readonly duration?: number;
  /** Height in CSS px of whatever occupies the bottom edge (the composer); the toast sits above it. */
  readonly bottomInset?: number;
  readonly className?: string;
}

/**
 * A transient message. The countdown restarts each time hover or focus leaves, so it never expires
 * under a pointer that is about to press Undo.
 *
 * @example
 * <Toast message="Highlight removed" onUndo={restore} onDismiss={clear} bottomInset={composerHeight} />
 */
export function Toast({
  message,
  onUndo,
  action,
  onDismiss,
  duration = TOAST_DURATION_MS,
  bottomInset = 0,
  className,
}: ToastProps): ReactNode {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const paused = hover || focus;
  // The live region must exist EMPTY before its text arrives: VoiceOver+Safari and NVDA+Firefox
  // skip text that is already present when a region is inserted. So the message is set after mount.
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnnounced(message);
    }, ANNOUNCE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [message]);

  useEffect(() => {
    if (duration <= 0 || paused) return undefined;
    const timer = setTimeout(() => {
      dismissRef.current();
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, paused, message]);

  return (
    <div
      className={joinClasses('pt-notice', className)}
      style={{ insetBlockEnd: bottomInset + TOAST_GAP_PX }}
      onPointerEnter={() => {
        setHover(true);
      }}
      onPointerLeave={() => {
        setHover(false);
      }}
      onFocus={() => {
        setFocus(true);
      }}
      onBlur={() => {
        setFocus(false);
      }}
    >
      <span className="pt-notice__message" role="status" aria-live="polite">
        {announced}
      </span>
      {onUndo === undefined ? null : (
        <Button variant="secondary" onClick={onUndo}>
          Undo
        </Button>
      )}
      {action === undefined ? null : (
        <Button variant="secondary" onClick={action.onAction}>
          {action.label}
        </Button>
      )}
      <Button variant="secondary" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
