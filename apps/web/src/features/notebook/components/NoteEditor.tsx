'use client';

/**
 * The in-place editor of a typed note or sticky (S5c, #208). What was typed is committed on blur,
 * Escape or Ctrl/Cmd+Enter, when the editor is unmounted (Back, a route change), when the tab is
 * hidden, and on `pagehide` (the saver makes every open editor commit before it flushes,
 * `hooks/pageLeave.ts`), whichever comes first and only once. A note too long for the browser's
 * keepalive budget cannot be sent while the page closes, so the page warns before it closes then.
 * The text is capped at the API's limit, with a visible count near it, so a note can never be
 * refused for its length. Given `onDelete` (S5e, #210: the phone's stack and touch screens, where a
 * note shows no × of its own), the editor carries a 44 px Delete button: pressing it discards the
 * edit and deletes the note, and moving the keyboard onto it does not end the editing.
 */
import { useEffect, useRef, useState } from 'react';

import { registerEditor } from '../hooks/pageLeave';

import type { ReactNode } from 'react';

/** The API's `NOTEBOOK_BODY_MAX` (services/api `schemas.py`). */
export const NOTE_MAX_CHARS = 100_000;

/** The count appears once the text is this close to the limit. */
const WARN_AT = NOTE_MAX_CHARS - 5_000;

/** Props for `NoteEditor`. */
export interface NoteEditorProps {
  readonly kind: 'text' | 'sticky';
  readonly initial: string;
  /** Called exactly once with the final text. */
  readonly onCommit: (text: string) => void;
  /** Delete the note being edited; draws the editor's Delete button. */
  readonly onDelete?: () => void;
}

/** A textarea that commits its text once, whatever ends the editing. */
export function NoteEditor({ kind, initial, onCommit, onDelete }: NoteEditorProps): ReactNode {
  // The words so far, kept outside the DOM: an unmount clears the textarea ref before it commits.
  const text = useRef(initial);
  const done = useRef(false);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const [length, setLength] = useState(initial.length);
  const finish = (): void => {
    if (done.current) return;
    done.current = true;
    commit.current(text.current);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unregister = registerEditor({
      commit: () => finishRef.current(),
      text: () => text.current,
    });
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') finishRef.current();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unregister();
      document.removeEventListener('visibilitychange', hidden);
      // Unmounted while typing (Back, a route change): keep the words. React's development Strict
      // Mode unmounts and remounts once on purpose, so only an editor still gone a tick later
      // commits.
      alive.current = false;
      setTimeout(() => {
        if (!alive.current) finishRef.current();
      }, 0);
    };
  }, []);

  const label = kind === 'text' ? 'Typed note' : 'Sticky note';
  const textarea = useRef<HTMLTextAreaElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  // Leaving for the editor's own Delete button is not leaving the editing; anywhere else is.
  const leave = (to: EventTarget | null): void => {
    if (to === null || (to !== remove.current && to !== textarea.current)) finish();
  };
  return (
    <>
      <textarea
        ref={textarea}
        className="pt-nb-note__editor"
        aria-label={label}
        data-voice="you"
        defaultValue={initial}
        maxLength={NOTE_MAX_CHARS}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the person just asked to type here
        autoFocus
        onChange={(e) => {
          text.current = e.currentTarget.value;
          setLength(text.current.length);
        }}
        onBlur={(e) => (onDelete === undefined ? finish() : leave(e.relatedTarget))}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {onDelete === undefined ? null : (
        <button
          ref={remove}
          type="button"
          className="pt-nb-note__remove"
          // A press keeps the keyboard in the box: the editing must not end before the click lands.
          onPointerDown={(e) => e.preventDefault()}
          onBlur={(e) => leave(e.relatedTarget)}
          onClick={() => {
            done.current = true; // discarded: the note goes, its unsaved words with it
            onDelete();
          }}
        >
          {`Delete ${kind === 'text' ? 'note' : 'sticky'}`}
        </button>
      )}
      {length < WARN_AT ? null : (
        <p className="pt-nb-note__count" role="status">
          {`${length.toLocaleString('en-US')} / ${NOTE_MAX_CHARS.toLocaleString('en-US')} characters`}
        </p>
      )}
    </>
  );
}
