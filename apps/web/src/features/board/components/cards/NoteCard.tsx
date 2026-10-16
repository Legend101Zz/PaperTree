'use client';

/**
 * board/cards/NoteCard and QuestionCard — the person's own words (frame 06): a note is typed on a
 * ruled index card in Courier Prime, pen colour, with the M stamp, and is edited in place (Edit or a
 * double-click; Enter saves, Shift+Enter is a new line, Esc cancels); a question is a call slip
 * alone with its "question" tag.
 */
import { YouText } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useCanvasActions } from '../BoardContext';
import { CardShell, Stamp } from './CardShell';
import { ClipBody } from './ClipBody';

import type { PtNode } from '../../model/flow';

/** The API's limit on a card body (schemas.py), so the box stops before the server has to refuse. */
const NOTE_BODY_MAX = 20_000;

/** A note card: a `note` row, editable in place. */
export function NoteCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
  const node = data.node;
  const editing = ctx.editingId === id;
  const [draft, setDraft] = useState(node.body);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(node.body);
      area.current?.focus();
    }
    // Only entering edit mode resets the draft; later saves must not clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const finish = (save: boolean): void => {
    if (save) ctx.commitBody(id, draft);
    ctx.setEditingId(null);
  };

  return (
    <CardShell id={id} selected={selected} kind="note" stock="card">
      <div className="pt-bc__tabs">
        <Stamp />
        {editing ? null : (
          <button
            type="button"
            className="pt-btn pt-btn--outline pt-bc__btn pt-bc__edit nodrag"
            onClick={() => ctx.setEditingId(id)}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          ref={area}
          className="pt-bc__textarea pt-you nodrag nowheel"
          data-voice="you"
          aria-label="Note text"
          value={draft}
          maxLength={NOTE_BODY_MAX}
          rows={4}
          placeholder="Write a note. Press Enter to save, Shift+Enter for a new line."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(node.body);
              ctx.setEditingId(null);
            }
          }}
        />
      ) : (
        <ClipBody>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Edit is the keyboard path */}
          <div onDoubleClick={() => ctx.setEditingId(id)}>
            {node.body === '' ? (
              <p className="pt-bc__empty">Empty note. Choose Edit to write.</p>
            ) : (
              <YouText className="pt-bc__typed">{node.body}</YouText>
            )}
          </div>
        </ClipBody>
      )}
    </CardShell>
  );
}

/** A question card: a `question` row, the ask on a call slip on its own. */
export function QuestionCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const words = (data.node.body.trim() === '' ? (data.node.title ?? '') : data.node.body).trim();
  return (
    <CardShell id={id} selected={selected} kind="question" stock="call">
      <div className="pt-bc__tabs">
        <Stamp />
        <span className="pt-bc__tag">question</span>
      </div>
      <ClipBody>
        {words === '' ? (
          <p className="pt-bc__empty">An empty question.</p>
        ) : (
          <YouText className="pt-bc__typed">{words}</YouText>
        )}
      </ClipBody>
    </CardShell>
  );
}
