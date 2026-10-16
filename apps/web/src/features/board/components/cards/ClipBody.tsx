'use client';

/**
 * board/cards/ClipBody — a card body that never cuts text off silently (GAP-A3 §7): when its words
 * do not fit, a fade and a "more" button show; "more" expands the body in place (the card grows
 * over the board, its saved size is unchanged) and "less" folds it back.
 *
 * It measures again whenever its CONTENT changes size (a body replaced after a reload, late web
 * fonts), not only its box. Keyboard focus that lands on something below the fold (a marker)
 * expands the body, so focus never scrolls hidden text into a box the reader cannot scroll back.
 * The card's link handles are re-measured on every fold, so threads follow them.
 */
import { useNodeId, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { clipState } from '../../model/clip';

/** Props for `ClipBody`. */
export interface ClipBodyProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** The clipped body with its fade and "more" / "less". */
export function ClipBody({ children, className }: ClipBodyProps): ReactNode {
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState({ content: 0, box: 0 });
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();
  const folded = useRef(expanded);

  useEffect(() => {
    const el = body.current;
    if (el === null) return undefined;
    let live = true;
    const measure = (): void => {
      if (!live) return;
      setSize((s) =>
        s.content === el.scrollHeight && s.box === el.clientHeight
          ? s
          : { content: el.scrollHeight, box: el.clientHeight },
      );
    };
    measure();
    void document.fonts?.ready.then(measure);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (content.current !== null) observer.observe(content.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [expanded]);

  useEffect(() => {
    // Only a real fold or unfold moves the card's handles. Never on mount (React's dev re-run
    // included): xyflow resolves a queued first-open fitView inside updateNodeInternals, and doing
    // it while the other cards are unmeasured fits the board to this one card (#212 e2e w2ui).
    if (folded.current === expanded || nodeId === null) return;
    folded.current = expanded;
    if (!expanded && body.current !== null) body.current.scrollTop = 0;
    updateNodeInternals(nodeId);
  }, [expanded, nodeId, updateNodeInternals]);

  const state = clipState(size.content, size.box, expanded);
  return (
    <div
      className={`pt-bc__clip${className === undefined ? '' : ` ${className}`}`}
      data-clipped={state.clipped}
      data-expanded={expanded}
    >
      {/* Focus inside a folded body unfolds it: the keyboard path to a marker below the fold. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={body}
        className="pt-bc__clip-body"
        onFocus={() => state.clipped && setExpanded(true)}
      >
        <div ref={content}>{children}</div>
      </div>
      {state.control === null ? null : (
        <button
          type="button"
          className="pt-bc__more nodrag"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {state.control}
        </button>
      )}
    </div>
  );
}
