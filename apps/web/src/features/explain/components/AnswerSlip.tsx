'use client';

/**
 * One AI answer of an exchange (#202, #204): the `AiSlip` with its paragraphs, inline markers and
 * margin cells and the trailing uncited paragraphs under "no citation · the AI's own reading".
 * Around it, in the interface's voice and OUTSIDE the AI's `data-voice` (it is not the AI's text):
 * the working label and Stop on the tab row while it streams (frame 04b), the typed caret, the
 * usage line and Send to canvas on a footer that continues the slip, the note after Stop with Retry
 * (04c), a designed failure (the daily-cap card among them), and, for an answer that opened
 * folded, its two-line preview with Show.
 */
import { AiSlip } from '@papertree/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { foldedCounts, foldedPreview, stoppedNote, wasStopped } from '../model/states';
import { FailureNote, UsageLine, WorkingLabel } from './AnswerStates';
import { AnswerText, type MarkerHandlers } from './AnswerText';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { AnswerModel } from '../model/exchange';

/** An answer that opened folded: whether it is folded now, and the toggle. */
export interface AnswerFold {
  readonly folded: boolean;
  readonly toggle: () => void;
}

/** Props for `AnswerSlip`. */
export interface AnswerSlipProps extends Pick<MarkerHandlers, 'lit' | 'onLight' | 'onShow'> {
  readonly answer: ViewMessage;
  /** Null until the answer has text. */
  readonly model: AnswerModel | null;
  readonly onRetry: (key: string) => void;
  /** Stop the answer while it streams. */
  readonly onStop: () => void;
  readonly onSendToCanvas: (messageId: string) => Promise<void>;
  /** The ask was typed in the composer, which keeps the text when the server refuses it. */
  readonly typed: boolean;
  /** Present when the answer opened folded (an earlier exchange of a reopened thread). */
  readonly fold?: AnswerFold | undefined;
}

/** `MiniMax-M3.1-Flash-Preview` → `M3.1 Flash`, the design's short name; the vendor is implied. */
function modelLabel(model: string | undefined): string {
  if (model === undefined || model === '') return 'AI model';
  return model
    .replace(/^MiniMax-/i, '')
    .replace(/-Preview$/i, '')
    .replace(/-/g, ' ');
}

function Skeleton(): ReactNode {
  return (
    <div className="pt-explain__skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

const UNCITED = "no citation · the AI's own reading";

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

function SendToCanvas({ onSend }: { onSend: () => Promise<void> }): ReactNode {
  const [send, setSend] = useState<SendState>('idle');
  const label =
    send === 'sending' ? 'Sending…' : send === 'sent' ? 'Sent to canvas' : 'Send to canvas';
  return (
    <div className="pt-explain__actions">
      <button
        type="button"
        className="pt-btn pt-btn--outline"
        disabled={send === 'sending' || send === 'sent'}
        onClick={() => {
          setSend('sending');
          onSend().then(
            () => setSend('sent'),
            () => setSend('failed'),
          );
        }}
      >
        {label}
      </button>
      {send === 'failed' ? (
        <span className="pt-explain__note" role="alert">
          Couldn&apos;t send this to the canvas. Try again.
        </span>
      ) : null}
    </div>
  );
}

/** The note after Stop, Retry beside it (focus moves there when Stop had it), and the usage. */
function Stopped({
  answer,
  onRetry,
  focus,
}: {
  answer: ViewMessage;
  onRetry: () => void;
  focus: boolean;
}) {
  const retry = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focus) retry.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <>
      <div className="pt-exchange__stopped">
        <p className="pt-exchange__stopped-note" data-stopped>
          {stoppedNote(answer.text)}
        </p>
        <button ref={retry} type="button" className="pt-btn pt-btn--outline" onClick={onRetry}>
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
            <path
              d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M14 3.5v3h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          Retry
        </button>
      </div>
      <UsageLine usage={answer.usage} />
    </>
  );
}

/** The answer on AI-slip stock, and the interface's lines around it. */
export function AnswerSlip({
  answer,
  model,
  onRetry,
  onStop,
  onSendToCanvas,
  typed,
  fold,
  ...lights
}: AnswerSlipProps): ReactNode {
  const streaming = answer.status === 'streaming';
  const stopped = wasStopped(answer);
  const stopHadFocus = useRef(false);
  const folded = fold?.folded === true && model !== null;
  const ctx: MarkerHandlers = {
    ...lights,
    handleNumbers: model?.handleNumbers ?? new Map(),
    markers: model?.markers ?? new Map(),
  };
  const lastIndex = model?.body.at(-1)?.index;
  const paragraph = (p: AnswerModel['body'][number], withMargin: boolean) => (
    <AnswerText
      key={p.index}
      paragraph={p}
      streaming={streaming}
      withMargin={withMargin}
      caret={streaming && p.index === lastIndex}
      {...ctx}
    />
  );
  // An uncited paragraph between cited ones keeps its place, under the same label (§4.7).
  const bodyParagraph = (p: AnswerModel['body'][number]) =>
    p.cited ? (
      paragraph(p, true)
    ) : (
      <div key={p.index} className="pt-ai-slip__uncited pt-exchange__uncited-inline">
        <h3 className="pt-ai-slip__uncited-head">{UNCITED}</h3>
        <div className="pt-ai-slip__uncited-body">{paragraph(p, false)}</div>
      </div>
    );
  const messageId = answer.messageId;
  const canSend = answer.status === 'complete' && messageId !== null && !folded;
  const footer = stopped ? (
    <Stopped answer={answer} onRetry={() => onRetry(answer.key)} focus={stopHadFocus.current} />
  ) : streaming || folded || (answer.usage === null && !canSend) ? undefined : (
    <>
      <UsageLine usage={answer.usage} />
      {canSend ? <SendToCanvas onSend={() => onSendToCanvas(messageId)} /> : null}
    </>
  );
  const name = modelLabel(answer.usage?.model);
  const uncited = folded ? [] : (model?.uncited ?? []);
  const meta = streaming ? (
    <WorkingLabel label={answer.label ?? 'Writing'} />
  ) : stopped ? (
    `Stopped · ${name}`
  ) : undefined;
  const body =
    model === null ? (
      <Skeleton />
    ) : folded ? (
      <p className="pt-exchange__preview">{foldedPreview(model.body)}</p>
    ) : (
      model.body.map(bodyParagraph)
    );
  return (
    <article className="pt-explain__answer pt-exchange__answer" data-message-status={answer.status}>
      {streaming ? (
        <button
          type="button"
          className="pt-btn pt-btn--outline pt-exchange__stop"
          onClick={(event) => {
            stopHadFocus.current = document.activeElement === event.currentTarget;
            onStop();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
            <rect x="5.5" y="5.5" width="9" height="9" rx="1" fill="currentColor" />
          </svg>
          Stop
        </button>
      ) : null}
      {model === null && !streaming ? null : (
        <AiSlip
          model={name}
          source="from the paper"
          headingLevel={3}
          meta={meta}
          {...(uncited.length > 0 ? { uncited: uncited.map((p) => paragraph(p, false)) } : {})}
        >
          {body}
        </AiSlip>
      )}
      {footer === undefined ? null : <div className="pt-exchange__footer">{footer}</div>}
      {answer.failure !== null && !stopped && !streaming ? (
        <FailureNote
          failure={answer.failure}
          kept={typed}
          onRetry={answer.status === 'complete' ? undefined : () => onRetry(answer.key)}
        />
      ) : null}
      {fold === undefined || model === null ? null : (
        <div className="pt-exchange__fold">
          {fold.folded ? <span>{foldedCounts(model.coverage)}</span> : null}
          <button
            type="button"
            className="pt-exchange__fold-toggle"
            aria-expanded={!fold.folded}
            onClick={fold.toggle}
          >
            {fold.folded ? 'Show' : 'Fold'}
          </button>
        </div>
      )}
    </article>
  );
}
