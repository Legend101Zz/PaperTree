'use client';

/**
 * Check yourself (v0.3 answer format §1, prototype "check yourself · optional"): one sentence with
 * one blank, marked here with no model call. Enter checks the fill; a wrong one shows the hint and
 * keeps the blank open; Show me fills it; Skip folds the block to "Skipped. Bring it back". It never
 * blocks reading or the ask box, and it is drawn only in the Explain panel: in a small board card it
 * is too heavy (#349), so the cards pass no check state and this is never mounted there.
 *
 * Keyboard: the blank is a real input, the links are real buttons, Enter checks, and Esc backs out
 * one level (the block -> the panel; a second Esc closes the panel, which is the panel's own).
 * The state is the parent's (`CheckState`), so it survives a level switch and its cross-fade.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { parseMarkdown } from '@/lib/markdown';

import {
  showCheck,
  splitPrompt,
  submitCheck,
  typeCheck,
  type CheckSpec,
  type CheckState,
} from '../model/check';
import { renderInline } from './AnswerText';

/** Props for `CheckYourself`. */
export interface CheckYourselfProps {
  readonly spec: CheckSpec;
  readonly state: CheckState;
  readonly onChange: (next: CheckState) => void;
}

/** A line of the check as inline content: maths typeset, no handles, no block furniture. */
function Line({ text }: { readonly text: string }): ReactNode {
  const first = parseMarkdown(text).find((b) => b.k === 'p');
  return first?.k === 'p'
    ? first.lines.map((line, i) => <span key={i}>{renderInline(line)}</span>)
    : text;
}

/** The check block under the answer. */
export function CheckYourself({ spec, state, onChange }: CheckYourselfProps): ReactNode {
  const group = useRef<HTMLDivElement | null>(null);
  const { before, after } = splitPrompt(spec.prompt);
  const closed = state.phase === 'right' || state.phase === 'shown';
  const asking = state.phase === 'idle' || state.phase === 'wrong';

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    // One level out: from the block to the panel. The panel's own Esc (the next press) closes it,
    // so this one is not allowed through.
    event.stopPropagation();
    event.preventDefault();
    const panel =
      group.current?.closest<HTMLElement>('[data-explain-panel]') ??
      group.current?.closest<HTMLElement>('.pt-explain__body');
    if (panel === null || panel === undefined) return;
    if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
    panel.focus({ preventScroll: true });
  };

  return (
    // The group is not a control: it only catches Esc from the controls inside it, to back out one
    // level (the block -> the panel), so the lint rule for handlers on static elements is off here.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={group}
      className="pt-check"
      role="group"
      aria-label="Check yourself"
      data-check-phase={state.phase}
      onKeyDown={onKeyDown}
    >
      <span className="pt-ai-label">
        check yourself <span className="pt-ai-label__note">· optional</span>
      </span>
      {state.phase === 'skipped' ? (
        <p className="pt-source">
          Skipped.{' '}
          <button
            type="button"
            className="pt-answer-link"
            onClick={() => onChange({ ...state, phase: 'idle' })}
          >
            Bring it back
          </button>
        </p>
      ) : (
        <div className="pt-check__box">
          <p>
            <Line text={before} />
            <label>
              <span className="pt-sr-only">Fill the blank</span>
              <input
                type="text"
                className="pt-check__blank"
                value={state.value}
                readOnly={closed}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => onChange(typeCheck(state, event.target.value))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(submitCheck(spec, state));
                }}
              />
            </label>
            <Line text={after} />
          </p>
          {closed && spec.right !== '' ? (
            <p role="status">
              <Line text={spec.right} />
            </p>
          ) : null}
          {state.phase === 'wrong' && spec.hint !== '' ? (
            <p className="pt-check__hint" role="status">
              Not quite. <Line text={spec.hint} />
            </p>
          ) : null}
          {asking ? (
            <div className="pt-check__row">
              <span className="pt-check__keys">
                <kbd>Enter</kbd>to check
              </span>
              <button
                type="button"
                className="pt-answer-link"
                onClick={() => onChange(showCheck(spec))}
              >
                Show me
              </button>
              <button
                type="button"
                className="pt-answer-link pt-answer-link--quiet"
                onClick={() => onChange({ ...state, phase: 'skipped' })}
              >
                Skip
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
