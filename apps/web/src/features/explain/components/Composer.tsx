'use client';

/**
 * The explain panel's composer (moved from `components/explain` with #202): "Ask a follow-up, or
 * any question about the paper", Enter to send, Shift+Enter for a new line, and Stop in place of
 * Ask while an answer streams.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';

/** Props for `Composer`. */
export interface ComposerProps {
  /** An answer is streaming: Ask becomes Stop. */
  readonly busy: boolean;
  /** No server to ask (a sample paper). */
  readonly disabled: boolean;
  readonly onSend: (question: string) => void;
  readonly onStop: () => void;
}

/** The question box at the foot of the panel. */
export function Composer({ busy, disabled, onSend, onStop }: ComposerProps): ReactNode {
  const [value, setValue] = useState('');
  const submit = (): void => {
    const question = value.trim();
    if (question.length === 0 || busy || disabled) return;
    onSend(question);
    setValue('');
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
      {busy ? (
        <button type="button" className="pt-btn pt-btn--outline" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button
          type="submit"
          className="pt-btn pt-btn--primary"
          disabled={disabled || value.trim().length === 0}
        >
          Ask
        </button>
      )}
    </form>
  );
}
