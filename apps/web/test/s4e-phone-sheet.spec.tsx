/**
 * #205 (frame 08b): the explain panel as the phone's bottom sheet, on the golden thread (frame 04's
 * real stored answers), and the phone header with its menu.
 *
 * - the sheet's header holds "Explain", the thread menu ("Thread 1 of 2") and the close button;
 * - the call slip keeps the selected passage (the two-line clamp is CSS: measured in
 *   `e2e/v02/phone-reader.spec.ts`), the answer shows its first paragraph and "Read the whole
 *   answer" opens the rest;
 * - markers are 22 px squares whose hit area reaches 44 px (`hitOutset`); each trace row is one
 *   button (the 44 px row height is measured in the e2e);
 * - the pinned footer carries the last answer's usage ("estimate") and To board, outside the
 *   scroll, and draws no Dive in or Diagram (neither is wired on this branch);
 * - a marker tap lowers the sheet to peek and flashes the passage.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hitOutset, SHEET_PEEK_PX, TOUCH_MARKER_PX, TOUCH_TARGET_PX } from '@papertree/ui';

import { GOLDEN } from './fixtures/attention-thread';
import { focusAnchor, Harness, sendToCanvas, stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER } from './s6-support';

import { tableRegionName } from '@/components/reader/guidedTables';
import { spanInView } from '@/components/reader/VirtualPageList';
import { ReaderHeader, type ReaderHeaderProps } from '@/features/reader';
import type { Thread } from '@/lib/api/types';

const NEWER: Thread = {
  ...GOLDEN.thread,
  thread_id: 'thr_free',
  kind: 'ask',
  origin_anchor: null,
  created_at: '2026-10-16T10:18:24.070Z',
  ask: 'Why does attention help?',
};

beforeEach(() => {
  stubDesktop(false);
  focusAnchor.mockReset();
  sendToCanvas.mockClear();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Open the sheet from the header's Explain, then pick Thread 1 (the golden one) from the menu. */
async function openGoldenOnPhone(): Promise<HTMLElement> {
  installFetch({
    [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [NEWER, GOLDEN.thread]),
    [`GET /papers/${PAPER}/threads/${GOLDEN.thread.thread_id}`]: () => jsonResponse(200, GOLDEN),
    [`GET /papers/${PAPER}/threads/thr_free`]: () =>
      jsonResponse(200, { thread: NEWER, messages: [] }),
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  const sheet = await screen.findByRole('dialog');
  fireEvent.click(await within(sheet).findByRole('button', { name: /^Thread 2 of 2/ }));
  fireEvent.click(within(sheet).getByRole('option', { name: /Explain this passage/ }));
  await waitFor(() => expect(within(sheet).getByText(/central proposal/)).toBeTruthy());
  return sheet;
}

const header = (sheet: HTMLElement): HTMLElement =>
  sheet.querySelector('.pt-sheet__header') as HTMLElement;
const first = (sheet: HTMLElement): HTMLElement =>
  sheet.querySelector('[data-exchange]') as HTMLElement;

describe('the phone sheet (frame 08b)', () => {
  it('has Explain, the thread menu and close in its own header', async () => {
    const sheet = await openGoldenOnPhone();
    const top = within(header(sheet));
    expect(top.getByRole('heading', { name: 'Explain' })).toBeTruthy();
    expect(top.getByRole('button', { name: /^Thread 1 of 2: choose a thread/ })).toBeTruthy();
    expect(top.getByRole('button', { name: 'Close explain panel' })).toBeTruthy();
    expect(top.getByRole('button', { name: 'Summary' })).toBeTruthy();
    // The drawer's separate toolbar row is gone on the phone.
    expect(sheet.querySelector('.pt-explain__toolbar')).toBeNull();
  });

  it('quotes the passage on the call slip, and shows the first paragraph until asked', async () => {
    const sheet = await openGoldenOnPhone();
    const exchange = first(sheet);
    expect(exchange.querySelector('.pt-call-slip__quote-text')?.textContent).toMatch(
      /We propose a new simple network architecture/,
    );
    expect(within(exchange).queryByText(/The motivation is/)).toBeNull();
    expect(exchange.querySelector('.pt-ai-slip__uncited')).toBeNull();
    const more = within(exchange).getByRole('button', { name: 'Read the whole answer' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(within(exchange).getByText(/The motivation is/)).toBeTruthy();
    expect(exchange.querySelector('.pt-ai-slip__uncited')?.textContent).toMatch(/my reading/);
    // The same element, now the other way round: focus stays on it.
    expect(more.textContent).toBe('Show less');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('draws 22 px markers whose hit area reaches 44 px, and the trace as one button per row', async () => {
    const sheet = await openGoldenOnPhone();
    const marker = first(sheet).querySelector<HTMLElement>('[data-passage="1"] button');
    expect(marker?.classList.contains('pt-marker--touch')).toBe(true);
    const outset = parseFloat(marker?.style.getPropertyValue('--pt-hit-outset') ?? '');
    expect(TOUCH_MARKER_PX + 2 * outset).toBe(TOUCH_TARGET_PX);
    const rows = first(sheet).querySelectorAll('.pt-trace-row--touch');
    expect(rows).toHaveLength(4);
    for (const row of Array.from(rows)) expect(row.querySelectorAll('button')).toHaveLength(1);
    expect(rows[1]?.querySelector('button')?.textContent).toMatch(/^Show in paper: 2p\. 2/);
  });

  it('splits the tap areas of a run "[1, 4]" between its two markers', async () => {
    const sheet = await openGoldenOnPhone();
    const second = sheet.querySelectorAll<HTMLElement>('[data-exchange]')[1] as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Read the whole answer' }));
    const run = Array.from(second.querySelectorAll('.pt-cite-run')).find(
      (r) => r.querySelectorAll('.pt-exchange__inline-marker').length === 2,
    );
    const pair = Array.from(run?.querySelectorAll('.pt-exchange__inline-marker') ?? []);
    expect(pair.map((m) => m.getAttribute('data-passage'))).toEqual(['1', '4']);
    expect(pair.map((m) => m.getAttribute('data-run'))).toEqual(['next', 'prev']);
    // A marker on its own has no neighbours to share with.
    const alone = first(sheet).querySelector('[data-passage="1"]');
    expect(alone?.hasAttribute('data-run')).toBe(false);
  });

  it('a marker tap lowers the sheet to peek and flashes its passage; so does a trace row', async () => {
    const sheet = await openGoldenOnPhone();
    expect(sheet.getAttribute('data-detent')).toBe('half');
    fireEvent.click(first(sheet).querySelector('[data-passage="1"] button') as HTMLElement);
    await waitFor(() => expect(sheet.getAttribute('data-detent')).toBe('peek'));
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    // The peek still covers the window's foot: the reader counts a passage there as out of view.
    expect(focusAnchor.mock.calls[0]?.[1]).toMatchObject({
      flash: true,
      from: { n: 1 },
      bottomInset: SHEET_PEEK_PX,
    });
    fireEvent.click(first(sheet).querySelectorAll('.pt-trace-row__touch')[1] as HTMLElement);
    expect(focusAnchor.mock.calls[1]?.[1]).toMatchObject({ flash: true, from: { n: 2 } });
  });

  it('pins the last answer’s usage and To board above the follow-up box, outside the scroll', async () => {
    const sheet = await openGoldenOnPhone();
    const pinned = sheet.querySelector<HTMLElement>('[data-pinned-footer]');
    expect(pinned).not.toBeNull();
    expect(pinned?.closest('.pt-explain__scroll')).toBeNull();
    expect(pinned?.nextElementSibling?.classList.contains('pt-explain__composer')).toBe(true);
    expect(within(pinned as HTMLElement).getByText(/\(estimate\)$/)).toBeTruthy();
    // Only what works is drawn: no dead Dive in or Diagram.
    expect(within(sheet).queryByRole('button', { name: /Dive in|Diagram/ })).toBeNull();
    // The last answer's footer is pinned, not repeated in the scroll; the first keeps its own.
    const scroll = sheet.querySelector('.pt-explain__scroll') as HTMLElement;
    expect(scroll.querySelectorAll('[data-usage-line]')).toHaveLength(1);
    // Two answers: the pinned button says which one it sends (the first keeps its own To board).
    fireEvent.click(
      within(pinned as HTMLElement).getByRole('button', { name: 'Send answer 2 to board' }),
    );
    expect(within(scroll).getByRole('button', { name: 'To board' })).toBeTruthy();
    await waitFor(() =>
      expect(within(pinned as HTMLElement).getByText('Sent to board')).toBeTruthy(),
    );
    const last = GOLDEN.messages[GOLDEN.messages.length - 1];
    expect(sendToCanvas).toHaveBeenCalledWith({ kind: 'explanation', messageId: last?.message_id });
    expect(within(sheet).getByPlaceholderText('Ask a follow-up')).toBeTruthy();
  });
});

describe('spanInView: what the reader counts as already on screen', () => {
  it('is the scroller less what covers its foot (the phone sheet at peek)', () => {
    // A passage at 600–640 in a 700 px view: on screen, but behind a 120 px peek sheet.
    expect(spanInView(600, 640, 0, 700)).toBe(true);
    expect(spanInView(600, 640, 0, 700, SHEET_PEEK_PX)).toBe(false);
    expect(spanInView(400, 560, 0, 700, SHEET_PEEK_PX)).toBe(true);
    expect(spanInView(-10, 40, 0, 700, SHEET_PEEK_PX)).toBe(false);
  });
});

const BASE: ReaderHeaderProps = {
  title: 'Attention Is All You Need',
  page: 1,
  pageCount: 15,
  mode: 'source',
  onModeChange: () => undefined,
  guidedAvailable: true,
  zoom: 1,
  zoomMode: { kind: 'fit-width' },
  onZoomChange: () => undefined,
  navigatorOpen: false,
  navigatorAvailable: true,
  onNavigatorToggle: () => undefined,
  highlightCount: 1,
  boardHref: `/paper/${PAPER}/canvas`,
  explain: { open: false, onToggle: () => undefined, ref: { current: null } },
};

describe('the phone header (frame 08b)', () => {
  it('is one row: back, the title, "p. 2", Explain and the menu', () => {
    render(<ReaderHeader {...BASE} />);
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('link', { name: 'Library' })).toBeTruthy();
    expect(within(bar).getByRole('heading', { level: 1 }).textContent).toBe(BASE.title);
    expect(within(bar).getByText('p. 2')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Explain' })).toBeTruthy();
    const menu = within(bar).getByRole('button', { name: 'Reading options' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    // The rest waits in the menu.
    expect(within(bar).queryByRole('radiogroup', { name: 'Reading mode' })).toBeNull();
    expect(within(bar).queryByLabelText('Zoom level')).toBeNull();
    expect(within(bar).queryByRole('link', { name: 'Board' })).toBeNull();
  });

  it('opens Contents, the modes, zoom and Board; Esc closes it back onto its button', () => {
    const contents = vi.fn();
    render(<ReaderHeader {...BASE} onNavigatorToggle={contents} />);
    const button = screen.getByRole('button', { name: 'Reading options' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByRole('group', { name: 'Reading options' });
    expect(within(group).getByRole('radiogroup', { name: 'Reading mode' })).toBeTruthy();
    expect(within(group).getByLabelText('Zoom level')).toBeTruthy();
    expect(within(group).getByRole('link', { name: 'Board' }).getAttribute('href')).toBe(
      BASE.boardHref,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Reading options' })).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Contents, 1 highlight' }));
    expect(contents).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Reading options' })).toBeNull();
  });

  it('closes on a press outside it, and when focus moves out of it', () => {
    render(
      <>
        <ReaderHeader {...BASE} />
        <button type="button">in the page</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reading options' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Reading options' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reading options' }));
    fireEvent.focusIn(screen.getByRole('button', { name: 'in the page' }));
    expect(screen.queryByRole('group', { name: 'Reading options' })).toBeNull();
  });

  it('draws Explain as a 44 px target on the phone row', () => {
    render(<ReaderHeader {...BASE} />);
    expect(screen.getByRole('button', { name: 'Explain' }).style.minHeight).toBe('44px');
  });

  it('Contents from the menu hands focus into Contents, and back to the menu when it closes', () => {
    render(<WithContents />);
    const menu = screen.getByRole('button', { name: 'Reading options' });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('button', { name: 'Contents, 1 highlight' }));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Outline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Contents' }));
    expect(document.activeElement).toBe(menu);
  });
});

/** The phone header with a stand-in for the workspace's Contents panel (its tablist). */
function WithContents(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ReaderHeader {...BASE} navigatorOpen={open} onNavigatorToggle={() => setOpen((v) => !v)} />
      {open ? (
        <div>
          <div role="tablist" aria-label="Contents sections">
            <button type="button" role="tab" aria-selected="true">
              Outline
            </button>
          </div>
          <button type="button" onClick={() => setOpen(false)}>
            Close Contents
          </button>
        </div>
      ) : null}
    </>
  );
}

describe('tableRegionName: a sideways-scrolling Guided table is named', () => {
  it('by its caption, else its first header, else "Table"', () => {
    expect(tableRegionName('Maximum path lengths per layer type')).toBe(
      'Table: Maximum path lengths per layer type',
    );
    expect(tableRegionName('Table 2: The Transformer achieves better BLEU')).toBe(
      'Table 2: The Transformer achieves better BLEU',
    );
    expect(tableRegionName(undefined, 'Layer Type')).toBe('Table: Layer Type');
    expect(tableRegionName()).toBe('Table');
    expect(tableRegionName('x'.repeat(200)).length).toBe(80);
  });
});

describe('hitOutset', () => {
  it('reaches a 44 px target from the 22 px marker, and never shrinks a big box', () => {
    expect(hitOutset(22)).toBe(11);
    expect(hitOutset(TOUCH_MARKER_PX, TOUCH_TARGET_PX)).toBe(11);
    expect(hitOutset(16)).toBe(14);
    expect(hitOutset(21)).toBe(12); // rounds up: 21 + 2 × 12 = 45, never 43
    expect(hitOutset(44)).toBe(0);
    expect(hitOutset(60)).toBe(0);
  });
});
