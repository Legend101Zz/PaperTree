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
 * reachable from here. That is #62 made visible: nothing serves PaperIR over HTTP, so the only
 * implementation today is `fixtureAnswerSource`, and when an endpoint lands the compiler will name
 * every call site that has to change. A default would have hidden exactly that.
 *
 * It does not own scrolling either. `onNavigate` is passed out to `ReaderWorkspace`, which routes
 * it through the `onShowSource` seam Epic 2 declared. **That seam is currently unterminated —
 * `documentRef.current.scrollToBlock` is never assigned anywhere in the app, so the final DOM hop
 * is a no-op today.** That is issue #64, it is Epic 2's file, and this epic files it rather than
 * reaching past its own boundary to fix it. What this component guarantees is everything up to the
 * seam: the citation resolves to the right page and the right polygon, which is the part that
 * determines whether the destination is correct at all.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnswerView } from './AnswerView';
import type { AnswerSource, AskState, Citation, InspectorContext } from './types';

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

      {state.status === 'done' ? (
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
