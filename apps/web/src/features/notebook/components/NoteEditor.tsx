'use client';

/**
 * The in-place editor of a typed note or sticky (S5c, #208). What was typed is never lost: it is
 * committed on blur, Escape or Ctrl/Cmd+Enter, when the editor is unmounted (Back, a route change),
 * and when the page is being left (`pagehide`, or the tab hidden), whichever comes first and only
 * once. The text is capped at the API's limit, with a visible count near it, so a note can never be
 * refused for its length and loop on "Try again".
 */
import { useEffect, useRef, useState } from 'react';

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
}

/** A textarea that commits its text once, whatever ends the editing. */
export function NoteEditor({ kind, initial, onCommit }: NoteEditorProps): ReactNode {
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
    const leave = (): void => finishRef.current();
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') finishRef.current();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', leave);
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
  return (
    <>
      <textarea
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
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {length < WARN_AT ? null : (
        <p className="pt-nb-note__count" role="status">
          {`${length.toLocaleString('en-US')} / ${NOTE_MAX_CHARS.toLocaleString('en-US')} characters`}
        </p>
      )}
    </>
  );
}
