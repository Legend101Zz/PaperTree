'use client';

/**
 * board/components/tree/useSpanMarks — the words an answer has branches from (rule 4): they stay
 * underlined, a count knot sits on them, and the line to the branch leaves from the card's right
 * padding at the height of their last line (#349: never an underline under the words that follow).
 *
 * The underline is the CSS Custom Highlight API where the browser has it (nothing is wrapped, so
 * the words stay one selectable text); without it the knot and the line still mark the spot. The
 * heights go to the layout through `reports.spanY`, so the line and the card agree.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

import { spanKey } from '../../hooks/useBoardTree';
import { spanNth } from '../../model/spans';
import { rangeFor } from './spansDom';

import type { CardReports } from '../../hooks/useBoardTree';
import type { SpanKnot } from '../../model/tree';

/** A knot placed on its words. */
export interface PlacedKnot {
  readonly knot: SpanKnot;
  /** px from the top of the card. */
  readonly y: number;
}

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

const highlights = (): HighlightRegistry | null => {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
};

/** One highlight name for every card (`::highlight()` needs a fixed name in the stylesheet). */
const HIGHLIGHT = 'pt-branch-span';
const registered = new Map<string, Range[]>();

/**
 * Publishes every card's ranges as the one highlight; a card with none is removed from it.
 *
 * @param id The card.
 * @param ranges The card's underlined words.
 */
function publish(id: string, ranges: Range[]): void {
  const registry = highlights();
  const Highlight = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (ranges.length === 0) registered.delete(id);
  else registered.set(id, ranges);
  if (registry === null || Highlight === undefined) return;
  registry.set(HIGHLIGHT, new Highlight(...[...registered.values()].flat()));
}

/**
 * Finds, underlines and measures the knots of one answer.
 *
 * @param id The answer's id.
 * @param root The card.
 * @param body The body that scrolls.
 * @param text The answer's stored text (the span offsets read it).
 * @param knots The knots of the answer.
 * @param reports Where the measured heights go.
 * @returns The knots that could be found on screen, with their heights.
 */
export function useSpanMarks(
  id: string,
  root: RefObject<HTMLElement | null>,
  body: RefObject<HTMLElement | null>,
  text: string,
  knots: readonly SpanKnot[],
  reports: CardReports,
): PlacedKnot[] {
  const [placed, setPlaced] = useState<PlacedKnot[]>([]);
  const signature = knots
    .map((k) => `${String(k.start)}:${String(k.end)}:${String(k.count)}`)
    .join('|');

  useLayoutEffect(() => {
    const el = body.current;
    const card = root.current;
    if (el === null || card === null || knots.length === 0) {
      setPlaced((p) => (p.length === 0 ? p : []));
      publish(id, []);
      return undefined;
    }
    const mark = (): void => {
      const cardTop = card.getBoundingClientRect().top;
      const next: PlacedKnot[] = [];
      const ranges: Range[] = [];
      for (const knot of knots) {
        const range = rangeFor(el, knot.quote, spanNth(text, knot));
        if (range === null) {
          reports.spanY(id, spanKey(id, knot.start, knot.end), null);
          continue;
        }
        ranges.push(range);
        const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
        const last = rects !== null && rects.length > 0 ? rects[rects.length - 1] : undefined;
        if (last === undefined) continue;
        const y = Math.round(last.top + last.height / 2 - cardTop);
        reports.spanY(id, spanKey(id, knot.start, knot.end), y);
        next.push({ knot, y });
      }
      publish(id, ranges);
      setPlaced((p) =>
        p.length === next.length &&
        p.every((q, i) => q.y === next[i]?.y && q.knot === next[i]?.knot)
          ? p
          : next,
      );
    };
    mark();
    el.addEventListener('scroll', mark, { passive: true });
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        el.removeEventListener('scroll', mark);
        publish(id, []);
      };
    }
    const observer = new ResizeObserver(mark);
    observer.observe(card);
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', mark);
      publish(id, []);
    };
    // `signature` stands for `knots`: the array is rebuilt on every render of the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, root, body, text, signature, reports]);

  return placed;
}
