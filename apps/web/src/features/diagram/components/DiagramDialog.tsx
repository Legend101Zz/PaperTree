'use client';

/**
 * The larger view of a Mermaid figure from a board card: a modal dialog over the page (a portal on
 * <body>, outside React Flow, so the board does not pan or zoom under it). The drawing is fitted to
 * the dialog's box by the panel's rule (never below `MIN_SCALE`, scrolls sideways past that). Esc,
 * the Close button or a click on the backdrop closes it; focus moves in on open and the caller puts
 * it back on close. Themed from the page tokens, which live on <html>, so it follows the room.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { fitFigure } from '../mermaid/scale';

import './mermaid.css';

/** Props for `DiagramDialog`. */
export interface DiagramDialogProps {
  /** Mermaid's own sanitised svg. */
  readonly svg: string;
  /** The drawing's natural width in px. */
  readonly width: number;
  /** The dialog's accessible name. */
  readonly label: string;
  /** Close it (the caller returns focus). */
  readonly onClose: () => void;
}

/** The dialog. Rendered only while open. */
export function DiagramDialog({ svg, width, label, onClose }: DiagramDialogProps): ReactNode {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(0);

  useLayoutEffect(() => {
    closeRef.current?.focus();
    const el = scrollRef.current;
    if (el === null) return undefined;
    const read = (): void => setRoom(Math.floor(el.clientWidth));
    read();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        // Keep Tab inside: the Close button is the one stop.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const fit = fitFigure(width, room, false);

  return createPortal(
    // The backdrop. Every event stops here so the card and the board under it never see them.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="pt-mmd-dialog__backdrop nodrag nopan nowheel"
      data-testid="mermaid-dialog-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="pt-mmd-dialog" role="dialog" aria-modal="true" aria-label={label}>
        <button ref={closeRef} type="button" className="pt-mmd-dialog__close" onClick={onClose}>
          Close
        </button>
        <div ref={scrollRef} className="pt-mmd-dialog__scroll">
          <div
            className="pt-mmd__svg pt-mmd-dialog__svg"
            style={{ '--pt-mmd-w': `${String(fit.width)}px` } as CSSProperties}
            aria-hidden="true"
            // Mermaid's own output, already sanitised by `securityLevel: 'strict'`.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
