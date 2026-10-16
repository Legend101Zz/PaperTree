/**
 * The paper summary as an exchange (#204, frame 04d): its bullets with numbered markers, the trace
 * grouped by page, the counts and the footer's facts. Pure; `SummaryExchange` draws it.
 *
 * PASSAGE NUMBERS ARE THE THREAD'S. A summary citation carries no locator (#257), so its passage key
 * is rebuilt exactly as the server builds one (`g{generation}:{block id}`, `evidence.passage_key`):
 * a passage the open thread already numbered keeps that number, a new one takes the next free
 * number. The summary's `[bN]` are its own run's handles, so the thread's handle map is never used.
 *
 * WHAT A CITATION COUNTS (the frame's "10" against the data's 11, GAP-A2 risk 11): a citation is one
 * bullet citing one passage, a passage cited twice in a bullet counting once. The frame's trace is one
 * row per PAGE, so its last bullet, which cites two passages of p. 10, counted once there; here
 * passages are blocks (as in the thread), so that bullet counts two and the readout says 11.
 */
import { quoteOf, selectorOf } from './anchor';
import { handleRuns, passageKeyOf, type PassageNumbers } from './passages';

import type { AnswerParagraph, PassageMarker, TraceEntry } from './answer';
import type { TraceRowData } from '@papertree/ui';
import type { Citation, Summary } from '@/lib/api/types';

/** One bullet: its paragraph (text and margin markers) and its markers by number. */
export interface SummaryBullet {
  readonly paragraph: AnswerParagraph;
  /** This bullet's markers: a passage's verdict here is this bullet's citation's. */
  readonly markers: ReadonlyMap<number, PassageMarker>;
  readonly supported: boolean;
}

/** The summary, ready to draw. */
export interface SummaryModel {
  readonly bullets: readonly SummaryBullet[];
  /** The summary's handle → passage number (its run's handles name one passage each). */
  readonly handleNumbers: ReadonlyMap<string, number>;
  /** One row per passage, by page, then number. */
  readonly trace: readonly TraceEntry[];
  /** "Stands on 7 passages on 6 pages · 8 bullets · 11 citations · 3 bullets not verified". */
  readonly readout: string;
}

const NO_KEYS: ReadonlyMap<string, string> = new Map();

function plural(count: number, one: string): string {
  return `${String(count)} ${one}${count === 1 ? '' : 's'}`;
}

// A section heading as the anchor recorded it (`5.1\nTraining Data`), on one line.
function sectionOf(citation: Citation): string {
  const heading = selectorOf(citation.anchor, 'SectionPathSelector')?.headingText ?? '';
  const line = heading.replace(/\s+/g, ' ').trim();
  return line.length > 0 ? line : 'Section unknown';
}

// A bullet's citations in the order its text cites them (uncited ones last, as stored).
function inTextOrder(bullet: Summary['bullets'][number]): Citation[] {
  const order = handleRuns(bullet.text).flat();
  const at = (c: Citation): number => {
    const i = order.indexOf(c.marker);
    return i === -1 ? order.length : i;
  };
  return [...bullet.citations].sort((a, b) => at(a) - at(b));
}

// The summary's passage keys in order of first use, numbered after the thread's own.
function numberOf(summary: Summary, thread: PassageNumbers | null) {
  const byKey = new Map(thread?.byKey ?? []);
  let next = Math.max(0, ...byKey.values()) + 1;
  const keyOf = (c: Citation): string => passageKeyOf(c, NO_KEYS, summary.generation);
  for (const bullet of summary.bullets) {
    for (const citation of inTextOrder(bullet)) {
      const key = keyOf(citation);
      if (byKey.has(key)) continue;
      byKey.set(key, next);
      next += 1;
    }
  }
  return { byKey, keyOf };
}

interface PassageUse {
  readonly marker: PassageMarker;
  bullets: number;
  notVerified: number;
}

function markerOf(n: number, citation: Citation): PassageMarker {
  return {
    n,
    page: citation.page_index + 1,
    para: null,
    notVerified: citation.supported === false,
    citation,
    locator: null,
  };
}

/**
 * Build the summary's view model.
 *
 * @param summary The stored summary (`GET /papers/{id}/summary`).
 * @param thread The open thread's numbering, or null when no thread is open.
 * @returns The bullets, handle numbers, trace and readout.
 */
export function buildSummary(summary: Summary, thread: PassageNumbers | null): SummaryModel {
  const { byKey, keyOf } = numberOf(summary, thread);
  const handleNumbers = new Map<string, number>();
  const uses = new Map<number, PassageUse>();
  let citations = 0;
  const bullets = summary.bullets.map((bullet, index) => {
    const markers = new Map<number, PassageMarker>();
    for (const citation of inTextOrder(bullet)) {
      const n = byKey.get(keyOf(citation)) as number;
      handleNumbers.set(citation.marker, n);
      const seen = markers.get(n);
      const marker = markerOf(n, citation);
      markers.set(
        n,
        seen === undefined
          ? marker
          : { ...seen, notVerified: seen.notVerified || marker.notVerified },
      );
    }
    for (const marker of markers.values()) {
      citations += 1;
      const use = uses.get(marker.n) ?? { marker, bullets: 0, notVerified: 0 };
      use.bullets += 1;
      use.notVerified += marker.notVerified ? 1 : 0;
      uses.set(marker.n, use);
    }
    const list = [...markers.values()];
    const paragraph = { index, text: bullet.text, markers: list, cited: list.length > 0 };
    return { paragraph, markers, supported: bullet.supported };
  });
  const trace = [...uses.values()]
    .sort((a, b) => a.marker.page - b.marker.page || a.marker.n - b.marker.n)
    .map((use) => traceRow(use));
  const pages = new Set(trace.map((row) => row.page)).size;
  const unsupported = summary.bullets.filter((b) => !b.supported).length;
  const readout = [
    `Stands on ${plural(trace.length, 'passage')} on ${plural(pages, 'page')}`,
    plural(summary.bullets.length, 'bullet'),
    plural(citations, 'citation'),
    ...(unsupported > 0 ? [`${plural(unsupported, 'bullet')} not verified`] : []),
  ].join(' · ');
  return { bullets, handleNumbers, trace, readout };
}

function traceRow(use: PassageUse): TraceEntry {
  const { marker } = use;
  const all = use.notVerified === use.bullets;
  const row: TraceRowData = {
    n: marker.n,
    page: marker.page,
    para: null,
    where: sectionOf(marker.citation),
    citedCount: use.bullets,
    quote: quoteOf(marker.citation.anchor),
    status: all ? 'not-verified' : 'cited',
    ...(use.notVerified > 0 && !all ? { note: `${String(use.notVerified)} not verified` } : {}),
  };
  return { ...row, citation: marker.citation };
}

/**
 * The day a summary was made, as the frame writes it: `15 Oct`.
 *
 * @param iso Its `created_at`.
 * @param timeZone Optional IANA zone (tests pin it).
 * @returns The day and month, or "" when the time is not readable.
 */
export function summaryDay(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(date);
}

/**
 * `MiniMax-M3.1-Flash-Preview` → `M3.1 Flash`: the design's short model name; the vendor is implied.
 *
 * @param model The stored model id.
 * @returns The short name, or "AI model" when unknown.
 */
export function shortModelName(model: string | undefined): string {
  if (model === undefined || model === '') return 'AI model';
  return model
    .replace(/^MiniMax-/i, '')
    .replace(/-Preview$/i, '')
    .replace(/-/g, ' ');
}
