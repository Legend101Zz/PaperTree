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
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOLDEN, goldenMessages } from './fixtures/attention-thread';
import { focusAnchor, Harness, stubDesktop } from './s6-harness';
import {
  done,
  frame,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  text,
  type Call,
} from './s6-support';

import {
  FLASH_MS,
  FLASH_SCROLL_MS,
  nextFlashPhase,
  tweenScroll,
  useClearOnNextAction,
  type FlashPhase,
} from '@/components/reader/flash';
import { HighlightOverlay } from '@/components/reader/HighlightOverlay';
import type { ViewMessage } from '@/components/explain/useExplainActions';
import { Exchange } from '@/features/explain/components/Exchange';
import { FlashMarginTab } from '@/features/explain/components/FlashMarginTab';
import { buildExchanges, type Exchange as ExchangeModel } from '@/features/explain/model/exchange';
import type { Message, Thread } from '@/lib/api/types';

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
async function openGolden(extra: Parameters<typeof installFetch>[0] = {}): Promise<{
  calls: Call[];
}> {
  const { calls } = installFetch({
    [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [OLDER, GOLDEN.thread]),
    [`GET /papers/${PAPER}/threads/${GOLDEN_ID}`]: () => jsonResponse(200, GOLDEN),
    [`GET /papers/${PAPER}/threads/thr_free`]: () => jsonResponse(200, FREE_DETAIL),
    ...extra,
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  await waitFor(() => expect(screen.getByText(/Attention looks at every position/)).toBeTruthy());
  const previous = screen.getByRole('button', { name: 'Previous thread' });
  previous.focus();
  fireEvent.click(previous);
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

  it('focus on Show in paper lights its marker too (review 2.6)', async () => {
    await openGolden();
    fireEvent.focus(screen.getAllByRole('button', { name: 'Show in paper, passage 2' })[0]!);
    expect(inline(2)[0]?.getAttribute('data-lit')).toBe('true');
    expect(row(2).getAttribute('data-lit')).toBe('true');
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
      '+New thread',
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

  it('a switch keeps focus in the menu, never on the drawer (review 2.1)', async () => {
    await openGolden();
    // "Previous thread" took it to Thread 1, where that arrow is disabled: focus is on the trigger.
    const trigger = screen.getByRole('button', { name: /Thread 1 of 2/ });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Attention looks at every position/)).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Thread 2 of 2/ }));
    expect(document.activeElement?.tagName).not.toBe('ASIDE');
  });

  it('the trigger toggles: a press while the list is open closes it (review 2.2)', async () => {
    await openGolden();
    const trigger = screen.getByRole('button', { name: /Thread 1 of 2/ });
    fireEvent.click(trigger);
    const list = screen.getByRole('listbox');
    // A real pointer: pressing the trigger moves focus to it first, which blurs the list.
    fireEvent.blur(list, { relatedTarget: trigger });
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('"New thread" empties the panel, and the next question starts a thread of its own', async () => {
    const { calls } = await openGolden({
      [`POST /papers/${PAPER}/threads`]: (_c, signal) =>
        sseResponse([run({ thread_id: 'thr_fresh' }), text('A fresh answer.'), done()], {
          signal,
        }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Thread 1 of 2/ }));
    fireEvent.click(screen.getByRole('option', { name: /New thread/ }));
    expect(screen.queryByText(/central proposal/)).toBeNull();
    expect(screen.getByRole('button', { name: /^New thread/ })).toBeTruthy();
    expect(screen.getByText(/type a question about the whole paper below/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ask a question about this paper'), {
      target: { value: 'What else?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText('A fresh answer.')).toBeTruthy());
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.path)).toEqual([`/papers/${PAPER}/threads`]);
    expect(posts[0]?.body).toMatchObject({ kind: 'ask', question: 'What else?' });
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

  it('a key on a marker while a flash shows starts the new flash: the clear runs first', () => {
    // Capture phase matters: in the bubble phase the document hears the key AFTER the marker's
    // own handler set the new flash, and would clear it (review 2.14).
    function Probe() {
      const [active, setActive] = useState(true);
      const [count, setCount] = useState(1);
      useClearOnNextAction(active, () => setActive(false));
      return (
        <>
          <button
            type="button"
            onKeyDown={() => {
              setActive(true);
              setCount((c) => c + 1);
            }}
          >
            marker
          </button>
          <span data-testid="state">{active ? `flash ${String(count)}` : 'none'}</span>
          <button type="button">elsewhere</button>
        </>
      );
    }
    render(<Probe />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'marker' }), { key: 'Enter' });
    expect(screen.getByTestId('state').textContent).toBe('flash 2');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.getByTestId('state').textContent).toBe('none');
  });

  it('runs scroll → flash → linger, and stays in linger (reduced: in flash) until the next action', () => {
    expect(nextFlashPhase('scroll', 240, false)).toEqual({ phase: 'flash', afterMs: 240 });
    expect(nextFlashPhase('flash', 240, false)).toEqual({ phase: 'linger', afterMs: FLASH_MS });
    expect(FLASH_MS).toBe(180 + 900 + 600);
    expect(nextFlashPhase('linger', 240, false)).toBeNull();
    expect(nextFlashPhase('flash', 0, true)).toBeNull();
  });

  it('jumps to an off-screen passage under reduced motion, and tweens there otherwise (S8 review)', () => {
    const reduce = (on: boolean) =>
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
          ({
            matches: on && query.includes('reduce'),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const el = document.createElement('div');
    const scrollTo = vi.fn();
    el.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    try {
      reduce(true);
      tweenScroll(el, 500, 0, FLASH_SCROLL_MS);
      // One instant scroll to the target, and no frame loop: nothing travels.
      expect(scrollTo.mock.calls).toEqual([[{ top: 500, left: 0, behavior: 'auto' }]]);
      expect(frame).not.toHaveBeenCalled();
      scrollTo.mockClear();
      reduce(false);
      tweenScroll(el, 800, 0, FLASH_SCROLL_MS);
      // Full motion: the scroll is left to the frame loop, 240 ms of eased steps.
      expect(scrollTo).not.toHaveBeenCalled();
      expect(frame).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('paints nothing while it scrolls, the ring and wash in flash, a faint outline in linger', () => {
    const paint = (phase: FlashPhase) => (
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
            phase,
            scrollMs: 240,
          }}
        />
      </svg>
    );
    const { container, rerender } = render(paint('scroll'));
    expect(container.querySelector('[data-flash]')).toBeNull();
    rerender(paint('flash'));
    expect(container.querySelectorAll('[data-flash="true"] polygon.pt-flash')).toHaveLength(1);
    rerender(paint('linger'));
    expect(container.querySelector('[data-flash="true"]')).toBeNull();
    expect(
      container.querySelectorAll('[data-flash="linger"] polygon.pt-flash.pt-flash--linger'),
    ).toHaveLength(1);
  });

  it('the margin tab names the marker it came from', () => {
    render(
      <FlashMarginTab from={{ n: 2, page: 2, para: 2, notVerified: false }} left={140} top={300} />,
    );
    const tab = document.querySelector('[data-flash-tab="2"]');
    expect(tab?.textContent).toBe('2p. 2 ¶2from marker 2 in the answer');
    expect(tab?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('honest, stable answers (review 1.1, 1.3)', () => {
  it('a follow-up’s tabs are final before its stored read lands: no "p. 2" → "p. 2 ¶2" swap', async () => {
    let reads = 0;
    let release: (() => void) | null = null;
    const msgs = GOLDEN.messages as Message[];
    const ask3: Message = { ...msgs[2]!, message_id: 'msg_u3', ordinal: 4, content: 'Cost?' };
    const answer3: Message = {
      ...msgs[3]!,
      message_id: 'msg_a3',
      ordinal: 5,
      content: 'Cheaper to train [b6].',
      citations: [msgs[3]!.citations[0]!],
      coverage: undefined,
    };
    const { locator: _dropped, ...liveCitation } = msgs[3]!.citations[0]!;
    installFetch({
      [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [GOLDEN.thread]),
      [`GET /papers/${PAPER}/threads/${GOLDEN_ID}`]: () => {
        reads += 1;
        if (reads === 1) return jsonResponse(200, GOLDEN);
        return new Promise<Response>((resolve) => {
          release = () =>
            resolve(jsonResponse(200, { ...GOLDEN, messages: [...msgs, ask3, answer3] }));
        });
      },
      [`POST /papers/${PAPER}/threads/${GOLDEN_ID}/messages`]: (_c, signal) =>
        sseResponse(
          [
            run({ thread_id: GOLDEN_ID, user_message_id: 'msg_u3', message_id: 'msg_a3' }),
            text('Cheaper to train [b6].'),
            frame('citations', { items: [liveCitation] }),
            done('complete', null, 'msg_a3'),
          ],
          { signal },
        ),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await waitFor(() => expect(screen.getByText(/central proposal/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Ask a question about this paper'), {
      target: { value: 'Cost?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(reads).toBe(2));
    const last = () =>
      Array.from(document.querySelectorAll('[data-exchange]')).at(-1) as HTMLElement;
    await waitFor(() => expect(last().querySelector('.pt-trace-list')).not.toBeNull());
    const before = last().querySelector('.pt-trace-list')?.textContent;
    const name = last().querySelector('[data-passage="2"] button')?.getAttribute('aria-label');
    expect(before).toContain('p. 2 ¶2');
    expect(before).toContain('Introduction');
    expect(name).toBe('Passage 2, p. 2 ¶2');
    await act(async () => {
      release?.();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(last().querySelector('.pt-trace-list')?.textContent).toBe(before);
  });

  it('a marker shown at done stays through the stored read: same node, same tab, and a click in between flashes (#252)', async () => {
    let release: (() => void) | null = null;
    const msgs = GOLDEN.messages as Message[];
    const b6 = msgs[1]!.citations.find((c) => c.marker === 'b6')!;
    const { locator: _dropped, ...liveB6 } = b6;
    const ask: Message = { ...msgs[0]!, thread_id: 'thr_1', message_id: 'msg_u1' };
    const answer: Message = {
      ...msgs[1]!,
      thread_id: 'thr_1',
      message_id: 'msg_a1',
      content: 'Recurrence is sequential [b6].',
      citations: [b6],
      coverage: undefined,
    };
    const { calls } = installFetch({
      [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, []),
      [`POST /papers/${PAPER}/threads`]: (_c, signal) =>
        sseResponse(
          [
            run(),
            text('Recurrence is sequential [b6].'),
            frame('citations', { items: [liveB6] }),
            done(),
          ],
          { signal },
        ),
      [`GET /papers/${PAPER}/threads/thr_1`]: () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              jsonResponse(200, {
                thread: { ...GOLDEN.thread, thread_id: 'thr_1' },
                messages: [ask, answer],
              }),
            );
        }),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
    // Settling: the answer is done and its stored re-read has been asked for, not answered.
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'GET' && c.path === `/papers/${PAPER}/threads/thr_1`),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-message-status="complete"]')).not.toBeNull(),
    );
    const marker = document.querySelector<HTMLElement>('[data-passage="1"] button');
    expect(marker?.getAttribute('aria-label')).toBe('Passage 1, p. 2');
    const trace = document.querySelector('.pt-trace-list')?.textContent;
    fireEvent.click(marker as HTMLElement);
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    expect(focusAnchor.mock.calls[0]?.[1]).toEqual({
      flash: true,
      from: { n: 1, page: 2, para: null, notVerified: false },
    });
    await act(async () => {
      release?.();
      await new Promise((r) => setTimeout(r, 50));
    });
    // The stored copy landed (its time is on the call slip now), and nothing moved.
    expect(document.querySelector('[data-passage="1"] button')).toBe(marker);
    expect(marker?.isConnected).toBe(true);
    expect(marker?.getAttribute('aria-label')).toBe('Passage 1, p. 2');
    expect(document.querySelector('.pt-trace-list')?.textContent).toBe(trace);
    expect(document.querySelector('.pt-call-slip time')?.getAttribute('datetime')).toBe(
      answer.created_at,
    );
  });

  it('a claim whose citation matched no passage is the AI’s own reading, and the readout says so', () => {
    const answer = goldenMessages()[1]!;
    const b1 = answer.citations.find((c) => c.marker === 'b1')!;
    const ask = { ...goldenMessages()[0]! };
    const [exchange] = buildExchanges(
      [
        ask,
        {
          ...answer,
          text: 'Cited claim [b1].\n\nInvented claim [b9].',
          citations: [b1],
          coverage: null,
        },
      ],
      null,
    );
    render(
      <Exchange
        exchange={exchange as ExchangeModel<ViewMessage>}
        initial="M"
        onShow={() => undefined}
        onRetry={() => undefined}
        onStop={() => undefined}
        onSendToCanvas={async () => undefined}
      />,
    );
    const uncited = document.querySelector('.pt-ai-slip__uncited');
    expect(uncited?.textContent).toMatch(/no citation · the AI's own reading.*Invented claim/);
    expect(document.body.textContent).not.toContain('[b9]');
    expect(document.querySelector('.pt-coverage')?.textContent).toContain(
      "1 paragraph uncited (the AI's own reading)",
    );
    expect(document.querySelector('[data-unresolved="1"]')?.textContent).toContain(
      'matches no passage',
    );
  });
});
