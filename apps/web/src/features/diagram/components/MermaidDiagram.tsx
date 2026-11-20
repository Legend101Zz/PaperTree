'use client';

/**
 * The figure inside an answer when the model drew it in Mermaid (a ```mermaid fence in "How it
 * works"): a flowchart, sequence diagram, timeline, mind map, chart... chosen by the idea.
 *
 *  - While the fence is still being written it stands as the same quiet placeholder the older
 *    plate figure uses, so the answer never reflows when the figure lands. Mermaid is not even
 *    loaded until the fence closes.
 *  - It is then drawn with `mermaid` (dynamic import, `../mermaid/render`), themed from the figure's
 *    own computed `--pt-*` tokens, and drawn again when the room or the page changes (an attribute
 *    change on <html>, or the OS scheme).
 *  - A fence Mermaid cannot parse draws NOTHING (a hidden, empty figure): a quiet "diagram
 *    unavailable" note would put the app's failure into an answer that reads fine without the
 *    picture, and raw code is never shown. The old plate figure behaves the same way.
 *  - It scales to the room it has (the panel, or a board card about half as wide) but never below
 *    `MIN_SCALE` (`../mermaid/scale`): a wider drawing keeps that scale and scrolls sideways inside
 *    the figure, with a fade at the edge it scrolls toward; its height is capped like a board card
 *    (`--pt-card-cap`, 60vh) and scrolls inside. One click shows it at its natural size; click,
 *    Enter/Space or Esc puts it back (the Explain image head's pattern, `ImageHead`). The control
 *    is a small right-aligned caption row UNDER the drawing, never over it (it covered the last
 *    x-axis label, the scrollbar end, a participant). The figure's accessible name is its type and
 *    first labels; the drawing itself is hidden from assistive tech.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { mermaidName } from '../mermaid/fence';
import { renderMermaid, type MermaidResult } from '../mermaid/render';
import { fitFigure } from '../mermaid/scale';
import { readTokens, tokensKey, type FigureTokens } from '../mermaid/theme';

import './inline.css';
import './mermaid.css';

/** Props for `MermaidDiagram`. */
export interface MermaidDiagramProps {
  /** The text between the fences. */
  readonly body: string;
  /** The closing fence has arrived. False: a placeholder, nothing is loaded or read yet. */
  readonly closed: boolean;
}

/** The attributes on <html> that change the room or the page (packages/ui styles.css). */
const THEME_ATTRIBUTES = ['class', 'data-pt-theme', 'data-pt-page', 'data-theme', 'style'];

/**
 * The figure's tokens, read once it is closed and again whenever the theme changes.
 *
 * @param ref The figure's element.
 * @param active Whether to read at all (the fence has closed).
 * @returns The tokens, or null before the first read (and on the server).
 */
function useTokens(ref: RefObject<HTMLElement | null>, active: boolean): FigureTokens | null {
  const [tokens, setTokens] = useState<FigureTokens | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || el === null) return undefined;
    const read = (): void => {
      const next = readTokens(el);
      setTokens((prev) => (prev !== null && tokensKey(prev) === tokensKey(next) ? prev : next));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: THEME_ATTRIBUTES,
    });
    const scheme =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    scheme?.addEventListener?.('change', read);
    return () => {
      observer.disconnect();
      scheme?.removeEventListener?.('change', read);
    };
  }, [ref, active]);
  return tokens;
}

/**
 * The width the figure has, measured on its scroll box (so padding and the frame are out of it),
 * and kept current when the panel or the card is resized. 0 until measured, and with no
 * ResizeObserver (a test DOM), which `fitFigure` reads as "natural size".
 *
 * @param ref The scroll box's element.
 * @param active Whether the box exists yet (the drawing has landed).
 * @returns The box's inner width in px.
 */
function useRoom(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || el === null) return undefined;
    const read = (): void => setRoom(Math.floor(el.clientWidth));
    read();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, active]);
  return room;
}

/** The figure of one ```mermaid fence. */
export function MermaidDiagram({ body, closed }: MermaidDiagramProps): ReactNode {
  const ref = useRef<HTMLElement | null>(null);
  const tokens = useTokens(ref, closed);
  const [result, setResult] = useState<MermaidResult | null>(null);
  const [large, setLarge] = useState(false);
  const box = useRef<HTMLSpanElement | null>(null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    if (!closed || tokens === null) return undefined;
    let current = true;
    void renderMermaid(body, tokens).then((next) => {
      if (current) setResult(next);
    });
    return () => {
      current = false;
    };
  }, [body, closed, tokens]);

  const drawn = result?.ok === true ? result : null;
  const room = useRoom(box, drawn !== null);
  const fit = fitFigure(drawn?.width ?? 0, room, large);
  // A new size starts at the left edge again: the fade is back until the reader reaches the end.
  useLayoutEffect(() => setAtEnd(false), [fit.width, room]);
  if (result?.ok === false) {
    // Nothing is shown; the element stays so the theme reader and tests can find it.
    return <figure ref={ref} hidden data-mermaid-failed="" />;
  }
  if (!closed || drawn === null) {
    // A reserved, quiet box: the same look as the plate figure's, so the text below does not jump.
    return (
      <figure
        ref={ref}
        className="pt-diagram-inline pt-diagram-inline--pending"
        data-diagram-pending
        aria-hidden="true"
      />
    );
  }
  const label = large ? 'Show the diagram smaller' : 'Show the diagram larger';
  return (
    <figure
      ref={ref}
      className="pt-diagram-inline pt-mmd"
      data-mermaid=""
      data-large={large}
      data-scrolls={fit.scrolls && !atEnd}
      aria-label={mermaidName(body)}
      style={{ '--pt-mmd-w': `${String(fit.width)}px` } as CSSProperties}
    >
      <span className="pt-mmd__stage">
        <span
          ref={box}
          className="pt-mmd__scroll"
          onScroll={(event) => {
            const el = event.currentTarget;
            setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
          }}
        >
          <span
            className="pt-mmd__svg"
            aria-hidden="true"
            // Mermaid's own output, sanitised by `securityLevel: 'strict'` (DOMPurify) before it is returned.
            dangerouslySetInnerHTML={{ __html: drawn.svg }}
          />
        </span>
        <span className="pt-mmd__fade" aria-hidden="true" />
      </span>
      <span className="pt-mmd__caption">
        <button
          type="button"
          className="pt-mmd__btn"
          aria-expanded={large}
          aria-label={label}
          title={large ? 'Show smaller (Esc)' : 'Show larger'}
          onClick={() => setLarge((on) => !on)}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key !== 'Escape' || !large) return;
            // The figure goes back first; the panel stays open.
            event.stopPropagation();
            setLarge(false);
          }}
        >
          {large ? 'smaller' : 'larger'}
        </button>
      </span>
    </figure>
  );
}
