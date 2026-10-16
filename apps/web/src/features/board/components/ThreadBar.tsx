'use client';

/**
 * board/components/ThreadBar — the bar over the board when one thread is selected: its kind, which
 * opens the same "Link as" picker a new thread gets (#213), and the person's own label for it.
 */
import { threadInfo, threadKindOf } from '../model/threads';

import type { CanvasEdge } from '@/lib/api/types';
import type { ReactNode } from 'react';

/** Props for `ThreadBar`. */
export interface ThreadBarProps {
  readonly edge: CanvasEdge;
  /** Open the picker to change the kind; `opener` gets focus back afterwards. */
  readonly onKind: (opener: HTMLElement) => void;
  readonly onLabel: (label: string | null) => void;
}

/** The selected thread's kind and label. */
export function ThreadBar({ edge, onKind, onLabel }: ThreadBarProps): ReactNode {
  const info = threadInfo(edge.kind);
  return (
    <div className="pt-cv__edgebar" role="group" aria-label="Selected link">
      <button
        type="button"
        className="pt-btn pt-btn--outline"
        aria-haspopup="listbox"
        onClick={(e) => onKind(e.currentTarget)}
      >
        Kind:{' '}
        <span aria-hidden="true" style={{ color: `var(--pt-wire-${threadKindOf(edge.kind)})` }}>
          {info.glyph}
        </span>{' '}
        {info.label}
      </button>
      <label className="pt-cv-field pt-cv-field--inline">
        <span>Label</span>
        <input
          key={`${edge.edge_id}:${edge.label ?? ''}`}
          className="pt-field"
          defaultValue={edge.label ?? ''}
          maxLength={80}
          placeholder={info.label}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => {
            const next = e.target.value.trim() === '' ? null : e.target.value.trim();
            if (next !== edge.label) onLabel(next);
          }}
        />
      </label>
    </div>
  );
}
