/**
 * SpreadMenu: the ⋯ menu on the opened book (v0.3 #337, V3-36): Rename…, Topic, and Delete this
 * paper. It is a `role="menu"` the keyboard reaches and walks (Arrow keys, Home, End; opening puts
 * focus on the first item). Esc closes the menu first and stops there (`usePopover` stops it), so a
 * second Esc puts the book back: one level per press.
 *
 * Topic opens the person's topics under it, the current one ticked, and "No topic" takes the book
 * off its shelf; the shelf regroups behind the book. Delete asks nothing: the book closes and the
 * library offers Undo for 10 seconds (`usePendingDelete`).
 */
'use client';

import { Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import { describeError } from '@/components/ui/errors';
import { usePopover } from '@/features/library/hooks/usePopover';
import { useTopics } from '@/features/library/hooks/useTopics';

import type { LibraryBook } from '@/features/library';

/** Props for `SpreadMenu`. */
export interface SpreadMenuProps {
  readonly book: LibraryBook;
  /** Rename…: the title becomes a field. */
  readonly onRename: () => void;
  /** Delete this paper. */
  readonly onDelete: () => void;
}

const ITEM = '[role="menuitem"], [role="menuitemradio"]';

/** Arrow keys, Home and End walk the menu's items, wrapping. */
function walk(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM));
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next = at;
  if (event.key === 'ArrowDown') next = (at + 1) % items.length;
  else if (event.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
  else next = event.key === 'Home' ? 0 : items.length - 1;
  items[next]?.focus();
}

/**
 * The ⋯ button and its menu.
 *
 * @example
 * <SpreadMenu book={book} onRename={() => setEditing(true)} onDelete={deleteBook} />
 */
export function SpreadMenu({ book, onRename, onDelete }: SpreadMenuProps): ReactNode {
  const { open, setOpen, toggle, close, wrapper, button, panelId } = usePopover();
  const topicsId = useId();
  const { topics, actions } = useTopics();
  const [showTopics, setShowTopics] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = book.topic?.id ?? null;
  // Opening starts clean, with focus on the first item.
  useEffect(() => {
    if (!open) {
      setShowTopics(false);
      setProblem(null);
      return;
    }
    wrapper.current?.querySelector<HTMLElement>(ITEM)?.focus();
  }, [open, wrapper]);

  const choose = async (write: () => Promise<unknown>): Promise<void> => {
    if (busy) return; // a second press while the first is out does nothing
    setBusy(true);
    setProblem(null);
    try {
      await write();
      close();
    } catch (caught) {
      setProblem(describeError(caught, 'The topic was not changed. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={wrapper} className="pt-spreadmenu">
      <button
        ref={button}
        type="button"
        className="pt-spreadmenu__button"
        aria-haspopup="menu"
        aria-label="More: rename, topic, delete"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        <MoreHorizontal size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open ? (
        // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- a menu is focused through its items (roving by arrow keys)
        <div
          id={panelId}
          role="menu"
          aria-label="More"
          className="pt-spreadmenu__panel"
          onKeyDown={walk}
        >
          <button
            type="button"
            role="menuitem"
            className="pt-spreadmenu__item"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <Pencil size={18} strokeWidth={1.5} aria-hidden="true" />
            Rename…
          </button>
          <button
            type="button"
            role="menuitem"
            className="pt-spreadmenu__item"
            aria-haspopup="menu"
            aria-expanded={showTopics}
            aria-controls={showTopics ? topicsId : undefined}
            onClick={() => setShowTopics((was) => !was)}
          >
            Topic
            <span className="pt-spreadmenu__now">{book.topic?.name ?? 'None'}</span>
          </button>
          {showTopics ? (
            <div
              id={topicsId}
              role="group"
              aria-label="Choose a topic"
              className="pt-spreadmenu__topics"
            >
              {topics.map((topic) => (
                <button
                  key={topic.topic_id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={topic.topic_id === current}
                  className="pt-spreadmenu__item"
                  onClick={() =>
                    topic.topic_id === current
                      ? close()
                      : void choose(() => actions.accept(book.id, { topic_id: topic.topic_id }))
                  }
                >
                  {topic.name}
                  {topic.topic_id === current ? (
                    <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
              {current === null ? null : (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={false}
                  className="pt-spreadmenu__item"
                  onClick={() => void choose(() => actions.clear(book.id))}
                >
                  No topic
                </button>
              )}
              {topics.length === 0 && current === null ? (
                <p className="pt-spreadmenu__empty">No topics yet. Make one in the Topics view.</p>
              ) : null}
            </div>
          ) : null}
          {problem === null ? null : (
            <p role="alert" className="pt-spread__error">
              {problem}
            </p>
          )}
          <div role="separator" className="pt-spreadmenu__rule" />
          <button
            type="button"
            role="menuitem"
            className="pt-spreadmenu__item pt-spreadmenu__item--danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={18} strokeWidth={1.5} aria-hidden="true" />
            Delete this paper
            <span className="pt-spreadmenu__now">undo for 10 s</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
