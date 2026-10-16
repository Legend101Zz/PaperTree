'use client';

/**
 * The phone header's menu (#205, frame 08b): Contents, the reading mode, zoom and Board, folded
 * behind one 44 px button so the header keeps one row (back, title, "p. 2", Explain, menu). A
 * disclosure, not an ARIA menu: it holds a radio group and a select. Esc and a press outside close
 * it and focus goes back to its button; Contents and Board close it as they act.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Props for `ReaderMenu`. */
export interface ReaderMenuProps {
  /** The controls it folds away; a press inside that should close it calls `close`. */
  readonly children: (close: () => void) => ReactNode;
}

/**
 * The menu button and its panel of reading options.
 *
 * @example
 * <ReaderMenu>{(close) => <button onClick={close}>Contents</button>}</ReaderMenu>
 */
export function ReaderMenu({ children }: ReaderMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = (): void => setOpen(false);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="pt-toolbtn pt-reader__menu-button"
        aria-label="Reading options"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
          <path d="M4 6h12M4 10h12M4 14h7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          role="group"
          aria-label="Reading options"
          className="pt-reader-menu"
        >
          {children(close)}
        </div>
      ) : null}
    </>
  );
}
