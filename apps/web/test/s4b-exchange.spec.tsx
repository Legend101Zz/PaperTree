/**
 * #202 part 2, as #340/#341 changed it: the exchange on screen, on the golden thread (frame 04's
 * real stored answer).
 *
 * - the three voices: the ask is yours (`data-voice="you"`), the quote the paper's, the answer the
 *   AI's; no chip, marker, margin flag, trace or readout anywhere;
 * - each paragraph with handles ends in ONE quiet line: `From the paper: p. 1 · p. 2` (an unsectioned
 *   answer never says `General knowledge`; a sectioned one has its one line under "In the paper");
 * - hovering or focusing a page peeks the passage; a click runs the citation flash on the cited
 *   Anchor (no margin tab);
 * - every page is reachable by Tab;
 * - the thread menu lists the threads by their asks and switches them;
 * - the flash's faint outline clears on the next action.
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

import { sourceLines } from './answer-render';
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
import type { ViewMessage } from '@/features/explain/model/state';
import { Exchange } from '@/features/explain/components/Exchange';
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

const firstExchange = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-exchange]') as HTMLElement;

describe('the exchange: ask → answer, one quiet source line per paragraph', () => {
  it('keeps the three voices apart and draws no chip, marker, tab, trace or readout', async () => {
    await openGolden();
    const exchange = firstExchange();
    expect(exchange.getAttribute('aria-label')).toBe('Explain this passage.');
    expect(exchange.querySelector('[data-voice="you"]')?.textContent).toBe('Explain this passage.');
    expect(
      exchange.querySelector('[data-explain-quote] [data-voice="paper"]')?.textContent,
    ).toMatch(/We propose a new simple network architecture/);
    expect(exchange.querySelector('[data-voice="ai"]')?.textContent).toMatch(/central proposal/);
    for (const gone of [
      '.pt-chip',
      '.pt-marker',
      '.pt-ai-slip .pt-tab',
      '.pt-ai-slip__aside',
      '.pt-ai-slip__uncited',
      '.pt-trace-list',
      '.pt-trace-row',
      '.pt-coverage',
      '[data-citation-id]',
    ]) {
      expect(document.querySelector(gone), gone).toBeNull();
    }
    expect(exchange.textContent).not.toMatch(
      /Stands on|not verified|\bverified\b|grounded|own reading|not found in the paper/i,
    );
    expect(exchange.textContent).not.toMatch(/\[b\d/);
  });

  it('ends each paragraph that has handles in the pages it draws on, once each; none says "General knowledge"', async () => {
    await openGolden();
    expect(sourceLines(firstExchange())).toEqual([
      'From the paper: p. 1',
      'From the paper: p. 1 · p. 2',
      'From the paper: p. 2',
      'From the paper: p. 1 · p. 2',
    ]);
    // The last paragraph is the AI's own words: it has no line (an unsectioned answer never says
    // "General knowledge"), and no warning.
    expect(firstExchange().querySelector('.pt-source--general')).toBeNull();
    expect(firstExchange().textContent).toMatch(/This is my reading/);
  });

  it('hovering or focusing a page peeks the passage’s first words, and leaving closes it', async () => {
    await openGolden();
    const page = screen.getAllByRole('button', {
      name: 'Show p. 2 in the paper',
    })[0] as HTMLElement;
    const peek = (): HTMLElement | null =>
      page.parentElement?.querySelector<HTMLElement>('[role="tooltip"]') ?? null;
    expect(peek()?.hidden).toBe(true);
    fireEvent.mouseEnter(page);
    expect(peek()?.hidden).toBe(false);
    expect(peek()?.textContent).toMatch(/^p\. 2“.+”$/);
    expect(page.getAttribute('aria-describedby')).toBe(peek()?.id);
    fireEvent.mouseLeave(page);
    expect(peek()?.hidden).toBe(true);
    fireEvent.focus(page);
    expect(peek()?.hidden).toBe(false);
    fireEvent.keyDown(page, { key: 'Escape' });
    expect(peek()?.hidden).toBe(true);
  });

  it('a page click flashes the cited passage, with no margin tab to say where from', async () => {
    await openGolden();
    const b6 = GOLDEN.messages[1]?.citations.find((c) => c.marker === 'b6');
    // Paragraph 3 draws on b8 alone (p. 2); paragraph 2's first p. 2 passage is b6.
    const lines = firstExchange().querySelectorAll('.pt-source');
    fireEvent.click(lines[1]?.querySelectorAll('button')[1] as HTMLElement);
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    const [anchor, opts] = focusAnchor.mock.calls[0] as [unknown, unknown];
    expect(anchor).toEqual(b6?.anchor);
    expect(opts).toEqual({ flash: true });
    expect(document.querySelector('[data-flash-tab], .pt-flash-tab')).toBeNull();
  });

  it('every page is reachable by Tab: a real button that is neither hidden nor taken out of order', async () => {
    await openGolden();
    const pages = Array.from(firstExchange().querySelectorAll<HTMLElement>('.pt-source button'));
    expect(pages.map((b) => b.textContent)).toEqual([
      'p. 1',
      'p. 1',
      'p. 2',
      'p. 2',
      'p. 1',
      'p. 2',
    ]);
    for (const b of pages) {
      expect(b.getAttribute('tabindex')).not.toBe('-1');
      expect(b.hasAttribute('disabled')).toBe(false);
      expect(b.closest('[aria-hidden="true"]')).toBeNull();
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
});

describe('stable answers (review 1.1, 1.3, #252)', () => {
  it('a follow-up’s source line is final before its stored read lands: nothing swaps', async () => {
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
    await waitFor(() => expect(last().querySelector('.pt-source')).not.toBeNull());
    const before = sourceLines(last());
    expect(before).toEqual(['From the paper: p. 2']);
    await act(async () => {
      release?.();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(sourceLines(last())).toEqual(before);
  });

  it('a page shown at done stays through the stored read: same node, and a click in between flashes (#252)', async () => {
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
    const page = screen.getByRole('button', { name: 'Show p. 2 in the paper' });
    expect(sourceLines(document.body)).toEqual(['From the paper: p. 2']);
    fireEvent.click(page);
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    expect(focusAnchor.mock.calls[0]?.[1]).toEqual({ flash: true });
    await act(async () => {
      release?.();
      await new Promise((r) => setTimeout(r, 50));
    });
    // The stored copy landed (its time is on the call slip now), and nothing moved.
    expect(screen.getByRole('button', { name: 'Show p. 2 in the paper' })).toBe(page);
    expect(page.isConnected).toBe(true);
    expect(sourceLines(document.body)).toEqual(['From the paper: p. 2']);
    expect(document.querySelector('.pt-call-slip time')?.getAttribute('datetime')).toBe(
      answer.created_at,
    );
  });

  it('a claim whose handle matched no passage has no page and no line, with no raw handle', () => {
    const answer = goldenMessages()[1]!;
    const b1 = answer.citations.find((c) => c.marker === 'b1')!;
    const ask = { ...goldenMessages()[0]! };
    const [exchange] = buildExchanges(
      [ask, { ...answer, text: 'Cited claim [b1].\n\nInvented claim [b9].', citations: [b1] }],
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
    expect(sourceLines(document.body)).toEqual(['From the paper: p. 1']);
    expect(document.body.textContent).not.toContain('[b9]');
    expect(document.querySelector('.pt-coverage, [data-unresolved]')).toBeNull();
  });
});
