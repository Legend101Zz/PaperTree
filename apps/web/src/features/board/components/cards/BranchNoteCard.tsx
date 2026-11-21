'use client';

/**
 * board/cards/BranchNoteCard — a note kept from words in an answer (Keep as note, rule 7): no AI
 * call, a `note` child to the right with the words as its body, linked back to the span. It is the
 * reader's, so it is typed in their voice and edited in place (Edit; Enter saves, Shift+Enter is a
 * new line, Esc cancels). Dragged by its strip like the other branching cards.
 */
import { YouText } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useCanvasActions } from '../BoardContext';
import { BranchCard } from '../tree/BranchCard';

import type { PtNode } from '../../model/flow';

/** The API's limit on a card body (schemas.py). */
const NOTE_BODY_MAX = 20_000;

/** A note card that hangs from a parent: a `note` row with a `parent_id`. */
export function BranchNoteCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
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
    <BranchCard
      id={id}
      kind="note"
      stock="note"
      label="Your note"
      selected={selected}
      characters={node.body.length}
      strip={
        <>
          <span className="pt-call-slip__stamp pt-tc__stamp" aria-hidden="true">
            M
          </span>
          <span className="pt-tc__tag">note</span>
          <span className="pt-tc__grow" />
          {editing ? null : (
            <button
              type="button"
              className="pt-tc__act nodrag"
              onClick={() => ctx.setEditingId(id)}
            >
              Edit
            </button>
          )}
        </>
      }
    >
      {editing ? (
        <textarea
          ref={area}
          className="pt-tc__textarea pt-you nodrag nowheel"
          data-voice="you"
          aria-label="Note text"
          value={draft}
          maxLength={NOTE_BODY_MAX}
          rows={3}
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
      ) : node.body === '' ? (
        <p className="pt-tc__empty">Empty note. Choose Edit to write.</p>
      ) : (
        <YouText className="pt-tc__typed">{node.body}</YouText>
      )}
    </BranchCard>
  );
}
