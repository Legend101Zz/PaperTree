'use client';

/**
 * board/components/tree/OutlineView — the tree as an indented study doc (P4 step 10, V3-27): the
 * questions are the headings, a branch shows the words it grew from and sits one step in, a
 * follow-up stays level, and every answer is folded to its first line with "N more lines" to open
 * it. A contents list on the left jumps to a question. "Export Markdown" opens the sheet.
 *
 * It reads `buildOutline`, the same tree the board draws, so the two can never disagree.
 */
import { useState, type ReactNode } from 'react';

import { AnswerBody } from '@/features/explain/components/AnswerBody';

import { buildOutline, type OutlineRow } from '../../model/outline';
import { answerView } from './answerView';

import type { BoardTree } from '../../model/tree';

/** Props for `OutlineView`. */
export interface OutlineViewProps {
  readonly tree: BoardTree;
  readonly title: string;
  readonly countsLine: string;
  readonly onExport: () => void;
  readonly onBack: () => void;
}

const INDENT_PX = 22;

function QuestionRow({
  row,
}: {
  readonly row: Extract<OutlineRow, { kind: 'question' }>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const view = open ? answerView(row.id, row.text, 'done', []) : null;
  return (
    <section
      id={`outline-${row.id}`}
      className="pt-ol__q"
      style={{ marginInlineStart: row.depth * INDENT_PX }}
      aria-labelledby={`outline-h-${row.id}`}
    >
      <h2 id={`outline-h-${row.id}`} className="pt-ol__h">
        {row.from === null ? null : <q className="pt-ol__from">{row.from}</q>}
        {row.from === null ? null : <span aria-hidden="true"> → </span>}
        {row.down ? <span aria-hidden="true">↓ </span> : null}
        {row.question}
      </h2>
      {row.folded === null ? null : (
        <p className="pt-ol__fold">{row.folded.label}, folded on the board</p>
      )}
      {open && view !== null ? (
        <div className="pt-ol__answer" data-voice="ai">
          <AnswerBody
            blocks={view.model.blocks}
            streaming={false}
            general={false}
            onShow={() => undefined}
          />
        </div>
      ) : (
        <p className="pt-ol__line" data-voice="ai">
          {row.firstLine === '' ? 'No answer text yet.' : row.firstLine}
        </p>
      )}
      <button
        type="button"
        className="pt-ol__more"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open
          ? 'Fold to the first line'
          : `${String(row.moreLines)} more ${row.moreLines === 1 ? 'line' : 'lines'}`}
      </button>
    </section>
  );
}

/** The outline of the board. */
export function OutlineView({
  tree,
  title,
  countsLine,
  onExport,
  onBack,
}: OutlineViewProps): ReactNode {
  const outline = buildOutline(tree);
  return (
    <div className="pt-ol" data-testid="outline">
      <nav className="pt-ol__nav" aria-label="Outline contents">
        <p className="pt-ol__navlead">outline</p>
        {outline.nav.map((entry) => (
          <a
            key={entry.id}
            className="pt-ol__navlink"
            style={{ paddingInlineStart: 8 + entry.depth * 12 }}
            href={`#outline-${entry.id}`}
          >
            {entry.title}
          </a>
        ))}
        <p className="pt-ol__navnote">
          Indent = depth in the tree. A branch sits one step in; a follow-up stays level.
        </p>
      </nav>
      <main className="pt-ol__main">
        <div className="pt-ol__bar">
          <p className="pt-ol__crumb">board · outline</p>
          <span className="pt-tc__grow" />
          <button type="button" className="pt-btn pt-btn--outline" onClick={onBack}>
            Back to the board
          </button>
          <button type="button" className="pt-btn pt-btn--primary" onClick={onExport}>
            Export Markdown
          </button>
        </div>
        <h1 className="pt-ol__title">{title}</h1>
        <p className="pt-ol__counts">{countsLine} · answers folded to their first line</p>
        {outline.empty ? (
          <p className="pt-ol__empty">
            Nothing on the board yet. Send a passage from the paper first.
          </p>
        ) : (
          outline.rows.map((row) => {
            if (row.kind === 'passage') {
              return (
                <blockquote key={row.id} className="pt-ol__passage" id={`outline-${row.id}`}>
                  {row.text}
                </blockquote>
              );
            }
            if (row.kind === 'note') {
              return (
                <p
                  key={row.id}
                  className="pt-ol__note"
                  data-voice="you"
                  style={{ marginInlineStart: row.depth * INDENT_PX }}
                >
                  <span className="pt-ol__notetag">note</span> {row.text}
                </p>
              );
            }
            return <QuestionRow key={row.id} row={row} />;
          })
        )}
      </main>
    </div>
  );
}
