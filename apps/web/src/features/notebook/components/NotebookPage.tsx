'use client';

/**
 * The bound notebook page (S5c, #208, frame 05): the binding edge, the template drawn as a CSS
 * background, the title with its link back to the passage the question came from, and every item
 * at its stored place in page units. The whole page is one layer scaled by one factor, so ink,
 * cards and notes never drift against each other. Items are in reading order in the DOM (top to
 * bottom, left to right), which is the keyboard order; `z` only sets what paints on top.
 */
import Link from 'next/link';

import { ExchangeBlock } from './ExchangeBlock';
import { InkLayer } from './InkLayer';
import { NoteItem } from './NoteItem';
import { QuoteCard } from './QuoteCard';
import { ShapeView } from './ShapeView';
import { passageOfQuote } from '../model/exchange';
import { BINDING, TITLE_BAND, pageHeight, templatePaint } from '../model/layout';
import { PAGE_WIDTH } from '../model/page';

import type { NotebookPageWire } from '../api/notebookApi';
import type { Exchange } from '../hooks/useExchange';
import type { Item, StickyItem, TextItem } from '../model/page';
import type { Stroke } from '../model/stroke';
import type { ExchangeBody } from '../model/wire';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

const TILTS = [-0.6, 0.5, -0.3, 0.7];

/** Props for `NotebookPage`. */
export interface NotebookPageProps {
  readonly page: NotebookPageWire;
  readonly items: readonly Item[];
  readonly strokes: readonly Stroke[];
  /** Exchange item id → what Dive in stored in it. */
  readonly exchanges: ReadonlyMap<string, ExchangeBody | null>;
  readonly exchange: Exchange;
  /** Screen px per page unit. */
  readonly scale: number;
  /** The "From your question on p. 1 ¶1 · 15 Oct" line, when the page came from a question. */
  readonly source: { readonly href: string; readonly where: string; readonly day: string } | null;
  /** The note being edited in place, if any; `draft` is a new one not yet on the page. */
  readonly editingId: string | null;
  readonly draft: TextItem | StickyItem | null;
  readonly onEdit: (id: string) => void;
  /** Finish editing `id` (or the draft) with this text. */
  readonly onCommit: (id: string, text: string) => void;
  readonly onMove: (id: string, dx: number, dy: number) => void;
  readonly onDelete: (id: string) => void;
  readonly onFocusAnchor: (anchor: Anchor) => void;
}

function readingOrder(a: Item, b: Item): number {
  return a.y - b.y || a.x - b.x;
}

/** One notebook page, its template, title and items. */
export function NotebookPage(props: NotebookPageProps): ReactNode {
  const { page, scale, exchange } = props;
  const all = props.draft === null ? props.items : [...props.items, props.draft];
  const height = pageHeight(all) + TITLE_BAND;
  let quotes = 0;
  const render = (item: Item): ReactNode => {
    switch (item.kind) {
      case 'exchange': {
        const body = props.exchanges.get(item.id) ?? null;
        if (body === null) return null;
        return (
          <div
            key={item.id}
            className="pt-nb-item"
            style={{ left: item.x, top: item.y, width: item.w, minHeight: item.h, zIndex: item.z }}
          >
            <ExchangeBlock body={body} exchange={exchange} onFocusAnchor={props.onFocusAnchor} />
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
            passage={exchange.layout === null ? null : passageOfQuote(exchange.layout, item.anchor)}
            onFocusAnchor={props.onFocusAnchor}
          />
        );
      case 'shape':
        return <ShapeView key={item.id} item={item} />;
      case 'text':
      case 'sticky':
        return (
          <NoteItem
            key={item.id}
            item={item}
            scale={scale}
            editing={props.editingId === item.id}
            onEdit={() => props.onEdit(item.id)}
            onCommit={(text) => props.onCommit(item.id, text)}
            onMove={(dx, dy) => props.onMove(item.id, dx, dy)}
            onDelete={() => props.onDelete(item.id)}
          />
        );
    }
  };
  return (
    <div
      className="pt-nb-page"
      data-template={page.template}
      style={{ width: BINDING + PAGE_WIDTH * scale, height: height * scale }}
    >
      <div className="pt-nb-page__binding" aria-hidden="true" />
      <div
        className="pt-nb-page__layer"
        style={{
          width: PAGE_WIDTH,
          height,
          transform: `scale(${String(scale)})`,
          ...templatePaint(page.template),
        }}
      >
        <header className="pt-nb-page__title">
          <h1>{page.title}</h1>
          {props.source === null ? null : (
            <p>
              From <Link href={props.source.href}>your question on {props.source.where}</Link> ·{' '}
              {props.source.day}
            </p>
          )}
        </header>
        <div className="pt-nb-page__items" style={{ top: TITLE_BAND }}>
          {[...all].sort(readingOrder).map(render)}
          <InkLayer strokes={props.strokes} width={PAGE_WIDTH} height={height - TITLE_BAND} />
        </div>
        <p id="pt-nb-note-help" className="pt-sr-only">
          Arrow keys move it, with Shift further. Enter edits it. Delete removes it.
        </p>
      </div>
    </div>
  );
}
