'use client';

/**
 * canvas/toast — the short confirmation after "Send to canvas", with an "Open canvas" link.
 *
 * It mounts itself into `document.body`, so the reader (S4) and the explain panel (S6) call
 * `sendToCanvas` without owning a toast slot. One toast at a time; it goes after 6 s.
 */
import { createRoot, type Root } from 'react-dom/client';

export interface CanvasToastContent {
  readonly message: string;
  readonly href?: string;
  readonly linkLabel?: string;
  readonly tone?: 'ok' | 'error';
}

const HOST_ID = 'pt-canvas-toast-host';
let root: Root | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

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
  return (
    <div className="pt-toast" role="status" aria-live="polite" data-testid="canvas-toast">
      <div className="pt-toast__body" data-tone={content.tone ?? 'ok'}>
        <span>{content.message}</span>
        {content.href === undefined ? null : (
          <a className="pt-btn pt-btn--outline" href={content.href}>
            {content.linkLabel ?? 'Open canvas'}
          </a>
        )}
        <button type="button" className="pt-btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function dismissCanvasToast(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  root?.render(null);
}

export function showCanvasToast(content: CanvasToastContent): void {
  if (typeof document === 'undefined') return;
  const el = host();
  root ??= createRoot(el);
  root.render(<Toast content={content} onDismiss={dismissCanvasToast} />);
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(dismissCanvasToast, 6000);
}
