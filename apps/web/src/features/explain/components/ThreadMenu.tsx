'use client';

/**
 * The thread menu of the explain panel header (#202, frame 04): "‹ Thread 1 of 2 ›" with a
 * listbox of the paper's threads, each named by its ask (DESIGN.md §4.5, never "Turn 1"), and a
 * last option, "New thread", that empties the panel for a fresh question (owner may change: the
 * design draws no such item). Threads count oldest first (`sortThreads`). The listbox is driven by
 * the keyboard (arrows, Home/End, Enter, Esc) with `aria-activedescendant`. Focus stays in the
 * menu across a switch: on the arrow used, or on the trigger once that arrow is disabled.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { Thread } from '@/lib/api/types';

/** Props for `ThreadMenu`. */
export interface ThreadMenuProps {
  /** The paper's threads, oldest first. */
  readonly threads: readonly Thread[];
  /** The current thread's 1-based place; 0 for a new thread (not listed yet, or "New thread"). */
  readonly position: number;
  readonly onSelect: (threadId: string) => void;
  /** "New thread": an empty panel whose next question starts a thread of its own. */
  readonly onNewThread: () => void;
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
  onNewThread,
  disabled = false,
}: ThreadMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const total = threads.length;
  // Options: the threads, then "New thread" (index `total`).
  const current = position === 0 ? total : position - 1;
  const [active, setActive] = useState(current);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setActive(current);
    list.current?.focus();
  }, [open, current]);

  const close = (focusTrigger: boolean): void => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  };
  const choose = (index: number): void => {
    close(true);
    if (index === current) return;
    const thread = threads[index];
    if (thread === undefined) onNewThread();
    else onSelect(thread.thread_id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const moves: Record<string, number> = {
      ArrowDown: Math.min(total, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: total,
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
  const step = (to: number): void => {
    const thread = threads[to - 1];
    if (thread === undefined) return;
    onSelect(thread.thread_id);
    // The arrow just used is about to be disabled at either end: keep focus in the menu.
    if (to <= 1 || to >= total) trigger.current?.focus();
  };

  const label = position === 0 ? 'New thread' : `Thread ${String(position)} of ${String(total)}`;
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
        aria-label={`${label}: choose a thread by its ask`}
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled}
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
            // A press on the trigger blurs the list first: let the trigger's click do the closing.
            const to = event.relatedTarget;
            if (!event.currentTarget.contains(to) && to !== trigger.current) close(false);
          }}
        >
          {[...threads.map((t) => t.ask || t.title), null].map((ask, index) => (
            // Options are picked by the listbox's own keyboard handler (`aria-activedescendant`);
            // a click is the pointer path to the same choice.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={index}
              id={`${id}-${String(index)}`}
              role="option"
              aria-selected={index === current}
              data-active={index === active ? 'true' : undefined}
              className={`pt-thread-menu__option${ask === null ? ' pt-thread-menu__option--new' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span className="pt-thread-menu__n">{ask === null ? '+' : index + 1}</span>
              <span className="pt-thread-menu__ask">{ask ?? 'New thread'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
