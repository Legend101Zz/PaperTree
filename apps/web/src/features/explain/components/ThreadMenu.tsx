'use client';

/**
 * The thread menu of the explain panel header (#202, frame 04): "‹ Thread 1 of 2 ›" with a
 * listbox of the paper's threads, each named by its ask (DESIGN.md §4.5, never "Turn 1"). Threads
 * count oldest first (`sortThreads`). The listbox is keyboard-driven (arrows, Home/End, Enter,
 * Esc) with `aria-activedescendant`, so focus stays on the list while the option moves.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { Thread } from '@/lib/api/types';

/** Props for `ThreadMenu`. */
export interface ThreadMenuProps {
  /** The paper's threads, oldest first. */
  readonly threads: readonly Thread[];
  /** The current thread's 1-based place; 0 while a new thread is not listed yet. */
  readonly position: number;
  readonly onSelect: (threadId: string) => void;
  /** While an answer streams the thread cannot change (switching would cancel it). */
  readonly disabled?: boolean;
}

function Chevron({ d }: { d: string }): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** "‹ Thread n of N ›" and its listbox of asks. */
export function ThreadMenu({
  threads,
  position,
  onSelect,
  disabled = false,
}: ThreadMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, position - 1));
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const id = useId();
  const total = threads.length;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, position - 1));
    list.current?.focus();
  }, [open, position]);

  const close = (focusTrigger: boolean): void => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  };
  const choose = (index: number): void => {
    const thread = threads[index];
    close(true);
    if (thread !== undefined && index !== position - 1) onSelect(thread.thread_id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const last = total - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key] as number);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // Esc closes the menu, not the whole panel
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const label = position === 0 ? 'New thread' : `Thread ${String(position)} of ${String(total)}`;
  const step = (to: number) => {
    const thread = threads[to - 1];
    if (thread !== undefined) onSelect(thread.thread_id);
  };
  return (
    <div className="pt-thread-menu">
      <button
        type="button"
        className="pt-thread-menu__step"
        aria-label="Previous thread"
        disabled={disabled || position <= 1}
        onClick={() => step(position - 1)}
      >
        <Chevron d="M12.5 4.5 7 10l5.5 5.5" />
      </button>
      <button
        ref={trigger}
        type="button"
        className="pt-thread-menu__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled || total === 0}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <Chevron d="M5 8l5 5 5-5" />
      </button>
      <button
        type="button"
        className="pt-thread-menu__step"
        aria-label="Next thread"
        disabled={disabled || position === 0 || position >= total}
        onClick={() => step(position + 1)}
      >
        <Chevron d="M7.5 4.5 13 10l-5.5 5.5" />
      </button>
      {open ? (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={0}
          aria-label="Threads, by their asks"
          aria-activedescendant={`${id}-${String(active)}`}
          className="pt-thread-menu__list"
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) close(false);
          }}
        >
          {threads.map((thread, index) => (
            // Options are picked by the listbox's own keyboard handler (`aria-activedescendant`);
            // a click is the pointer path to the same choice.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={thread.thread_id}
              id={`${id}-${String(index)}`}
              role="option"
              aria-selected={index === position - 1}
              data-active={index === active ? 'true' : undefined}
              className="pt-thread-menu__option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span className="pt-thread-menu__n">{index + 1}</span>
              <span className="pt-thread-menu__ask">{thread.ask || thread.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
