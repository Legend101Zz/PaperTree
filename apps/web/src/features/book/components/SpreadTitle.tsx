/**
 * SpreadTitle: the opened book's title, which Rename turns into a field in place (v0.3 #337).
 * Enter saves (`PATCH /papers/{id}`), Esc puts the old title back; both leave the editing and
 * Esc stops there, so it never also puts the book back (the one-level rule: the field, then the
 * book). A blank title says so and stays open; a refusal from the server says so in a sentence.
 * While the field is open the heading stays in the page, visually hidden, so the dialog keeps its
 * name.
 */
'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { useRenamePaper } from '../hooks/useBookData';

/** The server's limit (`PaperRename`): 1 to 300 characters after trimming. */
export const TITLE_MAX = 300;

/** Props for `SpreadTitle`. */
export interface SpreadTitleProps {
  readonly paperId: string;
  /** The title now: the parsed one, or the person's. */
  readonly title: string;
  /** The heading's id: the dialog is labelled by it. */
  readonly titleId: string;
  readonly editing: boolean;
  /** Editing ended, saved or not: the menu's button takes focus back. */
  readonly onDone: () => void;
}

/**
 * The title, or its field.
 *
 * @example
 * <SpreadTitle paperId="ppr_1" title="Attention" titleId="t" editing={on} onDone={() => setOn(false)} />
 */
export function SpreadTitle({
  paperId,
  title,
  titleId,
  editing,
  onDone,
}: SpreadTitleProps): ReactNode {
  const rename = useRenamePaper(paperId);
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(title);
  const [problem, setProblem] = useState<string | null>(null);
  // Each time the field opens it starts from the title as it is now, selected.
  useEffect(() => {
    if (!editing) return;
    setDraft(title);
    setProblem(null);
    field.current?.focus({ preventScroll: true });
    field.current?.select();
    // Only the opening: a poll that refreshes the title must not rewrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const save = (): void => {
    const next = draft.trim();
    if (next === '') {
      setProblem('A title cannot be empty.');
      return;
    }
    if (next === title.trim()) {
      onDone();
      return;
    }
    rename.mutate(next, {
      onSuccess: onDone,
      onError: () => setProblem('The title was not changed. Check your connection and try again.'),
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      // Defaults prevented: the book's own Esc handler stands down for this press.
      event.preventDefault();
      onDone();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!rename.isPending) save();
    }
  };
  return (
    <>
      <h2 id={titleId} className={editing ? 'pt-sr-only' : 'pt-bookdetails__title'}>
        {title.trim()}
      </h2>
      {editing ? (
        <div className="pt-bookdetails__rename">
          <textarea
            ref={field}
            className="pt-bookdetails__titlefield"
            aria-label="Title"
            aria-invalid={problem !== null}
            rows={2}
            maxLength={TITLE_MAX}
            value={draft}
            readOnly={rename.isPending}
            onChange={(event) => {
              setDraft(event.target.value.replace(/\s*\n\s*/g, ' '));
              setProblem(null);
            }}
            onKeyDown={onKeyDown}
          />
          <p className="pt-bookdetails__renamehint">Enter saves · Esc cancels</p>
          {problem === null ? null : (
            <p role="alert" className="pt-spread__error">
              {problem}
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
