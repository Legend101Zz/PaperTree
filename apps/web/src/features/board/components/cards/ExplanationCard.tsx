'use client';

/**
 * board/cards/ExplanationCard — an AI explanation as ask → answer (frame 06): the person's question
 * on the shared call slip when the thread is read, then the shared AI slip with the answer drawn
 * by the explain panel's own model and `AnswerText` (S4b): the same passage numbers, the same
 * markers, the same dropping of handles that resolve to nothing, and of an unterminated `[b42, b4…`
 * run at the end of a stopped answer (S9-4). The footer is the stored message's coverage and the
 * shared usage line ("(estimate)"). Until the thread is read, or when it cannot be, the slip shows
 * the answer's words with no markers and no footer: nothing on the card is invented.
 *
 * A marker opens the reader on its passage and flashes it (`?focus=<card>&cite=<citation>`).
 */
import { AiSlip, CallSlip } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';
import { useState, type ReactNode } from 'react';

import { stripPartialTail } from '@/components/explain/RichText';
import { UsageLine } from '@/features/explain/components/AnswerStates';
import { AnswerText } from '@/features/explain/components/AnswerText';
import { buildAnswer, type AnswerParagraph } from '@/features/explain/model/answer';
import { numberPassages } from '@/features/explain/model/passages';

import { coverageLine } from '../../model/cards';
import { useCanvasActions } from '../BoardContext';
import { CardShell } from './CardShell';
import { ClipBody } from './ClipBody';

import type { PtNode } from '../../model/flow';

/** No thread read yet: nothing is numbered, so no marker is drawn. */
const UNNUMBERED = numberPassages([]);

/** An explanation card: an `explanation` row and the thread message it came from. */
export function ExplanationCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
  const [lit, setLit] = useState<number | null>(null);
  const node = data.node;
  const source = ctx.sources?.explanations.get(node.source_message_id ?? '') ?? null;
  const text = stripPartialTail(node.body);
  const model = buildAnswer(
    source === null
      ? {
          key: id,
          role: 'assistant',
          text,
          status: 'complete',
          citations: [],
          question: '',
          createdAt: null,
        }
      : { ...source.answer, text },
    source?.numbers ?? UNNUMBERED,
  );
  // Before the thread is read nothing is called uncited: there is no evidence either way.
  const body = source === null ? [...model.body, ...model.uncited] : model.body;
  const uncited = source === null ? [] : model.uncited;
  const coverage = coverageLine(source?.answer.coverage ?? null);
  const paragraph = (p: AnswerParagraph): ReactNode => (
    <AnswerText
      key={p.index}
      paragraph={p}
      streaming={false}
      withMargin={false}
      handleNumbers={model.handleNumbers}
      markers={model.markers}
      lit={lit}
      onLight={setLit}
      onShow={(marker) => ctx.openCitation?.(id, marker.citation.citation_id, source?.threadId)}
    />
  );
  return (
    <CardShell id={id} selected={selected} kind="explanation" stock="bare">
      {source?.question === null || source === null ? null : <CallSlip ask={source.question} />}
      <AiSlip
        footer={
          source === null ? undefined : (
            <div className="pt-bc__usage">
              {coverage === null ? null : <p>{coverage}</p>}
              <UsageLine usage={source.run} />
            </div>
          )
        }
      >
        <ClipBody className="pt-bc__answer">
          {body.map(paragraph)}
          {uncited.length === 0 ? null : (
            <div className="pt-ai-slip__uncited">
              <p className="pt-ai-slip__uncited-head">no citation · the AI&apos;s own reading</p>
              <div className="pt-ai-slip__uncited-body">{uncited.map(paragraph)}</div>
            </div>
          )}
        </ClipBody>
      </AiSlip>
    </CardShell>
  );
}
