'use client';

/**
 * The phone notebook (S5e, #210, frame 08c): the page read as a stack, ask → answer → trace, then
 * the person's own things. The call slip and the AI slip are the page's exchange (collapsed, "Read
 * the whole answer"); the trace is one 44 px row per quote card ("cited 5×"), each opening its
 * passage in the paper; "Your ink · view only" shows the strokes cropped and never takes a pointer;
 * stickies and typed notes are editable in place (Courier Prime). Nothing here moves anything on
 * the page: the tablet and the desktop place things, the phone reads and types.
 */
import { TraceList } from '@papertree/ui';
import Link from 'next/link';
import { memo, useId, useMemo } from 'react';

import { ExchangeBlock } from './ExchangeBlock';
import { InkLayer } from './InkLayer';
import { NoteItem } from './NoteItem';
import { PAGE_TITLE_ID } from '../hooks/focus';
import { templatePaint } from '../model/layout';
import { inkCrop, phoneNotes, phoneTrace } from '../model/phone';

import './phone.css';

import type { Exchange } from '../hooks/useExchange';
import type { Item, PageTemplate, StickyItem, TextItem } from '../model/page';
import type { Stroke } from '../model/stroke';
import type { ExchangeBody } from '../model/wire';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/** Props for `PhoneStack`. */
export interface PhoneStackProps {
  readonly title: string;
  readonly template: PageTemplate;
  /** What Dive in stored in the page's exchange item; null for a page not dived from an answer. */
  readonly body: ExchangeBody | null;
  readonly exchange: Exchange;
  readonly items: readonly Item[];
  readonly strokes: readonly Stroke[];
  /** "From your question on p. 1 ¶1 · 15 Oct", as the page says it. */
  readonly source: {
    readonly href: string;
    readonly where: string;
    readonly day: string | null;
  } | null;
  readonly editingId: string | null;
  readonly draft: TextItem | StickyItem | null;
  readonly onEdit: (id: string) => void;
  readonly onCommit: (id: string, text: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onFocusAnchor: (anchor: Anchor) => void;
}

/** The person's ink, cropped to where it is, as a picture: shown, never edited, on a phone. */
function InkStrip({ strokes }: { readonly strokes: readonly Stroke[] }): ReactNode {
  const crop = useMemo(() => inkCrop(strokes), [strokes]);
  const caption = useId();
  if (crop === null) return null;
  return (
    <figure className="pt-nb-stack__ink" aria-labelledby={caption} data-view-only="">
      <figcaption id={caption}>Your ink · view only</figcaption>
      <InkLayer strokes={strokes} width={crop.width} height={crop.height} crop={crop} />
    </figure>
  );
}

/** The phone's stack view of one notebook page. */
export const PhoneStack = memo(function PhoneStack(props: PhoneStackProps): ReactNode {
  const { exchange, items } = props;
  const trace = useMemo(
    () => phoneTrace(items, exchange.layout, exchange.answer?.citations ?? []),
    [items, exchange.layout, exchange.answer],
  );
  const all = props.draft === null ? items : [...items, props.draft];
  const { stickies, notes } = phoneNotes(all);
  const note = (n: StickyItem | TextItem): ReactNode => (
    <NoteItem
      key={n.id}
      item={n}
      scale={1}
      flow
      editing={props.editingId === n.id}
      onEdit={props.onEdit}
      onCommit={props.onCommit}
      onMove={() => undefined}
      onDelete={props.onDelete}
    />
  );
  return (
    <div className="pt-nb-stack" data-dive-page="" style={templatePaint(props.template)}>
      <h1 id={PAGE_TITLE_ID} tabIndex={-1} className="pt-sr-only">
        {props.title}
      </h1>
      {props.source === null ? null : (
        <p className="pt-nb-stack__from">
          From <Link href={props.source.href}>your question on {props.source.where}</Link>
          {props.source.day === null ? null : ` · ${props.source.day}`}
        </p>
      )}
      {props.body === null ? null : (
        <ExchangeBlock
          body={props.body}
          exchange={exchange}
          onFocusAnchor={props.onFocusAnchor}
          phone
        />
      )}
      {trace.length === 0 ? null : (
        <TraceList
          rows={trace.map((t) => t.row)}
          layout="touch"
          onShowInPaper={(n) => {
            const hit = trace.find((t) => t.row.n === n);
            if (hit !== undefined) props.onFocusAnchor(hit.item.anchor);
          }}
        />
      )}
      <div className="pt-nb-stack__mine">
        <InkStrip strokes={props.strokes} />
        {stickies.map(note)}
      </div>
      {notes.map(note)}
    </div>
  );
});
