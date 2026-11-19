'use client';

/**
 * board/cards/AnswerCard — an AI answer on the branching board (P4 steps 8 and 9, V3-28): the
 * question on its call-slip strip (the handle the card is dragged by), then the answer in the
 * tutor format, compact: section labels, maths and the inline figure, no level switch and no Check
 * block, shown in full up to the 60% cap and then scrolling inside.
 *
 * Words the answer has branches from stay underlined with a count knot in the right padding. Select
 * words and the span menu opens (`SpanMenu`). The foot: the model, "writing… · Stop" while it
 * streams, the page it draws on ("p. 3", which opens the paper and flashes the passage), Fold, and,
 * when the answer stopped short, "Try again", and, when it already has a next turn, "Ask differently".
 */
import { type NodeProps } from '@xyflow/react';
import { useRef, type ReactNode } from 'react';

import { AnswerBody } from '@/features/explain/components/AnswerBody';

import { locateQuote } from '../../model/spans';
import { branchCounts, childrenOf, countsPhrase, downChild, spanKnots } from '../../model/tree';
import { useBranch } from '../BranchContext';
import { answerView } from '../tree/answerView';
import { BranchCard } from '../tree/BranchCard';
import { Pill } from '../tree/Pill';
import { selectedWords } from '../tree/spansDom';
import { useSpanMarks } from '../tree/useSpanMarks';

import type { PtNode } from '../../model/flow';

/** The M stamp on the question strip: the reader's own mark (decoration). */
function Stamp(): ReactNode {
  return (
    <span className="pt-call-slip__stamp pt-tc__stamp" aria-hidden="true">
      M
    </span>
  );
}

/** An answer card: an `explanation` row. */
export function AnswerCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const branch = useBranch();
  const node = data.node;
  const body = useRef<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const stream = branch.streams.get(id);
  const live = stream?.status === 'writing';
  const text =
    stream !== undefined && stream.text !== '' ? stream.text : (node.final_text ?? node.body);
  const state = live
    ? 'live'
    : stream?.status === 'stopped' || stream?.status === 'error'
      ? 'cut'
      : 'done';
  // An answer that stopped short can be asked again (rule 6: replaced in place, or a sibling).
  const cut =
    !live &&
    (stream !== undefined
      ? stream.status === 'error' || stream.status === 'stopped' || stream.status === 'partial'
      : node.answer_status === 'error' ||
        node.answer_status === 'aborted' ||
        node.answer_status === 'partial');
  // The citations ride on the board's own read of the node (no thread scan), the live ones while it streams.
  const citations = stream?.citations ?? node.citations ?? [];
  const view = answerView(id, text, state, citations);
  const question = (node.question ?? node.title ?? '').trim();
  const folded = node.folded === true;
  const knots = spanKnots(branch.tree, id);
  const placed = useSpanMarks(id, root, body, text, knots, branch.reports);
  const hasNext = downChild(branch.tree, id) !== undefined;
  const kids = childrenOf(branch.tree, id);
  const placedCard = branch.layout.cards.get(id);

  if (folded && placedCard?.pill != null) {
    return (
      <Pill
        id={id}
        label={question === '' ? 'Answer' : question}
        count={placedCard.pill.label}
        onUnfold={() => branch.fold(id, false)}
      />
    );
  }

  const onSelectWords = (el: HTMLElement): void => {
    const picked = selectedWords(el);
    const stage = branch.stage.current;
    if (picked === null || stage === null || live) {
      if (branch.control.ui.menu?.cardId === id) branch.control.openMenu(null);
      return;
    }
    const located = locateQuote(text, picked.quote, picked.nth);
    if (located === null) return;
    const box = stage.getBoundingClientRect();
    branch.control.openMenu({
      cardId: id,
      span: { start: located.start, end: located.end, quote: located.quote },
      anchor: {
        x: picked.last.left - box.left,
        y: picked.last.top - box.top,
        w: picked.last.width,
        h: picked.last.height,
      },
    });
  };

  const counts = kids.length > 0 ? countsPhrase(branchCounts(branch.tree, id)) : null;

  return (
    <BranchCard
      id={id}
      kind="explanation"
      stock="answer"
      label={question === '' ? 'AI answer' : `AI answer to: ${question}`}
      selected={selected}
      characters={view.characters}
      bodyRef={body}
      rootRef={root}
      onSelectWords={onSelectWords}
      overlay={
        <>
          {placed.map(({ knot, y }) => (
            <button
              key={`${String(knot.start)}:${String(knot.end)}`}
              type="button"
              className="pt-tc__knot nodrag"
              style={{ insetBlockStart: y }}
              aria-label={`${String(knot.count)} ${knot.count === 1 ? 'branch starts' : 'branches start'} at “${knot.quote}”`}
              onClick={(event) => {
                event.stopPropagation();
                const first = knot.childIds[0];
                if (first !== undefined) branch.control.focus(first);
              }}
            >
              {knot.count}
            </button>
          ))}
        </>
      }
      strip={
        <>
          <Stamp />
          <span className="pt-tc__q">{question === '' ? 'Answer' : question}</span>
        </>
      }
      foot={
        <>
          <span className="pt-tc__ai">AI</span>
          {node.model != null && node.model !== '' ? (
            <span className="pt-tc__model">{node.model}</span>
          ) : null}
          {live ? (
            <>
              <span className="pt-tc__state" role="status">
                writing…
              </span>
              <button type="button" className="pt-tc__act" onClick={() => branch.stop(id)}>
                Stop
              </button>
            </>
          ) : stream?.status === 'stopped' ? (
            <span className="pt-tc__state">stopped</span>
          ) : null}
          {view.pages.slice(0, 2).map((s) => (
            <button
              key={s.page}
              type="button"
              className="pt-tc__src"
              aria-label={`Show p. ${String(s.page)} in the paper`}
              onClick={() => branch.openSource(id, s.citation.citation_id)}
            >
              p. {s.page}
            </button>
          ))}
          <span className="pt-tc__grow" />
          {cut && question !== '' ? (
            <button type="button" className="pt-tc__act" onClick={() => void branch.retry(id)}>
              Try again
            </button>
          ) : null}
          {hasNext ? (
            <button
              type="button"
              className="pt-tc__act"
              onClick={() => branch.control.openAsk(id, { askDifferently: true })}
            >
              Ask differently
            </button>
          ) : null}
          {kids.length > 0 ? (
            <button
              type="button"
              className="pt-tc__act"
              title={`Fold this branch into a pill: ${counts ?? ''}`}
              onClick={() => branch.fold(id, true)}
            >
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                <path d="M5 12l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              Fold
            </button>
          ) : null}
        </>
      }
    >
      <div className="pt-tc__answer" data-voice="ai">
        {live && stream?.thinking === true && text === '' ? (
          <div className="pt-tc__think" role="status" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <AnswerBody
          blocks={view.model.blocks}
          streaming={live}
          general={false}
          onShow={(s) => branch.openSource(id, s.citation.citation_id)}
        />
        {stream?.failure != null ? <p className="pt-tc__fail">{stream.failure}</p> : null}
      </div>
    </BranchCard>
  );
}
