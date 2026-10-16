/**
 * #204 review 1.1/1.2: what a refusal before the stream may say, through the real panel. "Your text
 * is kept in the box below" only while the box holds the question (it lives in the controller, so a
 * summary round trip keeps it); a refused Retry says the retry was not sent, never stamps the sent
 * question NOT SENT, and stays through the stored re-read until the next ask; words typed while a
 * question was pending are never overwritten; a 200 that streamed nothing is not "not sent".
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOLDEN } from './fixtures/attention-thread';
import { Harness, stubDesktop } from './s6-harness';
import {
  done,
  errorBody,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
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

const GOLD: Thread = { ...GOLDEN.thread, thread_id: 'thr_gold' };
const LIST = `GET /papers/${PAPER}/threads`;
const READ = `GET /papers/${PAPER}/threads/thr_gold`;
const FOLLOW = `POST /papers/${PAPER}/threads/thr_gold/messages`;
const USAGE = {
  runs: 9,
  input_tokens: 1,
  output_tokens: 1,
  cost_usd_est: 0.9712,
  budget_usd: 1,
  since: 'x',
  by_kind: {},
};
const Q = 'Why does dropping recurrence make training faster?';
const capped = () => jsonResponse(429, errorBody('budget_exhausted', 'over the cap'));
const box = () => screen.getByLabelText('Ask a question about this paper') as HTMLTextAreaElement;
const card = () => document.querySelector('.pt-budget-card');
const stamps = () => document.querySelectorAll('.pt-exchange__not-sent').length;

function open(routes: Parameters<typeof installFetch>[0]) {
  const fetched = installFetch({
    [LIST]: () => jsonResponse(200, [GOLD]),
    [READ]: () => jsonResponse(200, { thread: GOLD, messages: GOLDEN.messages }),
    'GET /usage': () => jsonResponse(200, USAGE),
    ...routes,
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  return fetched;
}

async function ask(question: string): Promise<void> {
  await waitFor(() => expect(screen.getAllByText(/central proposal/).length).toBeGreaterThan(0));
  fireEvent.change(box(), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('a refusal says only what is true (review 1.1, 1.2)', () => {
  it('"kept in the box" holds through a summary round trip, and stops once the box changes', async () => {
    open({
      [FOLLOW]: capped,
      [`GET /papers/${PAPER}/summary`]: () => jsonResponse(200, { state: 'none', summary: null }),
      [`POST /papers/${PAPER}/summary`]: capped,
    });
    await ask(Q);
    await waitFor(() => expect(box().value).toBe(Q));
    expect(card()?.textContent).toContain('your text is kept in the box below');
    expect(stamps()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Summarize paper' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Ask a question about this paper')).toBeNull(),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Back to conversation' }));
    // The draft lives in the controller: the composer comes back holding it.
    expect(box().value).toBe(Q);
    expect(card()?.textContent).toContain('your text is kept in the box below');

    fireEvent.change(box(), { target: { value: 'Something else' } });
    expect(card()?.textContent).toContain('Your question was not sent.');
    expect(card()?.textContent).not.toContain('kept in the box');
  });

  it('words typed while the question was pending are never overwritten by the refusal', async () => {
    let refuse: (r: Response) => void = () => undefined;
    open({ [FOLLOW]: () => new Promise<Response>((resolve) => (refuse = resolve)) });
    await ask(Q);
    await waitFor(() => expect(box().value).toBe(''));
    fireEvent.change(box(), { target: { value: 'A newer thought' } });
    refuse(capped());
    await waitFor(() => expect(card()).not.toBeNull());
    expect(box().value).toBe('A newer thought');
    expect(card()?.textContent).toContain('Your question was not sent.');
  });

  it('a refused Retry: the sent question is not stamped, the answer stays, the note survives the re-read', async () => {
    let follow = 0;
    let reads = 0;
    const ask3: Message = {
      ...(GOLDEN.messages[2] as Message),
      message_id: 'msg_u3',
      ordinal: 4,
      content: 'And the cost?',
    };
    const answer3: Message = {
      ...(GOLDEN.messages[3] as Message),
      message_id: 'msg_a3',
      ordinal: 5,
      content: 'Half of the answer',
      status: 'partial',
      error: { code: 'agent_unavailable', retryable: true, message: 'x' },
      citations: [],
      coverage: undefined,
    };
    const { calls } = open({
      [READ]: () => {
        reads += 1;
        const messages = reads === 1 ? GOLDEN.messages : [...GOLDEN.messages, ask3, answer3];
        return jsonResponse(200, { thread: GOLD, messages });
      },
      [FOLLOW]: (_c, signal) => {
        follow += 1;
        if (follow === 2) return capped();
        const ids = { thread_id: 'thr_gold', user_message_id: 'msg_u3', message_id: 'msg_a3' };
        return sseResponse(
          follow === 1
            ? [
                run(ids),
                text('Half of the answer'),
                done(
                  'partial',
                  { code: 'agent_unavailable', retryable: true, message: 'x' },
                  'msg_a3',
                ),
              ]
            : [run({ ...ids, user_message_id: 'msg_u4', message_id: 'msg_a4' }), text('Fresh')],
          { signal, hold: follow > 2 },
        );
      },
    });
    await ask('And the cost?');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('AI is not available on this server right now.');
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));

    const readsBeforeRetry = reads;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(card()).not.toBeNull());
    const posted = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages'));
    expect(posted[1]?.body).toMatchObject({ retry_of: 'msg_a3' });
    expect(card()?.textContent).toContain(
      'Your retry was not sent; the answer above is as it was.',
    );
    expect(card()?.textContent).not.toContain('kept in the box');
    expect(stamps()).toBe(0);
    expect(screen.getByText(/Half of the answer/)).toBeTruthy();
    expect(box().value).toBe('');

    // The stored re-read after the refusal lands: the note is still there.
    await waitFor(() => expect(reads).toBeGreaterThan(readsBeforeRetry), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(card()?.textContent).toContain('Your retry was not sent');
    expect(screen.getByText(/Half of the answer/)).toBeTruthy();

    // The reader's next ask answers it: the note goes.
    await ask('Another question');
    await waitFor(() => expect(screen.getByText('Fresh')).toBeTruthy());
    expect(card()).toBeNull();
  });

  it('a 200 that streamed nothing is not "not sent": no stamp, the box stays empty', async () => {
    open({ [FOLLOW]: () => jsonResponse(200, {}) });
    await ask(Q);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Something went wrong on the server.');
    expect(stamps()).toBe(0);
    expect(box().value).toBe('');
  });
});
