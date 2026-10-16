/**
 * #204 (frames 04b, 04c) through the real panel with recorded SSE frames: the working label, the
 * caret and Stop on the AI tab row; Stop → "Stopped. The part that arrived is kept." with Retry
 * (focus moves there) and the stopped run's usage; Stop before any text; live markers in a
 * follow-up; the daily-cap refusal that keeps the typed question; a folded earlier answer; axe.
 *
 * `fetch` is the only stub (the S6 harness): the controller, the hooks and the panel are real.
 */
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOLDEN } from './fixtures/attention-thread';
import { Harness, stubDesktop } from './s6-harness';
import {
  errorBody,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  status,
  text,
} from './s6-support';

import type { Message, Thread } from '@/lib/api/types';

beforeEach(() => {
  stubDesktop();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const THREADS = `POST /papers/${PAPER}/threads`;
const LIST = `GET /papers/${PAPER}/threads`;
const GOLD: Thread = { ...GOLDEN.thread, thread_id: 'thr_gold' };
const GOLD_READ = `GET /papers/${PAPER}/threads/thr_gold`;
const FOLLOW = `POST /papers/${PAPER}/threads/thr_gold/messages`;

const USAGE = {
  runs: 9,
  input_tokens: 40_000,
  output_tokens: 5_000,
  cost_usd_est: 0.9712,
  budget_usd: 1,
  since: '2026-10-15T21:16:00.000Z',
  by_kind: {
    explain: { runs: 6, input_tokens: 30_000, output_tokens: 4_000, cost_usd_est: 0.71 },
    ask: { runs: 3, input_tokens: 10_000, output_tokens: 1_000, cost_usd_est: 0.26 },
    summary: { runs: 0, input_tokens: 0, output_tokens: 0, cost_usd_est: 0 },
  },
};

/** The stored copy of a stopped first answer: `aborted`, with whatever the run reported. */
function storedStopped(content: string, tokens: number | null): Message[] {
  const golden = GOLDEN.messages[1] as Message;
  return [
    { ...(GOLDEN.messages[0] as Message), message_id: 'msg_u1', thread_id: 'thr_1' },
    {
      ...golden,
      message_id: 'msg_a1',
      thread_id: 'thr_1',
      content,
      status: 'aborted',
      error: { code: 'aborted', retryable: true, message: 'stopped' },
      citations: [],
      coverage: undefined,
      run: {
        ...(golden.run as NonNullable<Message['run']>),
        model: 'MiniMax-M3',
        input_tokens: tokens === null ? null : tokens - 914,
        output_tokens: tokens === null ? null : 914,
        cost_usd_est: tokens === null ? null : 0.0011,
      },
    },
  ];
}

const answer = () => document.querySelector('[data-message-status]');

async function axeClean(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: {
      'color-contrast': { enabled: false },
      'target-size': { enabled: false },
      region: { enabled: false },
    },
  });
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120) ?? ''}`);
}

describe('streaming and Stop (04b, 04c state 1)', () => {
  it('the working label, the caret and Stop on the tab row; Stop → the kept part, Retry and the usage', async () => {
    const { calls } = installFetch({
      [LIST]: () => jsonResponse(200, []),
      [THREADS]: (_c, signal) =>
        sseResponse([run(), status({ phase: 'tool' }), text('Half an answer')], {
          hold: true,
          signal,
        }),
      'POST /runs/run_1/cancel': () => jsonResponse(202, {}),
      [`GET /papers/${PAPER}/threads/thr_1`]: () =>
        jsonResponse(200, {
          thread: { ...GOLD, thread_id: 'thr_1' },
          messages: storedStopped('Half an answer', 2914),
        }),
      [`POST /papers/${PAPER}/threads/thr_1/messages`]: (_c, signal) =>
        sseResponse([run({ run_id: 'run_2' }), text('Again')], { hold: true, signal }),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
    // Before a word arrives the tab row says Starting, never "Writing".
    await waitFor(() =>
      expect(document.querySelector('.pt-ai-slip__source [role="status"]')?.textContent).toMatch(
        /^(Starting|Reading the paper)…$/,
      ),
    );
    await waitFor(() => expect(screen.getByText(/Half an answer/)).toBeTruthy());

    const live = answer() as HTMLElement;
    expect(live.getAttribute('data-message-status')).toBe('streaming');
    // The label sits on the AI tab row (the slip's source line), and once text flows says so.
    expect(live.querySelector('.pt-ai-slip__source [role="status"]')?.textContent).toBe('Writing…');
    expect(live.querySelector('.pt-exchange__caret')?.getAttribute('aria-hidden')).toBe('true');
    // ONE Stop, on the answer; the composer's button is Ask, waiting.
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1);
    const stop = within(live).getByRole('button', { name: 'Stop' });
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await axeClean()).toEqual([]);

    stop.focus();
    fireEvent.click(stop);
    await waitFor(() => expect(calls.some((c) => c.path === '/runs/run_1/cancel')).toBe(true));
    const note = await screen.findByText('Stopped. The part that arrived is kept.');
    const retry = within(note.closest('.pt-exchange__footer') as HTMLElement).getByRole('button', {
      name: 'Retry',
    });
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText(/Half an answer/)).toBeTruthy();
    expect(screen.queryByText(/kept above/)).toBeNull();

    // The stored copy (read after the cancel lands) brings the run's usage and model.
    await waitFor(
      () =>
        expect(document.querySelector('[data-usage-line]')?.textContent).toBe(
          '2,914 tokens · ≈ $0.0011 (estimate)',
        ),
      { timeout: 4000 },
    );
    expect(live.querySelector('.pt-ai-slip__source')?.textContent).toBe('Stopped · M3');
    expect(screen.getByText('Stopped. The part that arrived is kept.')).toBeTruthy();
    expect(await axeClean()).toEqual([]);

    // Retry from the keyboard hands focus to the new Stop, never to <body> (review 1.6).
    const again = screen.getByRole('button', { name: 'Retry' });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByText(/Again/)).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stop' }));
  });

  it('Stop before any text says so, and never "kept"', async () => {
    installFetch({
      [LIST]: () => jsonResponse(200, []),
      [THREADS]: (_c, signal) =>
        sseResponse([run(), status({ phase: 'thinking' })], { hold: true, signal }),
      'POST /runs/run_1/cancel': () => jsonResponse(202, {}),
      [`GET /papers/${PAPER}/threads/thr_1`]: () =>
        jsonResponse(200, {
          thread: { ...GOLD, thread_id: 'thr_1' },
          messages: storedStopped('', null),
        }),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Thinking…'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByText('Stopped before any text arrived.');
    expect(document.body.textContent).not.toMatch(/kept/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // A run that reported no usage shows none (unknown is not zero).
    await new Promise((r) => setTimeout(r, 1200));
    expect(document.querySelector('[data-usage-line]')).toBeNull();
    expect(screen.getByText('Stopped before any text arrived.')).toBeTruthy();
  });
});

describe('a follow-up in a stored thread', () => {
  function openGold(follow: Parameters<typeof installFetch>[0][string], more: Message[] = []) {
    installFetch({
      [LIST]: () => jsonResponse(200, [GOLD]),
      [GOLD_READ]: () =>
        jsonResponse(200, { thread: GOLD, messages: [...GOLDEN.messages, ...more] }),
      [FOLLOW]: follow,
      'GET /usage': () => jsonResponse(200, USAGE),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  }

  async function typeAndAsk(question: string): Promise<HTMLTextAreaElement> {
    await waitFor(() => expect(screen.getAllByText(/central proposal/).length).toBeGreaterThan(0));
    const box = screen.getByLabelText('Ask a question about this paper') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    return box;
  }

  it('markers appear in the live text for passages the thread already cited; a partial handle never shows', async () => {
    openGold((_c, signal) =>
      sseResponse(
        [
          run({ thread_id: 'thr_gold', message_id: 'msg_a3' }),
          text('Recurrence is sequential [b6]. And [b'),
        ],
        {
          hold: true,
          signal,
        },
      ),
    );
    await typeAndAsk('And the cost?');
    await waitFor(() =>
      expect(document.querySelector('[data-message-status="streaming"]')?.textContent).toContain(
        'Recurrence is sequential',
      ),
    );
    const live = document.querySelector('[data-message-status="streaming"]') as HTMLElement;
    const marker = live.querySelector('[data-passage="2"] button');
    expect(marker?.getAttribute('aria-label')).toBe('Passage 2, p. 2 ¶2');
    expect(live.textContent).not.toMatch(/\[b|\bb6\b/);
    expect(live.querySelector('.pt-exchange__caret')).not.toBeNull();
  });

  it('the daily cap refuses a typed question: the card, "not sent", and the text kept in the box', async () => {
    const question = 'Why does dropping recurrence make training faster?';
    openGold(() => jsonResponse(429, errorBody('budget_exhausted', 'over the cap')));
    const box = await typeAndAsk(question);

    const card = await screen.findByRole('alert');
    expect(card.querySelector('.pt-budget-card__title')?.textContent).toBe(
      'Daily spend cap reached',
    );
    await waitFor(() =>
      expect(card.textContent).toContain('≈ $0.97 of $1.00 used in the last 24 hours (estimate).'),
    );
    expect(card.textContent).toContain(
      'Your question was not sent; your text is kept in the box below. Reading, highlights, the board and cached summaries still work.',
    );
    expect(card.textContent).not.toContain('over the cap');
    expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull();
    // No place in the app changes the cap yet (#256): no dead link.
    expect(within(card).queryByRole('link')).toBeNull();
    expect(card.textContent).not.toContain('Change the daily cap');
    await waitFor(() => expect(box.value).toBe(question));
    const stamp = document.querySelectorAll('.pt-exchange__not-sent');
    expect(Array.from(stamp, (s) => s.textContent)).toEqual(['not sent']);
    expect(
      stamp[0]?.closest('[data-exchange]')?.querySelector('[data-voice="you"]')?.textContent,
    ).toBe(question);

    const usage = within(card).getByRole('button', { name: 'See today’s usage' });
    expect(usage.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(usage);
    expect(usage.getAttribute('aria-expanded')).toBe('true');
    expect(
      Array.from(card.querySelectorAll('.pt-budget-card__rows li'), (li) => li.textContent),
    ).toEqual([
      'Explain 6 runs · 34,000 tokens · ≈ $0.71 (estimate)',
      'Questions 3 runs · 11,000 tokens · ≈ $0.26 (estimate)',
    ]);
    expect(await axeClean()).toEqual([]);
  });

  it('a long thread opens with the earlier answer folded: two lines, its counts, Show', async () => {
    const third: Message[] = [
      {
        ...(GOLDEN.messages[2] as Message),
        message_id: 'msg_u9',
        ordinal: 4,
        content: 'And the cost?',
      },
      {
        ...(GOLDEN.messages[3] as Message),
        message_id: 'msg_a9',
        ordinal: 5,
        content: 'Cheaper [b1].',
      },
    ];
    openGold(() => jsonResponse(500, errorBody('internal')), third);
    await waitFor(() => expect(document.querySelectorAll('[data-exchange]')).toHaveLength(3));
    const [first, second] = Array.from(document.querySelectorAll<HTMLElement>('[data-exchange]'));
    const fold = within(first as HTMLElement).getByRole('button', { name: 'Show' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(first?.querySelector('.pt-exchange__fold')?.textContent).toContain(
      "4 passages · 11 citations · 1 paragraph uncited (the AI's own reading)",
    );
    expect(first?.querySelector('.pt-exchange__preview')?.textContent).toMatch(
      /^The passage states/,
    );
    expect(first?.querySelector('.pt-trace-list')).toBeNull();
    expect(first?.querySelector('[data-citation-id]')).toBeNull();
    expect(second?.querySelector('.pt-trace-list')).not.toBeNull();

    fold.focus();
    fireEvent.click(fold);
    expect(first?.querySelector('.pt-trace-list')).not.toBeNull();
    const again = within(first as HTMLElement).getByRole('button', { name: 'Fold' });
    expect(again).toBe(fold);
    expect(document.activeElement).toBe(fold);
    expect(await axeClean()).toEqual([]);
  });

  it('Retry on a folded earlier answer streams in the open, never inside the fold (review 1.3)', async () => {
    const stopped: Message = {
      ...(GOLDEN.messages[1] as Message),
      status: 'aborted',
      error: { code: 'aborted', retryable: true, message: 'stopped' },
      coverage: undefined,
    };
    const third: Message[] = [
      { ...(GOLDEN.messages[2] as Message), message_id: 'msg_u9', ordinal: 4, content: 'And?' },
      { ...(GOLDEN.messages[3] as Message), message_id: 'msg_a9', ordinal: 5, content: 'So [b1].' },
    ];
    installFetch({
      [LIST]: () => jsonResponse(200, [GOLD]),
      [GOLD_READ]: () =>
        jsonResponse(200, {
          thread: GOLD,
          messages: [GOLDEN.messages[0], stopped, ...GOLDEN.messages.slice(2), ...third],
        }),
      [FOLLOW]: (_c, signal) =>
        sseResponse([run({ thread_id: 'thr_gold' }), text('A brand new streamed answer')], {
          hold: true,
          signal,
        }),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await waitFor(() => expect(document.querySelectorAll('[data-exchange]')).toHaveLength(3));
    const first = document.querySelector<HTMLElement>('[data-exchange]') as HTMLElement;
    expect(first.querySelector('.pt-exchange__preview')).not.toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(first.textContent).toContain('A brand new streamed answer'));
    expect(first.querySelector('.pt-exchange__preview')).toBeNull();
    expect(first.querySelector('.pt-exchange__caret')).not.toBeNull();
    expect(within(first).getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});
