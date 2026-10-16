'use client';

/**
 * The notebook's side panel (S5c, #208, frame 05): Paper (the template picker), the search box,
 * On this page (the server's counts; ink is "yours", never a number, because handwriting is not
 * searchable), and On the board (the page's card with a miniature and its counts, or the offer to
 * send it). Every number here comes from the API, none is invented.
 */
import { Button } from '@papertree/ui';
import { Pin } from 'lucide-react';
import Link from 'next/link';

import { NotebookSearch } from './NotebookSearch';
import { TemplatePicker } from './TemplatePicker';
import { boardHref } from '../model/links';
import { PAGE_WIDTH } from '../model/page';

import type { NotebookCounts } from '../api/notebookApi';
import type { Item, PageTemplate } from '../model/page';
import type { CanvasNode } from '@/lib/api/types';
import type { ReactNode } from 'react';

/** Props for `NotebookPanel`. */
export interface NotebookPanelProps {
  readonly paperId: string;
  readonly pageId: string;
  readonly title: string;
  readonly template: PageTemplate;
  readonly onTemplate: (template: PageTemplate) => void;
  /** The page's counts from `GET /papers/{id}/notebook/pages`; null while loading. */
  readonly counts: NotebookCounts | null;
  /** True when the page came from a question (Dive in). */
  readonly hasQuestion: boolean;
  /** Citation markers in the answer (its coverage), when the thread was read. */
  readonly citations: number | null;
  /** The page's card on the board: undefined while loading, null when it is not there. */
  readonly card: CanvasNode | null | undefined;
  readonly items: readonly Item[];
  readonly onSend: () => void;
  readonly onMatches: (ids: ReadonlySet<string>) => void;
}

/**
 * "4 quotes · 1 sticky": what a notebook card says about its page (frame 05); no stickies, no clause.
 *
 * @param counts - The card's counts.
 * @returns The phrase.
 */
export function cardPhrase(counts: Pick<NotebookCounts, 'quotes' | 'stickies'>): string {
  const q = `${String(counts.quotes)} ${counts.quotes === 1 ? 'quote' : 'quotes'}`;
  if (counts.stickies === 0) return q;
  return `${q} · ${String(counts.stickies)} ${counts.stickies === 1 ? 'sticky' : 'stickies'}`;
}

const FILL: Readonly<Record<Item['kind'], string>> = {
  exchange: 'var(--pt-ai-slip)',
  quote: 'var(--pt-call-slip)',
  sticky: 'var(--pt-sticky)',
  text: 'var(--pt-rule)',
  shape: 'transparent',
};

/** The page drawn small: each item as its rectangle, in its kind's paper. */
function PageMiniature({ items }: { items: readonly Item[] }): ReactNode {
  const height = Math.max(PAGE_WIDTH * 1.35, ...items.map((i) => i.y + i.h + 48));
  return (
    <svg
      className="pt-nb-mini"
      viewBox={`0 0 ${String(PAGE_WIDTH)} ${String(height)}`}
      aria-hidden="true"
    >
      {items.map((i) => (
        <rect key={i.id} x={i.x} y={i.y} width={i.w} height={i.h} style={{ fill: FILL[i.kind] }} />
      ))}
    </svg>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <li>
      <span>{label}</span>
      <span className="pt-nb-panel__n">{value}</span>
    </li>
  );
}

/** The side panel beside the page. */
export function NotebookPanel(props: NotebookPanelProps): ReactNode {
  const { counts, card } = props;
  return (
    <aside className="pt-nb-panel" aria-label="Page">
      <section aria-labelledby="pt-nb-panel-paper">
        <h2 id="pt-nb-panel-paper">Paper</h2>
        <TemplatePicker value={props.template} onChange={props.onTemplate} />
      </section>
      <section aria-labelledby="pt-nb-panel-here">
        <h2 id="pt-nb-panel-here">On this page</h2>
        <NotebookSearch paperId={props.paperId} pageId={props.pageId} onMatches={props.onMatches} />
        {counts === null ? (
          <p role="status">Counting…</p>
        ) : (
          <ul className="pt-nb-panel__counts">
            <Row label="Your question" value={props.hasQuestion ? 1 : 0} />
            {props.citations === null ? null : (
              <Row label="The AI’s answer" value={`${String(props.citations)} citations`} />
            )}
            <Row label="Passages it stands on" value={counts.quotes} />
            <Row label="Typed notes" value={counts.text} />
            <Row label="Sticky notes" value={counts.stickies} />
            <Row label="Ink" value={counts.strokes > 0 ? 'yours' : 'none yet'} />
          </ul>
        )}
        <p>Search finds typed text, passages and the AI’s answer. Handwriting is not searchable.</p>
      </section>
      <section aria-labelledby="pt-nb-panel-board">
        <h2 id="pt-nb-panel-board">On the board</h2>
        {card === undefined ? null : card === null ? (
          <>
            <p>This page is not on the board yet. Sending it puts one card there that opens it.</p>
            <Button leadingIcon={<Pin size={18} />} onClick={props.onSend}>
              Send page to board
            </Button>
          </>
        ) : (
          <>
            <div className="pt-nb-card">
              <PageMiniature items={props.items} />
              <span>
                <b>{props.title}</b>
                <span>{card.counts === null ? '' : cardPhrase(card.counts)}</span>
              </span>
            </div>
            <p>
              The page sits on the board as one card.{' '}
              <Link href={boardHref(props.paperId)}>Open it there</Link> to come back here.
            </p>
          </>
        )}
      </section>
    </aside>
  );
}
