'use client';

/**
 * The explain panel's composer (moved from `components/explain` with #202): "Ask a follow-up, or
 * any question about the paper", Enter to send, Shift+Enter for a new line. Stop lives on the
 * streaming answer's tab row (#204). A question the server refused before the stream (the daily
 * cap) comes back into the box: "your text is kept in the box below" (frame 04c).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { AskOutcome } from '@/components/explain/useExplainActions';

/** Props for `Composer`. */
export interface ComposerProps {
  /** An answer is streaming: a new question waits for it (Stop is on the answer). */
  readonly busy: boolean;
  /** No server to ask (a sample paper). */
  readonly disabled: boolean;
  /** Send the question; `not-sent` puts it back in the box. */
  readonly onSend: (question: string) => Promise<AskOutcome>;
  /** Focus the box when this changes to a number (the toolbar's Ask opened the panel, #203). */
  readonly focusKey?: number | null;
}

/** The question box at the foot of the panel. */
export function Composer({ busy, disabled, onSend, focusKey }: ComposerProps): ReactNode {
  const [value, setValue] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // Runs before the drawer's own focus effect (children first), which then leaves focus here.
  useEffect(() => {
    if (focusKey !== null && focusKey !== undefined) box.current?.focus({ preventScroll: true });
  }, [focusKey]);
  const submit = (): void => {
    const question = value.trim();
    if (question.length === 0 || busy || disabled) return;
    setValue('');
    void onSend(question).then((outcome) => {
      // Never over words typed since: the refused question returns only to an empty box.
      if (outcome === 'not-sent') setValue((now) => (now === '' ? question : now));
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form
      className="pt-explain__composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="pt-explain__sr" htmlFor="pt-explain-question">
        Ask a question about this paper
      </label>
      <textarea
        ref={box}
        id="pt-explain-question"
        className="pt-field pt-explain__input"
        rows={1}
        maxLength={2000}
        value={value}
        placeholder="Ask a follow-up, or any question about the paper"
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="submit"
        className="pt-btn pt-btn--primary"
        disabled={disabled || busy || value.trim().length === 0}
      >
        Ask
      </button>
    </form>
  );
}
