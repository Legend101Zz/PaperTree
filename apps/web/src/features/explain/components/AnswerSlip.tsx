'use client';

/**
 * One AI answer of an exchange (#202, #204, #340): the `AiSlip` with its paragraphs, each with one
 * quiet source line under it. The interface's own words sit around the AI's: on the tab row (the
 * model, the working label while it streams, "Stopped · M3" after Stop) and outside the slip: Stop (frame 04b), the typed caret, the usage line, Dive in and
 * Send to board on a footer that continues the slip, the note after Stop with Retry (04c), a designed
 * failure (the daily-cap card among them), a refused Retry's note, and, for an answer that opened
 * folded, its two-line preview with Show.
 */
import { AiSlip } from '@papertree/ui';
import { useRef, type ReactNode } from 'react';

import { clipAnswer } from '../model/phone';
import { foldedPreview, wasStopped, type RefusalKind } from '../model/states';
import { shortModelName } from '../model/summary';
import {
  DiveIn,
  FoldRow,
  SendToCanvas,
  Skeleton,
  StopButton,
  StoppedNote,
  type FocusHandoff,
} from './AnswerParts';
import { FailureNote, UsageLine, WorkingLabel } from './AnswerStates';
import { AnswerText, type AnswerTextProps } from './AnswerText';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { AnswerModel, AnswerParagraph } from '../model/exchange';

/** An answer that opened folded: whether it is folded now, and the toggle. */
export interface AnswerFold {
  readonly folded: boolean;
  readonly toggle: () => void;
}

/** The phone sheet's clip (#205): whether the reader asked for the whole answer, and the toggle. */
export interface AnswerClipState {
  readonly expanded: boolean;
  readonly toggle: () => void;
}

/** Props for `AnswerSlip`. */
export interface AnswerSlipProps extends Pick<AnswerTextProps, 'onShow' | 'touch'> {
  readonly answer: ViewMessage;
  /** Null until the answer has text. */
  readonly model: AnswerModel | null;
  readonly onRetry: (key: string) => void;
  /** Stop the answer while it streams. */
  readonly onStop: () => void;
  readonly onSendToCanvas: (messageId: string) => Promise<void>;
  /** Dive in (S5e, #210): open the answer as a notebook page; absent, the footer has no Dive in. */
  readonly onDiveIn?: (messageId: string, exchange: HTMLElement | null) => Promise<void>;
  /** What a refusal of this ask before the stream says was kept, true now (`refusalSentence`). */
  readonly notSent: RefusalKind;
  /** Present when the answer opened folded (an earlier exchange of a reopened thread). */
  readonly fold?: AnswerFold | undefined;
  /** Present on the phone sheet: the first paragraph, then "Read the whole answer" (`clipAnswer`). */
  readonly clip?: AnswerClipState | undefined;
  /** The usage line and Send to board sit in the phone sheet's pinned footer instead. */
  readonly pinned?: boolean;
}

/** The tab row's words: the working label (never "Writing" before a word arrived), or Stopped. */
function metaOf(answer: ViewMessage, streaming: boolean, stopped: boolean, name: string) {
  if (streaming) {
    return <WorkingLabel label={answer.label ?? (answer.text === '' ? 'Starting' : 'Writing')} />;
  }
  return stopped ? `Stopped · ${name}` : undefined;
}

/** The answer on AI-slip stock, and the interface's lines around it. */
export function AnswerSlip({
  answer,
  model,
  onRetry,
  onStop,
  onSendToCanvas,
  onDiveIn,
  notSent,
  fold,
  clip,
  pinned = false,
  ...lights
}: AnswerSlipProps): ReactNode {
  const streaming = answer.status === 'streaming';
  const stopped = wasStopped(answer);
  const handoff: FocusHandoff = useRef(null);
  const article = useRef<HTMLElement | null>(null);
  // The fold never hides an answer that is being written or waits for its stored copy.
  const folded = fold?.folded === true && model !== null && model.live === false;
  const retry = (): void => {
    if (article.current?.contains(document.activeElement) === true) handoff.current = 'stop';
    onRetry(answer.key);
  };
  const lastIndex = model?.paragraphs.at(-1)?.index;
  const paragraph = (p: AnswerParagraph) => (
    <AnswerText
      key={p.index}
      paragraph={p}
      streaming={streaming}
      general={model?.live === false}
      caret={streaming && p.index === lastIndex}
      onShow={lights.onShow}
      {...(lights.touch === undefined ? {} : { touch: lights.touch })}
    />
  );
  const messageId = answer.messageId;
  const canSend = answer.status === 'complete' && messageId !== null && !folded;
  const footer = stopped ? (
    <StoppedNote answer={answer} handoff={handoff} onRetry={retry} />
  ) : pinned || streaming || folded || (answer.usage === null && !canSend) ? undefined : (
    <>
      <UsageLine usage={answer.usage} />
      {canSend ? (
        <div className="pt-exchange__actions">
          {onDiveIn === undefined ? null : (
            <DiveIn
              size={lights.touch === true ? 'touch' : 'md'}
              onDiveIn={(exchange) => onDiveIn(messageId, exchange)}
            />
          )}
          <SendToCanvas onSend={() => onSendToCanvas(messageId)} short={lights.touch === true} />
        </div>
      ) : null}
    </>
  );
  const name = shortModelName(answer.usage?.model);
  const clippable =
    clip !== undefined && model !== null && !folded && clipAnswer(model, false).clipped;
  const expanded = clip?.expanded === true;
  const shown = model === null ? null : clipAnswer(model, !clippable || expanded);
  const body =
    model === null ? (
      <Skeleton />
    ) : folded ? (
      <p className="pt-exchange__preview">{foldedPreview(model.paragraphs)}</p>
    ) : (
      shown?.paragraphs.map(paragraph)
    );
  // One button that swaps its words, so focus stays on it (`aria-expanded` says which).
  const more =
    clippable && clip !== undefined ? (
      <button
        type="button"
        className="pt-exchange__more"
        aria-expanded={expanded}
        onClick={clip.toggle}
      >
        {expanded ? 'Show less' : 'Read the whole answer'}
      </button>
    ) : null;
  // A refused Retry's note replaces the answer's own (its text stays as it was).
  const refused = answer.refusal ?? null;
  const failure = refused ?? answer.failure;
  return (
    <article
      ref={article}
      className="pt-explain__answer pt-exchange__answer"
      data-message-status={answer.status}
    >
      {streaming ? <StopButton handoff={handoff} onStop={onStop} /> : null}
      {model === null && !streaming ? null : (
        <AiSlip
          model={name}
          meta={metaOf(answer, streaming, stopped, name)}
          {...(more === null ? {} : { footer: more })}
        >
          {body}
        </AiSlip>
      )}
      {footer === undefined ? null : <div className="pt-exchange__footer">{footer}</div>}
      {failure !== null && (refused !== null || (!stopped && !streaming)) ? (
        <FailureNote
          failure={failure}
          refusal={refused !== null ? 'retry' : notSent}
          onRetry={answer.status === 'complete' ? undefined : retry}
        />
      ) : null}
      {fold === undefined || model === null ? null : (
        <FoldRow folded={folded} onToggle={fold.toggle} />
      )}
    </article>
  );
}
