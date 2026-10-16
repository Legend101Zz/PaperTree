'use client';

/**
 * One AI answer of an exchange (#202): the `AiSlip` with its paragraphs, inline markers and margin
 * cells and the trailing uncited paragraphs under "no citation · the AI's own reading". Around
 * it, in the interface's voice and OUTSIDE the AI's `data-voice` (it is not the AI's text): the
 * working label, the usage line and Send to canvas on a footer that continues the slip, the
 * stopped note with Retry, and a designed failure.
 */
import { AiSlip } from '@papertree/ui';
import { useState, type ReactNode } from 'react';

import { AnswerText, type MarkerHandlers } from './AnswerText';
import { FailureNote, StatusLine, UsageLine } from './AnswerStates';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { AnswerModel } from '../model/exchange';

/** Props for `AnswerSlip`. */
export interface AnswerSlipProps extends Pick<MarkerHandlers, 'lit' | 'onLight' | 'onShow'> {
  readonly answer: ViewMessage;
  /** Null until the answer has text. */
  readonly model: AnswerModel | null;
  readonly onRetry: (key: string) => void;
  readonly onSendToCanvas: (messageId: string) => Promise<void>;
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

/** The answer on AI-slip stock, and the interface's lines around it. */
export function AnswerSlip({
  answer,
  model,
  onRetry,
  onSendToCanvas,
  ...lights
}: AnswerSlipProps): ReactNode {
  const streaming = answer.status === 'streaming';
  const ctx: MarkerHandlers = {
    ...lights,
    handleNumbers: model?.handleNumbers ?? new Map(),
    markers: model?.markers ?? new Map(),
  };
  const paragraph = (p: AnswerModel['body'][number], withMargin: boolean) => (
    <AnswerText
      key={p.index}
      paragraph={p}
      streaming={streaming}
      withMargin={withMargin}
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
  const canSend = answer.status === 'complete' && messageId !== null;
  const footer =
    streaming || (answer.usage === null && !canSend) ? undefined : (
      <>
        <UsageLine usage={answer.usage} />
        {canSend ? <SendToCanvas onSend={() => onSendToCanvas(messageId)} /> : null}
      </>
    );
  const uncited = model?.uncited ?? [];
  return (
    <article className="pt-explain__answer pt-exchange__answer" data-message-status={answer.status}>
      {model === null && !streaming ? null : (
        <AiSlip
          model={modelLabel(answer.usage?.model)}
          source="from the paper"
          headingLevel={3}
          {...(uncited.length > 0 ? { uncited: uncited.map((p) => paragraph(p, false)) } : {})}
        >
          {model === null ? <Skeleton /> : model.body.map(bodyParagraph)}
        </AiSlip>
      )}
      {streaming && answer.label !== null ? <StatusLine label={answer.label} /> : null}
      {footer === undefined ? null : <div className="pt-exchange__footer">{footer}</div>}
      {answer.stopped ? (
        <>
          <p className="pt-explain__note" data-stopped>
            Stopped. The partial answer is kept above.
          </p>
          <div className="pt-explain__actions">
            <button
              type="button"
              className="pt-btn pt-btn--outline"
              onClick={() => onRetry(answer.key)}
            >
              Retry
            </button>
          </div>
        </>
      ) : null}
      {answer.failure !== null && !answer.stopped && !streaming ? (
        <FailureNote
          failure={answer.failure}
          onRetry={answer.status === 'complete' ? undefined : () => onRetry(answer.key)}
        />
      ) : null}
    </article>
  );
}
