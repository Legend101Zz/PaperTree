'use client';

/**
 * The explain panel's composer (moved from `components/explain` with #202): "Ask a follow-up, or
 * any question about the paper", Enter to send, Shift+Enter for a new line. Stop lives on the
 * streaming answer's tab row (#204). Its text is the controller's (`state.draft`), so it outlives
 * the composer, and a question the server refused before the stream comes back into it (04c).
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import type { AskOutcome } from '@/components/explain/useExplainActions';

/** Props for `Composer`. */
export interface ComposerProps {
  /** An answer is streaming: a new question waits for it (Stop is on the answer). */
  readonly busy: boolean;
  /** No server to ask (a sample paper). */
  readonly disabled: boolean;
  /** The box's text (the controller's draft). */
  readonly value: string;
  readonly onChange: (text: string) => void;
  /** Send the question; the controller puts a refused one back into the draft. */
  readonly onSend: (question: string) => Promise<AskOutcome>;
  /** Focus the box when this changes to a number (the toolbar's Ask opened the panel, #203). */
  readonly focusKey?: number | null;
  /** The box's hint; the phone sheet's is shorter ("Ask a follow-up", frame 08b). */
  readonly placeholder?: string;
}

/** The question box at the foot of the panel. */
export function Composer({
  busy,
  disabled,
  value,
  onChange,
  onSend,
  focusKey,
  placeholder = 'Ask a follow-up, or any question about the paper',
}: ComposerProps): ReactNode {
  const box = useRef<HTMLTextAreaElement>(null);
  // Runs before the drawer's own focus effect (children first), which then leaves focus here.
  useEffect(() => {
    if (focusKey !== null && focusKey !== undefined) box.current?.focus({ preventScroll: true });
  }, [focusKey]);
  const submit = (): void => {
    const question = value.trim();
    if (question.length === 0 || busy || disabled) return;
    onChange('');
    void onSend(question);
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
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
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
