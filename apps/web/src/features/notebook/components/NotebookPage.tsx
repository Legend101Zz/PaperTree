'use client';

/**
 * The bound notebook page (S5c, #208, frame 05): the binding edge, the template drawn as a CSS
 * background, the title with its link back to the passage the question came from, and every item
 * at its stored place in page units. The whole page is one layer scaled by one factor, so ink,
 * cards and notes never drift against each other. Items are in reading order in the DOM (top to
 * bottom, left to right), which is the keyboard order; `z` only sets what paints on top. Whatever
 * sits below the exchange moves down while the exchange is taller than its box (`exchangeShift`),
 * so an opened answer pushes the cards down instead of hiding under them.
 */
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ExchangeBlock } from './ExchangeBlock';
import { PAGE_TITLE_ID } from '../hooks/focus';
import { InkLayer } from './InkLayer';
import { InkSurface, LiveInk } from './InkSurface';
import { NoteItem } from './NoteItem';
import { QuoteCard } from './QuoteCard';
import { ShapeItem } from './ShapeItem';
import { passageOfQuote } from '../model/exchange';
import {
  BINDING,
  TITLE_BAND,
  exchangeShift,
  pageHeight,
  readingOrder,
  templatePaint,
} from '../model/layout';
import { PAGE_WIDTH, titleVoice } from '../model/page';

import type { NotebookPageWire } from '../api/notebookApi';
import type { InkInputOptions } from '../hooks/useInkInput';
import type { Exchange } from '../hooks/useExchange';
import type { Box } from '../model/history';
import type { Item, PageTemplate, StickyItem, TextItem } from '../model/page';
import type { Stroke } from '../model/stroke';
import type { ExchangeBody } from '../model/wire';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

const TILTS = [-0.6, 0.5, -0.3, 0.7];

/** Props for `NotebookPage`. */
export interface NotebookPageProps {
  readonly page: NotebookPageWire;
  /** The template on screen (the page's, or the one just chosen in the panel). */
  readonly template: PageTemplate;
  readonly items: readonly Item[];
  readonly strokes: readonly Stroke[];
  /** Exchange item id → what Dive in stored in it. */
  readonly exchanges: ReadonlyMap<string, ExchangeBody | null>;
  readonly exchange: Exchange;
  /** Screen px per page unit. */
  readonly scale: number;
  /** "From your question on p. 1 ¶1 · 15 Oct"; `day` is null when the question's date is unknown. */
  readonly source: {
    readonly href: string;
    readonly where: string;
    readonly day: string | null;
  } | null;
  /** The note being edited in place, if any; `draft` is a new one not yet on the page. */
  readonly editingId: string | null;
  readonly draft: TextItem | StickyItem | null;
  readonly onEdit: (id: string) => void;
  /** Finish editing `id` (or the draft) with this text. */
  readonly onCommit: (id: string, text: string) => void;
  readonly onMove: (id: string, dx: number, dy: number) => void;
  readonly onDelete: (id: string) => void;
  readonly onResize: (id: string, box: Box) => void;
  readonly onFocusAnchor: (anchor: Anchor) => void;
  /** Items the notebook search matched on this page; they are lit. */
  readonly matches: ReadonlySet<string>;
  /** The ink tool in the hand (S5d, #209); null while the page's own editing has the pointer. */
  readonly ink?: Pick<InkInputOptions, 'tool' | 'pen' | 'onStroke' | 'onErase'> | null;
}

/** The exchange's rendered height in layout units (the scale transform does not change it). */
function useMeasuredHeight(): [(el: HTMLElement | null) => void, number | null] {
  const [height, setHeight] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (el === null || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.current.observe(el);
  }, []);
  return [ref, height];
}

function topOf(stroke: Stroke): number {
  return stroke.points.reduce((min, p) => Math.min(min, p[1]), Infinity);
}

/** One notebook page, its template, title and items. */
export function NotebookPage(props: NotebookPageProps): ReactNode {
  const { page, scale, exchange } = props;
  const title = titleVoice(page.title);
  const all = props.draft === null ? props.items : [...props.items, props.draft];
  const [measure, measured] = useMeasuredHeight();
  const shift = exchangeShift(all, measured);
  const extra = shift?.extra ?? 0;
  const below = (y: number): boolean => shift !== null && y >= shift.boundary;
  const [inkAbove, inkBelow] = useMemo(() => {
    const line = shift?.boundary ?? Infinity;
    return [
      props.strokes.filter((s) => topOf(s) < line),
      props.strokes.filter((s) => topOf(s) >= line),
    ];
  }, [props.strokes, shift?.boundary]);
  const height = pageHeight(all) + TITLE_BAND + extra;
  const live = useRef<SVGPathElement>(null);
  const ink = props.ink ?? null;
  let quotes = 0;
  const render = (item: Item): ReactNode => {
    switch (item.kind) {
      case 'exchange': {
        const body = props.exchanges.get(item.id) ?? null;
        if (body === null) return null;
        return (
          <div
            key={item.id}
            ref={measure}
            className="pt-nb-item"
            data-item-id={item.id}
            data-match={props.matches.has(item.id) ? 'true' : undefined}
            style={{ left: item.x, top: item.y, width: item.w, minHeight: item.h, zIndex: item.z }}
          >
            <ExchangeBlock
              body={body}
              exchange={exchange}
              matched={props.matches.has(item.id)}
              onFocusAnchor={props.onFocusAnchor}
            />
          </div>
        );
      }
      case 'quote':
        quotes += 1;
        return (
          <QuoteCard
            key={item.id}
            item={item}
            tilt={TILTS[(quotes - 1) % TILTS.length]}
            matched={props.matches.has(item.id)}
            passage={exchange.layout === null ? null : passageOfQuote(exchange.layout, item.anchor)}
            onFocusAnchor={props.onFocusAnchor}
          />
        );
      case 'shape':
        return (
          <ShapeItem
            key={item.id}
            item={item}
            scale={scale}
            onMove={props.onMove}
            onResize={props.onResize}
            onDelete={props.onDelete}
          />
        );
      case 'text':
      case 'sticky':
        return (
          <NoteItem
            key={item.id}
            item={item}
            scale={scale}
            editing={props.editingId === item.id}
            matched={props.matches.has(item.id)}
            onEdit={props.onEdit}
            onCommit={props.onCommit}
            onMove={props.onMove}
            onDelete={props.onDelete}
          />
        );
    }
  };
  const ordered = [...all].sort(readingOrder);
  return (
    <div
      className="pt-nb-page"
      data-template={props.template}
      style={{ width: BINDING + PAGE_WIDTH * scale, height: height * scale }}
    >
      <div className="pt-nb-page__binding" aria-hidden="true" />
      <div
        className="pt-nb-page__layer"
        style={{
          width: PAGE_WIDTH,
          height,
          transform: `scale(${String(scale)})`,
          ...templatePaint(props.template),
        }}
      >
        <header className="pt-nb-page__title">
          <h1 id={PAGE_TITLE_ID} tabIndex={-1}>
            {title.lead}
            {title.voice === null ? (
              title.words
            ) : (
              <span data-voice={title.voice}>{title.words}</span>
            )}
          </h1>
          {props.source === null ? null : (
            <p>
              From <Link href={props.source.href}>your question on {props.source.where}</Link>
              {props.source.day === null ? null : ` · ${props.source.day}`}
            </p>
          )}
        </header>
        <div className="pt-nb-page__items" style={{ top: TITLE_BAND }}>
          {ordered.filter((i) => !below(i.y)).map(render)}
          <InkLayer strokes={inkAbove} width={PAGE_WIDTH} height={height - TITLE_BAND} />
          {ink?.pen ? (
            <LiveInk
              ref={live}
              width={PAGE_WIDTH}
              height={height - TITLE_BAND}
              color={ink.pen.color}
              wash={ink.pen.tool === 'highlighter'}
            />
          ) : null}
          <div
            className="pt-nb-page__below"
            data-shift={extra}
            style={{ transform: `translateY(${String(extra)}px)` }}
          >
            {ordered.filter((i) => below(i.y)).map(render)}
            <InkLayer
              strokes={inkBelow}
              width={PAGE_WIDTH}
              height={height - TITLE_BAND}
              labelled={inkAbove.length === 0}
            />
          </div>
        </div>
        {ink === null ? null : (
          <InkSurface
            top={TITLE_BAND}
            options={{ ...ink, scale, strokes: props.strokes, shift, live }}
          />
        )}
        <p id="pt-nb-note-help" className="pt-sr-only">
          Arrow keys move it, with Shift further. Enter edits it. Delete removes it.
        </p>
        <p id="pt-nb-shape-help" className="pt-sr-only">
          Arrow keys move it, Alt with arrows resizes it, with Shift further. Delete removes it.
        </p>
      </div>
    </div>
  );
}
