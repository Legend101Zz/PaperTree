/**
 * The Inspector — F3.6, filling the slot Epic 2 left at `ReaderWorkspace.tsx:289`.
 *
 * That slot was left as an absence rather than a stub on purpose ("a placeholder that appears to
 * work is worse than an absence that is honest"), so this component is an addition and nothing had
 * to be rearranged to land it.
 *
 * SIX CONTEXTUAL VARIANTS, and they are a discriminated union rather than six optional props. The
 * union is what makes "the equation variant with no equation" unrepresentable; six optional props
 * would make it merely unlikely, and Epic 2's post-mortem is four instances of "merely unlikely"
 * happening.
 *
 * WHAT THIS COMPONENT DELIBERATELY DOES NOT DO
 *
 * It does not fetch. `AnswerSource` is a REQUIRED prop and there is no default implementation
 * reachable from here. That was #62 made visible, and the prediction held: when `POST
 * /papers/{id}/ask` landed (#76) the compiler named the one call site that had to change —
 * `ReaderWorkspace`'s Inspector slot — and nothing in this file moved. There are two
 * implementations now, `liveAnswerSource` and `fixtureAnswerSource`, and this component still
 * cannot tell them apart. A default prop would have hidden exactly that.
 *
 * It does not own scrolling either. `onNavigate` is passed out to `ReaderWorkspace`, which routes
 * it through the `onShowSource` seam Epic 2 declared. That seam was unterminated when this
 * component was written — `documentRef.current.scrollToBlock` was never assigned anywhere in the
 * app, so the final DOM hop was a no-op, which was issue #64. **#64 is closed** and the click now
 * moves the page; `test/citation-scroll.spec.tsx` asserts the whole chain from the click to the
 * scroller's imperative handle. What this component guarantees is unchanged and is still the part
 * that decides whether the destination is correct at all: the citation resolves to the right page
 * and the right polygon.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnswerView } from './AnswerView';
import type {
  AnswerSource,
  AskState,
  Citation,
  GroundedAnswer,
  InspectorContext,
} from './types';

export interface InspectorProps {
  /** What the reader is asking about. */
  readonly context: InspectorContext;
  /** Where answers come from. REQUIRED — see the header. */
  readonly answerSource: AnswerSource;
  readonly paperId: string;
  /** Navigate to a cited region. REQUIRED. */
  readonly onNavigate: (citation: Citation) => void;
  /** Navigate to a derived block's sources. REQUIRED (`DerivedBlock` demands it). */
  readonly onShowSource: (blockIds: readonly string[]) => void;
}

/** The prompt each contextual variant opens with. */
const VARIANT_PROMPT: Readonly<Record<InspectorContext['kind'], string>> = {
  selection: 'Explain this selection',
  equation: 'Explain this equation',
  figure: 'Explain this figure',
  table: 'Explain this table',
  citation: 'What does this citation refer to?',
  answer: 'Ask a follow-up',
};

/** A short human label for the thing in context, used in the panel heading. */
function contextLabel(context: InspectorContext): string {
  switch (context.kind) {
    case 'selection':
      return context.quote.length > 60 ? `${context.quote.slice(0, 60)}…` : context.quote;
    case 'equation':
      return 'Equation';
    case 'figure':
      return 'Figure';
    case 'table':
      return 'Table';
    case 'citation':
      return 'Citation';
    case 'answer':
      return 'Answer';
  }
}

/**
 * Can this answer be rendered at all?
 *
 * The single condition `DerivedBlock` enforces by throwing, asked one frame earlier so the throw
 * becomes a designed state instead of a blank panel. Exported so a test can assert the two halves
 * separately: that `AnswerView` still throws for such an answer (the guard is load-bearing, not
 * decorative) and that `Inspector` shows the designed state instead of reaching it.
 */
export function isRenderable(answer: GroundedAnswer): boolean {
  return answer.supportingBlockIds.length > 0;
}

export function Inspector({
  context,
  answerSource,
  paperId,
  onNavigate,
  onShowSource,
}: InspectorProps): ReactNode {
  const [state, setState] = useState<AskState>(
    // An `answer` context arrives already answered — the panel is being shown a result rather than
    // being asked to fetch one.
    context.kind === 'answer' ? { status: 'done', answer: context.answer } : { status: 'idle' },
  );

  // One in-flight ask at a time. The controller is aborted on unmount and before each new ask, so
  // a slow answer for a selection the reader has moved on from cannot overwrite a newer one.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const ask = useCallback(
    (question: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ status: 'streaming', partial: '' });

      answerSource
        .ask({ question, context, paperId }, (text) => {
          if (controller.signal.aborted) return;
          setState({ status: 'streaming', partial: text });
        }, controller.signal)
        .then((answer) => {
          if (controller.signal.aborted) return;
          setState({ status: 'done', answer });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          // Surfaced, never swallowed. The epic's rule is that failed generations are never
          // persisted as content; the reader-facing half of that is that they are never silently
          // dropped either.
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'The answer could not be generated.',
          });
        });
    },
    [answerSource, context, paperId],
  );

  return (
    <div className="pt-inspector" data-inspector data-inspector-context={context.kind}>
      <header className="pt-inspector__header">
        <h2 className="pt-inspector__title">{contextLabel(context)}</h2>
      </header>

      {state.status === 'idle' ? (
        <button
          type="button"
          className="pt-inspector__ask"
          data-inspector-ask
          onPointerUp={() => {
            ask(VARIANT_PROMPT[context.kind]);
          }}
          onClick={(event) => {
            // Keyboard activation only; a pointer click already fired onPointerUp.
            if (event.detail === 0) ask(VARIANT_PROMPT[context.kind]);
          }}
        >
          {VARIANT_PROMPT[context.kind]}
        </button>
      ) : null}

      {state.status === 'streaming' ? (
        // aria-live so the answer is announced as it arrives rather than only at the end. Polite
        // rather than assertive: a streaming answer that interrupts the reader mid-sentence is
        // worse than one that waits for a pause.
        <div
          className="pt-inspector__streaming"
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-inspector-streaming
        >
          {state.partial}
        </div>
      ) : null}

      {state.status === 'done' && !isRenderable(state.answer) ? (
        // THE DESIGNED FAILURE STATE FOR AN UNGROUNDED ANSWER (§19.8 — every state is a designed
        // screen, and "AI actions … visibly disabled with the reason, not silently broken" is the
        // register).
        //
        // `DerivedBlock` THROWS on an empty `derivedFrom`, and `AnswerView` passes
        // `supportingBlockIds` into it eleven times over. That throw is correct and is deliberately
        // not guarded away: `?? []`, `|| []` or a try/catch that renders anyway would each ship
        // unattributed derived content, which is the one thing §11.4 exists to make impossible.
        // What is wrong is the throw reaching the user as a blank panel or a React error overlay.
        // So this checks BEFORE rendering and shows a state that was designed, with the reason.
        //
        // The server already refuses to produce such an answer (`GroundedAnswer.__post_init__`
        // raises, and `/ask` answers 502). This is not redundant with that: `AnswerSource` is an
        // interface anyone can implement, and the `answer` context variant arrives ALREADY
        // answered from outside this component.
        <div
          className="pt-inspector__error"
          role="alert"
          data-inspector-error
          data-inspector-ungrounded
        >
          This answer named no source block, so it is not shown. Derived content that cannot name
          its source must not render at all — you would have no way to check it against the paper.
        </div>
      ) : null}

      {state.status === 'done' && isRenderable(state.answer) ? (
        <AnswerView answer={state.answer} onNavigate={onNavigate} onShowSource={onShowSource} />
      ) : null}

      {state.status === 'error' ? (
        <div className="pt-inspector__error" role="alert" data-inspector-error>
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
