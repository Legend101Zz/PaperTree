'use client';

/**
 * board/cards/ExplanationCard — an AI explanation as ask → answer (frame 06): the person's question
 * on the shared call slip when the thread is read, then the shared AI slip with the answer drawn
 * by the explain panel's own model and `AnswerBody` (S4b, #340, v0.3): the section labels, each
 * paragraph with its one quiet source line, the inline figure and typeset maths, but no Check
 * yourself block and no level switch (too heavy in a 328 px card, #349), the same dropping of handles that resolve to nothing, and of an unterminated
 * `[b42, b4…` run at the end of a stopped answer (S9-4). The footer is the shared usage line
 * ("(estimate)"). Until the thread is read, or when it cannot be, the slip shows the answer's words
 * with no source lines and no footer: nothing on the card is invented.
 *
 * A page link opens the reader on its passage and flashes it (`?focus=<card>&cite=<citation>`).
 */
import { AiSlip, CallSlip } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';
import { type ReactNode } from 'react';

import { UsageLine } from '@/features/explain/components/AnswerStates';
import { AnswerBody } from '@/features/explain/components/AnswerBody';
import { buildAnswer, stripPartialTail } from '@/features/explain/model/answer';
import { threadHandles } from '@/features/explain/model/passages';

import { useCanvasActions } from '../BoardContext';
import { CardShell } from './CardShell';
import { ClipBody } from './ClipBody';

import type { PtNode } from '../../model/flow';

/** No thread read yet: no handle resolves, so no source line is drawn. */
const UNREAD = threadHandles([]);

/** An explanation card: an `explanation` row and the thread message it came from. */
export function ExplanationCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
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
    source?.numbers ?? UNREAD,
  );
  return (
    <CardShell id={id} selected={selected} kind="explanation" stock="bare">
      {source?.question === null || source === null ? null : <CallSlip ask={source.question} />}
      <AiSlip
        footer={
          source === null ? undefined : (
            <div className="pt-bc__usage">
              <UsageLine usage={source.run} />
            </div>
          )
        }
      >
        <ClipBody className="pt-bc__answer">
          <AnswerBody
            blocks={model.blocks}
            streaming={false}
            // Before the thread is read there is no evidence either way: nothing is said.
            general={source !== null}
            onShow={(s) => ctx.openCitation?.(id, s.citation.citation_id, source?.threadId)}
          />
        </ClipBody>
      </AiSlip>
    </CardShell>
  );
}
