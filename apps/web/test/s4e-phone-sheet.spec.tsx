/**
 * #205 (frame 08b): the explain panel as the phone's bottom sheet, on the golden thread (frame 04's
 * real stored answers).
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hitOutset, TOUCH_MARKER_PX, TOUCH_TARGET_PX } from '@papertree/ui';

import { GOLDEN } from './fixtures/attention-thread';
import { focusAnchor, Harness, sendToCanvas, stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER } from './s6-support';

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

  it('a marker tap lowers the sheet to peek and flashes its passage; so does a trace row', async () => {
    const sheet = await openGoldenOnPhone();
    expect(sheet.getAttribute('data-detent')).toBe('half');
    fireEvent.click(first(sheet).querySelector('[data-passage="1"] button') as HTMLElement);
    await waitFor(() => expect(sheet.getAttribute('data-detent')).toBe('peek'));
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    expect(focusAnchor.mock.calls[0]?.[1]).toMatchObject({ flash: true, from: { n: 1 } });
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
    fireEvent.click(within(pinned as HTMLElement).getByRole('button', { name: 'To board' }));
    await waitFor(() =>
      expect(within(pinned as HTMLElement).getByText('Sent to board')).toBeTruthy(),
    );
    const last = GOLDEN.messages[GOLDEN.messages.length - 1];
    expect(sendToCanvas).toHaveBeenCalledWith({ kind: 'explanation', messageId: last?.message_id });
    expect(within(sheet).getByPlaceholderText('Ask a follow-up')).toBeTruthy();
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
