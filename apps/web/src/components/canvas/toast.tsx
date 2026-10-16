'use client';

/**
 * canvas/toast — the short confirmation after "Send to canvas", with an "Open canvas" link.
 *
 * It mounts itself into `document.body`, so the reader (S4) and the explain panel (S6) call
 * `sendToCanvas` without owning a toast slot. One toast at a time. It stays 8 s, and the clock stops while the pointer is over it or focus is
 * inside it, so "Open canvas" can be reached by mouse or by keyboard (Tab) before it goes.
 */
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export interface CanvasToastContent {
  readonly message: string;
  readonly href?: string;
  readonly linkLabel?: string;
  readonly tone?: 'ok' | 'error';
}

const HOST_ID = 'pt-canvas-toast-host';
let root: Root | null = null;
let seq = 0;

/**
 * How the last gesture was made, and on what. A keyboard "Send to canvas" disables its own button
 * while it works, which drops focus to the page, so the toast cannot ask `document.activeElement`
 * afterwards; it remembers the last keyboard target instead, until a pointer press replaces it.
 */
let keyboardOrigin: HTMLElement | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab' || event.key === 'Shift' || event.key === 'Escape') return;
      keyboardOrigin = event.target instanceof HTMLElement ? event.target : null;
    },
    true,
  );
  window.addEventListener('pointerdown', () => (keyboardOrigin = null), true);
}

/** How long a toast stays when nobody is pointing at it or focused in it. */
export const TOAST_MS = 8000;

function host(): HTMLElement {
  let el = document.getElementById(HOST_ID);
  if (el === null) {
    el = document.createElement('div');
    el.id = HOST_ID;
    document.body.appendChild(el);
    root = null;
  }
  return el;
}

function Toast({ content, onDismiss }: { content: CanvasToastContent; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(TOAST_MS);
  useEffect(() => {
    if (paused) return undefined;
    const startedAt = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      // Pausing and leaving gives the reader at least a moment more, never the full 8 s again.
      remaining.current = Math.max(2000, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, onDismiss]);
  const link = useRef<HTMLAnchorElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  // A keyboard user who pressed "Send to canvas" lands on "Open canvas" (it is otherwise at the end
  // of the page); Escape or Dismiss puts them back where they were. A mouse click moves nothing.
  useEffect(() => {
    previous.current = keyboardOrigin;
    if (keyboardOrigin !== null) link.current?.focus();
  }, []);
  const close = (): void => {
    const back = previous.current;
    const hadFocus =
      document.activeElement !== null &&
      link.current?.parentElement?.contains(document.activeElement) === true;
    onDismiss();
    if (hadFocus && back !== null && back.isConnected) back.focus();
  };
  const leaving = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };
  return (
    <div
      className="pt-toast"
      role="status"
      aria-live="polite"
      data-testid="canvas-toast"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={leaving}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <div className="pt-toast__body" data-tone={content.tone ?? 'ok'}>
        <span>{content.message}</span>
        {content.href === undefined ? null : (
          <a ref={link} className="pt-btn pt-btn--outline" href={content.href}>
            {content.linkLabel ?? 'Open canvas'}
          </a>
        )}
        <button type="button" className="pt-btn" onClick={close}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function dismissCanvasToast(): void {
  root?.render(null);
}

export function showCanvasToast(content: CanvasToastContent): void {
  if (typeof document === 'undefined') return;
  const el = host();
  root ??= createRoot(el);
  seq += 1;
  // A new key restarts the clock for a new toast.
  root.render(<Toast key={seq} content={content} onDismiss={dismissCanvasToast} />);
}
