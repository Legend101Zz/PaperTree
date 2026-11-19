'use client';

/**
 * board/components/tree/AskBox — the ask box on a card (P4 step 8, V3-23, #349).
 *
 * Above the question, the feedforward line: "Uses: this path · the paper · Familiar · may draw a
 * diagram". Each dotted item opens a picker (`UsesPicker`) and says what the AI is about to assume,
 * before the reader sends. A card with no next turn shows only a one-line "Follow up…" stub that
 * grows when focused (#349), so a click on a card never throws a whole form at the reader.
 *
 * The box is a node the layout placed (`useBoardTree`): the card it becomes will have its room.
 */
import { ViewportPortal } from '@xyflow/react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import {
  DIAGRAM_LABELS,
  LEVEL_LABELS,
  PAPER_LABELS,
  isValidQuestion,
  whatTheAiWillRead,
} from '../../model/askPayload';
import { DRAFT_ID } from '../../model/display';
import { branchFor } from '../../model/tree';
import { useBranch } from '../BranchContext';
import { UsesPicker } from './UsesPicker';

import type { PickerName } from '../../model/ui';

const DOTTED: readonly PickerName[] = ['path', 'paper', 'level', 'diagram'];

/** The ask box (and its one-line stub), as the layout placed it. */
export function AskBox(): ReactNode {
  const branch = useBranch();
  const { draft, tree, control, reports } = branch;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const expanded = draft?.expanded === true;
  const picker = control.ui.picker;

  useEffect(() => {
    const el = root.current;
    if (el === null) return undefined;
    const measure = (): void => reports.height(DRAFT_ID, Math.round(el.offsetHeight));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [reports, expanded, picker]);

  // A box opened on purpose takes the keyboard: the reader's next key is their question.
  useEffect(() => {
    if (expanded && picker === null) input.current?.focus({ preventScroll: true });
  }, [expanded, draft?.parentId, draft?.span?.start, draft?.askDifferently, picker]);

  if (draft === null) return null;
  const parent = tree.byId.get(draft.parentId);
  const branchDir = branchFor(tree, draft.parentId, {
    span: draft.span,
    askDifferently: draft.askDifferently,
  });
  const read = whatTheAiWillRead(tree, draft.parentId, draft.uses, {
    span: draft.span,
    askDifferently: draft.askDifferently,
  });
  const down = branchDir === 'down';
  const valid = isValidQuestion(draft.text);
  const submit = (): void => {
    if (valid) void branch.send(draft);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  const placeholder = down
    ? 'Follow up…'
    : parent?.kind === 'excerpt'
      ? 'Ask anything about it.'
      : draft.span !== null
        ? 'Ask about these words…'
        : 'Ask something else about this…';
  const labels: Record<PickerName, string> = {
    path: read.pathLabel,
    paper: PAPER_LABELS[draft.uses.paper],
    level: LEVEL_LABELS[draft.uses.level],
    diagram: DIAGRAM_LABELS[draft.uses.diagram],
  };

  if (!expanded) {
    return (
      <div ref={root} className="pt-ask pt-ask--stub" data-testid="followup-stub">
        <input
          type="text"
          className="pt-ask__input pt-you nodrag"
          data-voice="you"
          aria-label="Follow up"
          placeholder="Follow up…"
          value={draft.text}
          onFocus={() => control.growStub(draft)}
          onChange={(event) => {
            control.growStub({ ...draft, text: event.target.value });
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={root}
      className="pt-ask nodrag nopan nowheel"
      role="group"
      aria-label={down ? 'Follow up on this answer' : 'Ask about this card'}
      data-branch={branchDir}
    >
      <p className="pt-ask__uses" data-testid="uses-line">
        <span className="pt-ask__lead">Uses:</span>{' '}
        {DOTTED.map((name, i) => (
          <span key={name} className="pt-ask__item">
            {i > 0 ? <span aria-hidden="true"> · </span> : null}
            <button
              type="button"
              className="pt-ask__dotted"
              aria-haspopup="dialog"
              aria-expanded={picker === name}
              data-picker={name}
              onClick={() => control.pick(name)}
            >
              {labels[name]}
            </button>
          </span>
        ))}
      </p>
      {draft.span === null ? null : (
        <p className="pt-ask__on">
          on <q className="pt-ask__quote">{draft.span.quote}</q>
        </p>
      )}
      <label className="pt-ask__row">
        <span className="pt-call-slip__stamp pt-tc__stamp" aria-hidden="true">
          M
        </span>
        <input
          ref={input}
          type="text"
          className="pt-ask__input pt-you"
          data-voice="you"
          aria-label="Your question"
          placeholder={placeholder}
          value={draft.text}
          maxLength={2000}
          onChange={(event) => control.setText(event.target.value)}
          onKeyDown={onKey}
        />
      </label>
      <div className="pt-ask__actions">
        {down ? (
          <button
            type="button"
            className="pt-btn pt-btn--primary pt-ask__send"
            aria-disabled={!valid}
            onClick={submit}
          >
            Follow up <kbd aria-hidden="true">Enter</kbd>
          </button>
        ) : (
          <button
            type="button"
            className="pt-btn pt-btn--primary pt-ask__send"
            aria-disabled={!valid}
            onClick={submit}
          >
            Ask <kbd aria-hidden="true">Enter</kbd>
          </button>
        )}
        <span className="pt-ask__esc">
          <kbd aria-hidden="true">Esc</kbd> closes
        </span>
      </div>
      {picker === null ? null : (
        <UsesPicker
          name={picker}
          uses={draft.uses}
          read={read}
          onChange={control.setUses}
          onClose={() => control.pick(null)}
        />
      )}
    </div>
  );
}

/**
 * The ask box on the board, in board coordinates under the same pan and zoom as the cards. It is
 * not a card: it is never selected, dragged, counted or focused as one, and Tidy never moves it.
 *
 * @returns The box where the layout put it, or nothing when no ask is open.
 */
export function AskLayer(): ReactNode {
  const { layout, draft } = useBranch();
  const spot = layout.cards.get(DRAFT_ID);
  if (draft === null || spot === undefined) return null;
  return (
    <ViewportPortal>
      <div
        className="pt-ask-layer nodrag nopan nowheel"
        style={{ left: spot.x, top: spot.y, width: spot.w }}
      >
        <AskBox />
      </div>
    </ViewportPortal>
  );
}
