'use client';

/**
 * One AI answer of an exchange (#202, #204, #340, v0.3): the `AiSlip` with the tutor-format body
 * (`AnswerBody`: labels, the TL;DR lead, paragraphs each with one quiet source line, the inline
 * figure, Check yourself). The interface's own words sit around the AI's: the level switch above the
 * slip, Go deeper and the foot (model · writing… · Stop, or · stopped) inside it, and outside it the
 * typed caret, the usage line, Dive in and Send to board on a footer that continues the slip, the
 * note after Stop with Retry (04c), a designed failure (the daily-cap card among them), a refused
 * Retry's note, and, for an answer that opened folded, its two-line preview with Show.
 */
import { AiSlip } from '@papertree/ui';
import { useRef, type ReactNode } from 'react';

import { levelOf, type AnswerLevel } from '../model/levels';
import { blocksUpTo, clipAnswer } from '../model/phone';
import { foldedPreview, wasStopped, type RefusalKind } from '../model/states';
import { shortModelName } from '../model/summary';
import {
  DiveIn,
  FoldRow,
  SendToCanvas,
  Skeleton,
  StoppedNote,
  type FocusHandoff,
} from './AnswerParts';
import { AnswerBody, type CheckControl } from './AnswerBody';
import { AnswerFoot } from './AnswerFoot';
import { FailureNote, UsageLine } from './AnswerStates';
import { GoDeeper } from './GoDeeper';
import { LevelSwitch } from './LevelSwitch';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { AnswerTextProps } from './AnswerText';
import type { AnswerModel } from '../model/exchange';

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
  /**
   * The Explain panel's extras. Absent, nothing of them is drawn:
   *  - `onLevel`: the level switch above the slip (a level the exchange holds costs no request);
   *  - `deeper`: the go-deeper chips under the answer (the thread's last answer only);
   *  - `check`: the Check yourself block (never in a small card, #349).
   */
  readonly onLevel?: ((level: AnswerLevel) => void) | undefined;
  readonly deeper?: { readonly onAsk: (question: string) => void } | undefined;
  readonly check?: CheckControl | undefined;
  /** Another answer is being written: the level switch and the chips wait. */
  readonly busy?: boolean;
  /** The thread's last known model, for the foot until this run's usage names its own. */
  readonly modelHint?: string | null;
  /** Counts up when a cached level comes back: the slip fades in once (never typed out again). */
  readonly fade?: number;
}

/** The short model name, or null when this run has not named one and the thread has none. */
function modelName(answer: ViewMessage, hint: string | null): string | null {
  const own = answer.usage?.model;
  return own !== undefined && own !== '' ? shortModelName(own) : hint;
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
  onLevel,
  deeper,
  check,
  busy = false,
  modelHint = null,
  fade = 0,
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
  const quick = answer.quick === true;
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
  const name = modelName(answer, modelHint);
  const clippable =
    clip !== undefined && model !== null && !folded && clipAnswer(model, false).clipped;
  const expanded = clip?.expanded === true;
  const shown = model === null ? null : clipAnswer(model, !clippable || expanded);
  const blocks =
    model === null || shown === null
      ? []
      : shown.clipped
        ? blocksUpTo(model.blocks, shown.paragraphs.length)
        : model.blocks;
  const level = levelOf(answer);
  const settled = answer.status === 'complete' && !stopped && !folded;
  const body =
    model === null ? (
      // A quick ask (a chip, a level switch) skips the thinking pause: no placeholder lines.
      quick ? null : (
        <Skeleton />
      )
    ) : folded ? (
      <p className="pt-exchange__preview">{foldedPreview(model.paragraphs)}</p>
    ) : (
      <>
        <AnswerBody
          blocks={blocks}
          streaming={streaming}
          general={model.live === false}
          caretAt={streaming ? (lastIndex ?? null) : null}
          onShow={lights.onShow}
          {...(lights.touch === undefined ? {} : { touch: lights.touch })}
          check={check}
        />
        {deeper !== undefined && settled && onLevel !== undefined ? (
          <GoDeeper
            level={level}
            onRelevel={onLevel}
            onAsk={deeper.onAsk}
            disabled={busy}
            {...(lights.touch === undefined ? {} : { touch: lights.touch })}
          />
        ) : null}
      </>
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
  // The foot says what is being done; a quick ask never shows the status labels of a long one.
  const working = quick ? null : (answer.label ?? null);
  const foot = (
    <AnswerFoot
      model={name}
      streaming={streaming}
      stopped={stopped}
      label={working ?? (answer.text === '' ? 'starting' : 'writing')}
      handoff={handoff}
      onStop={onStop}
    />
  );
  const footerShown = more !== null || (!folded && (streaming || stopped || name !== null));
  return (
    <article
      ref={article}
      className="pt-explain__answer pt-exchange__answer"
      data-message-status={answer.status}
      data-level={level}
      {...(fade === 0 ? {} : { 'data-fade': fade % 2 === 0 ? 'b' : 'a' })}
    >
      {onLevel === undefined || model === null || folded ? null : (
        <LevelSwitch
          level={level}
          onChange={onLevel}
          disabled={busy || answer.messageId === null}
          {...(lights.touch === undefined ? {} : { touch: lights.touch })}
        />
      )}
      {model === null && !streaming ? null : (
        <AiSlip
          {...(footerShown
            ? {
                footer: (
                  <>
                    {more}
                    {folded ? null : foot}
                  </>
                ),
              }
            : {})}
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
