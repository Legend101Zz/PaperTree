'use client';

/**
 * canvas/nodes — the four node kinds. Each is a card in one of the product's registers:
 *
 *   excerpt      the paper's own words, in `PaperText` (serif, no marker), with "Open source"
 *   explanation  what a model wrote, in `AiText` (the ⊙ and the "AI interpretation" label)
 *   note         the reader's own words, in the UI face
 *   group        a dashed frame with a name, behind the cards it holds
 *
 * No hover-only actions: every action is a visible button. All colour and spacing is `pt-cv-*` in
 * `@papertree/ui` tokens, so a redesign changes the stylesheet and not this file.
 */
import { AiText, PaperText } from '@papertree/ui';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { RichText } from '@/components/explain/RichText';

import { useCanvasActions } from './CanvasContext';
import type { PtNode } from './model';

/** The API's limits on a card (schemas.py), so the box stops before the server has to refuse. */
const NOTE_BODY_MAX = 20_000;
const GROUP_NAME_MAX = 200;

function Frame({
  id,
  selected,
  kind,
  label,
  actions,
  children,
}: {
  readonly id: string;
  readonly selected: boolean;
  readonly kind: string;
  readonly label: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const ctx = useCanvasActions();
  return (
    <div className={`pt-cv-node pt-cv-node--${kind}`} data-kind={kind} data-selected={selected}>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={100}
        handleClassName="pt-cv-resize"
        lineClassName="pt-cv-resize-line"
        onResizeEnd={(_, p) => ctx.commitSize(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      <Handle type="target" position={Position.Left} className="pt-cv-handle" />
      <div className="pt-cv-node__head">
        <span className="pt-cv-node__label">{label}</span>
        {actions}
      </div>
      <div className="pt-cv-node__body nowheel">{children}</div>
      <Handle type="source" position={Position.Right} className="pt-cv-handle" />
    </div>
  );
}

export function ExcerptNode({ id, data, selected }: NodeProps<PtNode>) {
  const node = data.node;
  return (
    <Frame
      id={id}
      selected={selected}
      kind="excerpt"
      label="Passage"
      actions={
        <a
          className="pt-btn pt-btn--outline nodrag"
          href={`/paper/${encodeURIComponent(data.paperId)}/read?focus=${encodeURIComponent(id)}`}
        >
          Open source
        </a>
      }
    >
      <PaperText as="blockquote">{node.body === '' ? 'No text was captured for this passage.' : node.body}</PaperText>
    </Frame>
  );
}

export function ExplanationNode({ id, data, selected }: NodeProps<PtNode>) {
  const ctx = useCanvasActions();
  const node = data.node;
  const citations = (node.source_message_id === null ? undefined : ctx.citations?.get(node.source_message_id)) ?? [];
  return (
    <Frame id={id} selected={selected} kind="explanation" label={node.title ?? 'Explanation'}>
      <AiText>
        <RichText text={node.body} citations={citations} citeAs="label" />
      </AiText>
    </Frame>
  );
}

export function NoteNode({ id, data, selected }: NodeProps<PtNode>) {
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
    <Frame
      id={id}
      selected={selected}
      kind="note"
      label="Note"
      actions={
        editing ? null : (
          <button type="button" className="pt-btn pt-btn--outline nodrag" onClick={() => ctx.setEditingId(id)}>
            Edit
          </button>
        )
      }
    >
      {editing ? (
        <textarea
          ref={area}
          className="pt-cv-textarea nodrag nowheel"
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
        <p
          className="pt-cv-pre pt-cv-note"
          onDoubleClick={() => ctx.setEditingId(id)}
          data-empty={node.body === '' ? 'true' : undefined}
        >
          {node.body === '' ? 'Empty note. Choose Edit to write.' : node.body}
        </p>
      )}
    </Frame>
  );
}

export function GroupNode({ id, data, selected }: NodeProps<PtNode>) {
  const ctx = useCanvasActions();
  const node = data.node;
  return (
    <div className="pt-cv-node pt-cv-node--group" data-kind="group" data-selected={selected}>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        handleClassName="pt-cv-resize"
        lineClassName="pt-cv-resize-line"
        onResizeEnd={(_, p) => ctx.commitSize(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      <input
        key={node.title ?? ''}
        className="pt-cv-group__title nodrag"
        aria-label="Group name"
        maxLength={GROUP_NAME_MAX}
        defaultValue={node.title ?? 'Group'}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => ctx.commitTitle(id, e.target.value)}
      />
    </div>
  );
}

export const nodeTypes = {
  excerpt: ExcerptNode,
  explanation: ExplanationNode,
  note: NoteNode,
  frame: GroupNode,
};
