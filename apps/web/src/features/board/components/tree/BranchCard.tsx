'use client';

/**
 * board/components/tree/BranchCard — what the three branching cards (passage, answer, note) share
 * (v03-BOARD-SPEC section 4, P4 decisions 5 and 6):
 *
 * - the card is as tall as its text, up to the 60% cap the board's pane sets (`--pt-card-cap`);
 *   past the cap the BODY scrolls inside, with a fade and "N characters · scrolls inside" so the
 *   scrolling is never a surprise;
 * - it is dragged by its top strip only, so the words below stay selectable (span branches);
 * - every card has an Ask edge, a round button on its right side, and no brass pins (those are the
 *   loose v0.2 cards' ports, never a branch's);
 * - clicking it focuses its path.
 *
 * It tells the layout how tall its text is (a ResizeObserver, no polling), and nothing else about
 * itself: where the card sits is the layout's.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { rootOnVisiblePage } from '../../model/edge';
import { useBranch } from '../BranchContext';
import { FallbackHandles } from '../CardPins';

import type { CanvasNode } from '@/lib/api/types';

/** Props for `BranchCard`. */
export interface BranchCardProps {
  readonly id: string;
  readonly kind: CanvasNode['kind'];
  /** The wire kind drives the stock (`data-kind`); the voice drives the ink. */
  readonly stock: 'passage' | 'answer' | 'note';
  /** The accessible name of the card. */
  readonly label: string;
  readonly selected: boolean;
  /** The strip: what the reader grabs to drag. Buttons in it must carry `nodrag`. */
  readonly strip: ReactNode;
  /** The words, in the scrolling body. */
  readonly children: ReactNode;
  /** The foot row, when the card has one. */
  readonly foot?: ReactNode;
  /** The characters in the body, for the scroll cue. */
  readonly characters: number;
  /** Where the body's words are selectable for a span (answers). Called on mouse up and key up. */
  readonly onSelectWords?: (body: HTMLElement) => void;
  readonly bodyRef?: { current: HTMLDivElement | null };
  readonly rootRef?: { current: HTMLDivElement | null };
  /** Drawn over the card, positioned against it (the count knots in the right padding). */
  readonly overlay?: ReactNode;
}

/**
 * One branching card.
 *
 * @example
 * <BranchCard id={id} kind="note" stock="note" label="Note" strip={…} characters={42} selected={false}>…</BranchCard>
 */
export function BranchCard({
  id,
  kind,
  stock,
  label,
  selected,
  strip,
  children,
  foot,
  characters,
  onSelectWords,
  bodyRef,
  rootRef,
  overlay,
}: BranchCardProps): ReactNode {
  const branch = useBranch();
  const ownRoot = useRef<HTMLDivElement>(null);
  const root = rootRef ?? ownRoot;
  const ownBody = useRef<HTMLDivElement>(null);
  const body = bodyRef ?? ownBody;
  const [scrolls, setScrolls] = useState(false);
  const focused = branch.control.ui.focusId === id;
  const { reports } = branch;
  // Beside the paper, a card whose root passage is on a visible page has a faint amber edge.
  const rootId = branch.layout.cards.get(id)?.rootId;
  const amber =
    branch.beside &&
    rootId !== undefined &&
    rootOnVisiblePage(branch.tree, rootId, branch.visiblePages);

  useEffect(() => {
    const el = root.current;
    const text = body.current;
    if (el === null) return undefined;
    const measure = (): void => {
      reports.height(id, Math.round(el.offsetHeight));
      if (text !== null) setScrolls(text.scrollHeight - text.clientHeight > 1);
    };
    measure();
    void document.fonts?.ready.then(measure);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (text !== null && text.firstElementChild !== null) observer.observe(text.firstElementChild);
    return () => observer.disconnect();
    // `characters` is a cheap stand-in for "the words changed": the observers cover growth.
  }, [id, reports, root, body, characters]);

  return (
    // The card's own keyboard path is xyflow's focusable wrapper: Enter on it focuses the path
    // (`BoardView`'s key handler). This click is the pointer path.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={root}
      className="pt-tc"
      role="group"
      aria-label={amber ? `${label}, on the page you are reading` : label}
      data-kind={kind}
      data-stock={stock}
      data-focused={focused}
      data-selected={selected}
      data-edge={amber ? 'amber' : undefined}
      data-scrolls={scrolls}
      onClick={() => branch.control.focus(id)}
    >
      <div className="pt-tc__strip">{strip}</div>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- selecting words is the gesture; the menu has its own keys */}
      <div
        ref={body}
        className={`pt-tc__body nodrag nopan${scrolls ? ' nowheel' : ''}`}
        data-testid="card-body"
        onMouseUp={() => {
          if (onSelectWords !== undefined && body.current !== null) onSelectWords(body.current);
        }}
        onKeyUp={() => {
          if (onSelectWords !== undefined && body.current !== null) onSelectWords(body.current);
        }}
      >
        <div className="pt-tc__text">{children}</div>
      </div>
      {scrolls ? (
        <p className="pt-tc__cue" data-testid="scroll-cue">
          <span className="pt-tc__fade" aria-hidden="true" />
          {characters.toLocaleString('en')} characters · scrolls inside
        </p>
      ) : null}
      {foot === undefined ? null : <div className="pt-tc__foot nodrag">{foot}</div>}
      {overlay}
      <button
        type="button"
        className="pt-tc__ask nodrag"
        aria-label="Ask about this card"
        title="Ask about this card"
        onClick={(event) => {
          event.stopPropagation();
          branch.control.openAsk(id);
        }}
      >
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
          <path
            d="M3.5 4.5h13v9h-7l-3.5 3v-3H3.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {/* No brass pins: a branch is joined by the tree's own lines. A stored v0.2 thread that
          touches this card still draws, on the hidden handles. */}
      <FallbackHandles />
    </div>
  );
}
