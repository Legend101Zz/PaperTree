'use client';

/**
 * board/cards/ExplanationCard — an AI explanation as ask → answer (frame 06): the call slip with
 * the person's question when the thread is read, then the AI slip with the answer, each claim
 * ending in its passage's numbered marker, and the footer lines from the stored message (coverage,
 * usage "(estimate)"). Until the thread is read, or when it cannot be, the slip shows the answer's
 * words with no markers and no footer: nothing on the card is invented.
 *
 * A marker opens the reader on its passage and flashes it (`?focus=<card>&cite=<citation>`).
 */
import { AiSlip, NumberedMarker, YouText, formatPageLabel } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';
import { Fragment, type ReactNode } from 'react';

import { dehyphenate, parseMarkdown, type Inline } from '@/lib/markdown';

import { coverageLine, passageKey, usageLine, type ExplanationSource } from '../../model/cards';
import { useCanvasActions } from '../BoardContext';
import { CardShell, ClipBody, Stamp } from './CardShell';

import type { PtNode } from '../../model/flow';

/** How the answer's inline nodes become text and markers. */
interface MarkerCtx {
  readonly source: ExplanationSource | null;
  readonly messageId: string;
  readonly onOpen: (citationId: string) => void;
}

function inline(nodes: readonly Inline[], ctx: MarkerCtx): ReactNode {
  return nodes.map((node, i) => {
    if (node.t === 'text') return <Fragment key={i}>{node.v}</Fragment>;
    if (node.t === 'code') return <code key={i}>{node.v}</code>;
    if (node.t !== 'cite') {
      const Tag = node.t;
      return <Tag key={i}>{inline(node.c, ctx)}</Tag>;
    }
    // A handle with no stored citation is dropped, as the explain panel drops it: "b9" means
    // nothing to a reader, and a marker with no passage behind it would be a claim of a source.
    const marks = node.markers.flatMap((marker) => {
      const citation = ctx.source?.citations.find((c) => c.marker === marker);
      const n = citation && ctx.source?.numbers.get(passageKey(citation, ctx.messageId));
      if (citation === undefined || n === undefined) return [];
      const where = formatPageLabel(citation.page_index + 1, citation.locator?.para_index ?? null);
      return [
        <NumberedMarker
          key={citation.citation_id}
          n={n}
          label={where}
          notVerified={citation.supported === false}
          onFlash={() => ctx.onOpen(citation.citation_id)}
        />,
      ];
    });
    return (
      <Fragment key={i}>
        {marks}
        {node.after}
      </Fragment>
    );
  });
}

/** Props for `AnswerText`. */
export interface AnswerTextProps {
  readonly text: string;
  readonly source: ExplanationSource | null;
  readonly messageId: string;
  readonly onOpen: (citationId: string) => void;
}

/** The answer's paragraphs and lists, with numbered markers where its claims cite the paper. */
export function AnswerText({ text, source, messageId, onOpen }: AnswerTextProps): ReactNode {
  const ctx: MarkerCtx = { source, messageId, onOpen };
  return parseMarkdown(dehyphenate(text)).map((block, i) => {
    if (block.k === 'p')
      return (
        <p key={i}>
          {block.lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 ? ' ' : null}
              {inline(line, ctx)}
            </Fragment>
          ))}
        </p>
      );
    if (block.k === 'h')
      return (
        <p key={i}>
          <strong>{inline(block.c, ctx)}</strong>
        </p>
      );
    const List = block.k === 'ul' ? 'ul' : 'ol';
    return (
      <List key={i}>
        {block.items.map((item, j) => (
          <li key={j}>{inline(item, ctx)}</li>
        ))}
      </List>
    );
  });
}

/** An explanation card: an `explanation` row and the thread message it came from. */
export function ExplanationCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
  const node = data.node;
  const messageId = node.source_message_id ?? '';
  const source = ctx.sources?.explanations.get(messageId) ?? null;
  const footer = [coverageLine(source?.coverage ?? null), usageLine(source?.run ?? null)].filter(
    (line): line is string => line !== null,
  );
  const open = (citationId: string): void => ctx.openCitation?.(id, citationId);
  return (
    <CardShell id={id} selected={selected} kind="explanation" stock="bare">
      {source?.question === null || source === null ? null : (
        <div className="pt-bc__call">
          <Stamp />
          <YouText className="pt-bc__ask">{source.question}</YouText>
        </div>
      )}
      <AiSlip
        footer={
          footer.length === 0 ? undefined : (
            <p className="pt-bc__usage">
              {footer.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
          )
        }
      >
        <ClipBody className="pt-bc__answer">
          <AnswerText text={node.body} source={source} messageId={messageId} onOpen={open} />
        </ClipBody>
      </AiSlip>
    </CardShell>
  );
}
