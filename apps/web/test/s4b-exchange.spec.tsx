/**
 * #202 part 2: the exchange on screen, on the golden thread (frame 04's real stored answer).
 *
 * - the three voices: the ask is yours (`data-voice="you"`), the quote the paper's, the answer the
 *   AI's; the old "p. 3 p. 3 p. 3" chips are gone;
 * - marker ↔ trace light each other on hover and on focus, both ways;
 * - a marker click and Show in paper run the citation flash on the cited Anchor, with the marker
 *   it came from (the reader draws "from marker 2 in the answer" beside the passage);
 * - every marker and trace row is reachable by Tab, and the margin echo is not;
 * - the thread menu lists the threads by their asks and switches them;
 * - the flash's faint outline clears on the next action, and its margin tab says where it came from.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOLDEN } from './fixtures/attention-thread';
import { focusAnchor, Harness, stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER, type Call } from './s6-support';

import { useClearOnNextAction } from '@/components/reader/flash';
import { HighlightOverlay } from '@/components/reader/HighlightOverlay';
import { FlashMarginTab } from '@/features/explain/components/FlashMarginTab';
import type { Thread } from '@/lib/api/types';

beforeEach(() => {
  stubDesktop();
  focusAnchor.mockReset();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GOLDEN_ID = GOLDEN.thread.thread_id;
const OLDER: Thread = {
  ...GOLDEN.thread,
  thread_id: 'thr_free',
  kind: 'ask',
  origin_anchor: null,
  created_at: '2026-10-16T10:18:24.070Z',
  ask: 'Why does attention help?',
};
const FREE_DETAIL = {
  thread: OLDER,
  messages: [
    { ...GOLDEN.messages[0], thread_id: 'thr_free', message_id: 'msg_fu', content: OLDER.ask },
    {
      ...GOLDEN.messages[1],
      thread_id: 'thr_free',
      message_id: 'msg_fa',
      content: 'Attention looks at every position at once.',
      citations: [],
      coverage: undefined,
    },
  ],
};

/** The golden thread (older) and a free question (newer): the panel opens on the newer one. */
async function openGolden(): Promise<{ calls: Call[] }> {
  const { calls } = installFetch({
    [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [OLDER, GOLDEN.thread]),
    [`GET /papers/${PAPER}/threads/${GOLDEN_ID}`]: () => jsonResponse(200, GOLDEN),
    [`GET /papers/${PAPER}/threads/thr_free`]: () => jsonResponse(200, FREE_DETAIL),
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
  await waitFor(() => expect(screen.getByText(/Attention looks at every position/)).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Previous thread' }));
  await waitFor(() => expect(screen.getByText(/central proposal/)).toBeTruthy());
  return { calls };
}

const inline = (n: number): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-passage="${String(n)}"] button`));
const row = (n: number): HTMLElement =>
  document.querySelector<HTMLElement>(`.pt-trace-row[data-n="${String(n)}"]`) as HTMLElement;
const firstExchange = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-exchange]') as HTMLElement;

describe('the exchange: ask → answer → trace', () => {
  it('keeps the three voices apart and has no per-citation chips', async () => {
    await openGolden();
    const exchange = firstExchange();
    expect(exchange.getAttribute('aria-label')).toBe('Explain this passage.');
    expect(exchange.querySelector('[data-voice="you"]')?.textContent).toBe('Explain this passage.');
    expect(
      exchange.querySelector('[data-explain-quote] [data-voice="paper"]')?.textContent,
    ).toMatch(/We propose a new simple network architecture/);
    expect(exchange.querySelector('[data-voice="ai"]')?.textContent).toMatch(/central proposal/);
    expect(document.querySelectorAll('.pt-chip')).toHaveLength(0);
    expect(exchange.textContent).toContain(
      "Stands on 4 passages · 11 citations · 1 paragraph uncited (the AI's own reading)",
    );
    expect(exchange.querySelector('.pt-ai-slip__uncited')?.textContent).toMatch(
      /no citation · the AI's own reading.*This is my reading/,
    );
    expect(exchange.querySelectorAll('.pt-trace-row')).toHaveLength(4);
  });

  it('hovering marker 2 lights trace row 2, and hovering row 2 lights every marker 2', async () => {
    await openGolden();
    const marker = inline(2)[0] as HTMLElement;
    expect(row(2).getAttribute('data-lit')).toBeNull();
    fireEvent.mouseEnter(marker);
    expect(row(2).getAttribute('data-lit')).toBe('true');
    expect(row(1).getAttribute('data-lit')).toBeNull();
    fireEvent.mouseLeave(marker);
    expect(row(2).getAttribute('data-lit')).toBeNull();

    fireEvent.mouseEnter(row(2));
    const lit = inline(2).filter((b) => firstExchange().contains(b));
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every((b) => b.getAttribute('data-lit') === 'true')).toBe(true);
    expect(inline(1).every((b) => b.getAttribute('data-lit') === null)).toBe(true);
    fireEvent.mouseLeave(row(2));
    expect(inline(2).some((b) => b.getAttribute('data-lit') === 'true')).toBe(false);
  });

  it('focus lights them too, both ways', async () => {
    await openGolden();
    fireEvent.focus(inline(2)[0] as HTMLElement);
    expect(row(2).getAttribute('data-lit')).toBe('true');
    fireEvent.blur(inline(2)[0] as HTMLElement);
    expect(row(2).getAttribute('data-lit')).toBeNull();
    fireEvent.focus(row(3).querySelector('button') as HTMLElement);
    expect(inline(3)[0]?.getAttribute('data-lit')).toBe('true');
  });

  it('a marker click and Show in paper flash the cited passage, saying which marker', async () => {
    await openGolden();
    const b6 = GOLDEN.messages[1]?.citations.find((c) => c.marker === 'b6');
    fireEvent.click(inline(2)[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show in paper, passage 2' })[0]!);
    expect(focusAnchor).toHaveBeenCalledTimes(2);
    for (const [anchor, opts] of focusAnchor.mock.calls) {
      expect(anchor).toEqual(b6?.anchor);
      expect(opts).toEqual({ flash: true, from: { n: 2, page: 2, para: 2, notVerified: false } });
    }
  });

  it('every marker and trace row is reachable by Tab; the margin echo is not', async () => {
    await openGolden();
    const exchange = firstExchange();
    // A <button> is in the Tab order unless it says tabindex="-1", is disabled or is hidden.
    // (happy-dom reports `tabIndex` -1 for every button, so the attribute is read instead.)
    const tabbable = Array.from(exchange.querySelectorAll<HTMLElement>('button')).filter(
      (b) =>
        b.getAttribute('tabindex') !== '-1' &&
        !b.hasAttribute('disabled') &&
        b.closest('[aria-hidden="true"]') === null,
    );
    const markers = Array.from(exchange.querySelectorAll('[data-citation-id] button'));
    expect(markers).toHaveLength(11);
    for (const m of markers) expect(tabbable).toContain(m);
    for (const r of Array.from(exchange.querySelectorAll('.pt-trace-row'))) {
      expect(r.querySelectorAll('button')).toHaveLength(2);
      for (const b of Array.from(r.querySelectorAll('button'))) expect(tabbable).toContain(b);
    }
    // Reading order: the answer's markers (and its actions), then the trace rows.
    const order = tabbable.map((b) => (b.closest('.pt-trace-row') === null ? 'answer' : 'trace'));
    expect(order.lastIndexOf('answer')).toBeLessThan(order.indexOf('trace'));
    const sidenotes = exchange.querySelectorAll('.pt-exchange__sidenote');
    expect(sidenotes.length).toBeGreaterThan(0);
    for (const s of Array.from(sidenotes)) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.querySelector('button')).toBeNull();
    }
  });
});

describe('the thread menu', () => {
  it('names the threads by their asks, oldest first, and switches them', async () => {
    const { calls } = await openGolden();
    const trigger = screen.getByRole('button', { name: /Thread 1 of 2/ });
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox', { name: 'Threads, by their asks' });
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      '1Explain this passage.',
      '2Why does attention help?',
    ]);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Attention looks at every position/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Thread 2 of 2/ })).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(calls.filter((c) => c.path.endsWith('/threads/thr_free')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Next thread' }).hasAttribute('disabled')).toBe(true);
  });

  it('Esc closes the list and gives focus back, without closing the panel', async () => {
    await openGolden();
    fireEvent.click(screen.getByRole('button', { name: /Thread 1 of 2/ }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Explain' })).toBeTruthy();
    expect(document.activeElement?.textContent).toMatch(/Thread 1 of 2/);
  });
});

describe('the citation flash in the reader', () => {
  it('its faint outline clears on the next pointer press or key, and not before', () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ active }) => useClearOnNextAction(active, clear), {
      initialProps: { active: true },
    });
    expect(clear).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event('pointerdown'));
    });
    expect(clear).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    expect(clear).toHaveBeenCalledTimes(2);
    rerender({ active: false });
    act(() => {
      document.dispatchEvent(new Event('pointerdown'));
    });
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('paints the flash after the scroll, and the margin tab names the marker', () => {
    const { container } = render(
      <svg>
        <HighlightOverlay
          pageIndex={1}
          pageWidth={612}
          pageHeight={792}
          zoom={1}
          items={[]}
          flash={{
            key: 'k',
            pageIndex: 1,
            polygons: [
              [
                [100, 200],
                [400, 200],
                [400, 260],
                [100, 260],
              ],
            ],
            extent: [100, 200, 400, 260],
            delayMs: 240,
          }}
        />
      </svg>,
    );
    const group = container.querySelector<SVGGElement>('[data-flash="true"]');
    expect(group?.style.getPropertyValue('--pt-flash-delay')).toBe('240ms');
    expect(group?.querySelectorAll('polygon.pt-flash')).toHaveLength(1);

    render(
      <FlashMarginTab from={{ n: 2, page: 2, para: 2, notVerified: false }} left={140} top={300} />,
    );
    const tab = document.querySelector('[data-flash-tab="2"]');
    expect(tab?.textContent).toBe('2p. 2 ¶2from marker 2 in the answer');
    expect(tab?.getAttribute('aria-hidden')).toBe('true');
  });
});
