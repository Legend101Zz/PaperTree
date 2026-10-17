/**
 * #202 part 1: the explain panel reads the paper's stored threads. An empty panel opens on the
 * newest one (v0.1 never loaded them, GAP-A2), a follow-up goes to it, and once an answer settles
 * the stored copy replaces the live one under the same key: no duplicate, no remount.
 *
 * `fetch` is the only stub (the S6 harness); the controller, the hook, react-query and the panel
 * are the real ones. The stored thread is the golden Attention thread, renamed per test.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOLDEN } from './fixtures/attention-thread';
import { Harness, stubDesktop } from './s6-harness';
import {
  citation,
  done,
  errorBody,
  frame,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  text,
  type Call,
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

const NEWER: Thread = { ...GOLDEN.thread, thread_id: 'thr_new' };
const OLDER: Thread = {
  ...GOLDEN.thread,
  thread_id: 'thr_old',
  created_at: '2026-10-01T09:00:00.000Z',
  ask: 'An older question',
};
const LIST = `GET /papers/${PAPER}/threads`;
/** The asks on screen: each exchange's call slip, in the person's voice. */
const ASKS = '.pt-call-slip [data-voice="you"]';
const gets = (calls: readonly Call[], path: string): number =>
  calls.filter((c) => c.method === 'GET' && c.path === path).length;

function stored(id: string, messages: readonly Message[] = GOLDEN.messages) {
  return { thread: { ...NEWER, thread_id: id }, messages };
}

describe('the panel reads the stored threads', () => {
  it('opens an empty panel on the newest thread: its passage, asks and answers', async () => {
    const { calls } = installFetch({
      [LIST]: () => jsonResponse(200, [NEWER, OLDER]),
      [`GET /papers/${PAPER}/threads/thr_new`]: () => jsonResponse(200, stored('thr_new')),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));

    await waitFor(() => expect(screen.getByText(/central proposal/)).toBeTruthy());
    expect(document.querySelector('[data-explain-quote]')?.textContent).toMatch(
      /We propose a new simple network architecture/,
    );
    const asks = Array.from(document.querySelectorAll(ASKS), (n) => n.textContent);
    expect(asks).toEqual([
      'Explain this passage.',
      'Why does dropping recurrence make training faster?',
    ]);
    expect(document.querySelectorAll('[data-message-status="complete"]')).toHaveLength(2);
    expect(gets(calls, `/papers/${PAPER}/threads/thr_new`)).toBe(1);
    expect(gets(calls, `/papers/${PAPER}/threads/thr_old`)).toBe(0);
  });

  it('a follow-up goes to that thread, and the re-read after it settles adds nothing twice', async () => {
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
      content: 'Cheaper to train [b1].',
      coverage: undefined,
    };
    const { calls } = installFetch({
      [LIST]: () => jsonResponse(200, [NEWER]),
      [`GET /papers/${PAPER}/threads/thr_new`]: () => {
        reads += 1;
        return jsonResponse(
          200,
          stored('thr_new', reads === 1 ? GOLDEN.messages : [...GOLDEN.messages, ask3, answer3]),
        );
      },
      [`POST /papers/${PAPER}/threads/thr_new/messages`]: (_c, signal) =>
        sseResponse(
          [
            run({ thread_id: 'thr_new', user_message_id: 'msg_u3', message_id: 'msg_a3' }),
            text('Cheaper to train [b1].'),
            frame('citations', { items: [citation('b1')] }),
            done('complete', null, 'msg_a3'),
          ],
          { signal },
        ),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    await waitFor(() => expect(screen.getByText(/central proposal/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Ask a question about this paper'), {
      target: { value: 'And the cost?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-message-status="complete"]')).toHaveLength(3),
    );
    expect(document.querySelectorAll(ASKS)).toHaveLength(3);
    expect(screen.getAllByText('And the cost?')).toHaveLength(1);
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
    expect(posts).toEqual([`/papers/${PAPER}/threads/thr_new/messages`]);
  });

  it('a live first answer keeps its element when its stored copy replaces it', async () => {
    let handle: { push(c: string): void; close(): void } | undefined;
    const ask1: Message = { ...(GOLDEN.messages[0] as Message), message_id: 'msg_u1' };
    const answer1: Message = {
      ...(GOLDEN.messages[1] as Message),
      message_id: 'msg_a1',
      content: 'The grid predicts boxes [b1].',
      citations: [{ ...(GOLDEN.messages[1]?.citations[0] as Message['citations'][0]) }],
    };
    let reads = 0;
    installFetch({
      [LIST]: () => jsonResponse(200, []),
      [`POST /papers/${PAPER}/threads`]: (_c, signal) =>
        sseResponse([run(), text('The grid predicts boxes [b1].')], {
          hold: true,
          signal,
          onHandle: (h) => (handle = h),
        }),
      [`GET /papers/${PAPER}/threads/thr_1`]: () => {
        reads += 1;
        return jsonResponse(200, stored('thr_1', [ask1, answer1]));
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
    const live = await waitFor(() => {
      const found = document.querySelector('[data-message-status="streaming"]');
      expect(found).not.toBeNull();
      return found;
    });

    handle?.push(frame('citations', { items: [citation('b1')] }));
    handle?.push(done());
    handle?.close();
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(document.querySelector(ASKS)).not.toBeNull());

    const answers = document.querySelectorAll('[data-message-status]');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toBe(live);
    expect(answers[0]?.getAttribute('data-message-status')).toBe('complete');
    expect(document.querySelector(ASKS)?.textContent).toBe('Explain this passage.');
  });

  it('a thread that is gone says so; New thread empties the panel and a question starts anew', async () => {
    let lists = 0;
    const { calls } = installFetch({
      [LIST]: () => {
        lists += 1;
        return jsonResponse(200, lists === 1 ? [NEWER] : []);
      },
      [`GET /papers/${PAPER}/threads/thr_new`]: () =>
        jsonResponse(404, errorBody('not_found', 'no such thread')),
      [`POST /papers/${PAPER}/threads`]: (_c, signal) =>
        sseResponse([run({ thread_id: 'thr_free' }), text('A fresh answer.'), done()], {
          signal,
        }),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This conversation is no longer here.');
    // The list is read again, so the menu stops offering the thread that is gone.
    await waitFor(() => expect(lists).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/type a question about the whole paper below/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ask a question about this paper'), {
      target: { value: 'What is new here?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText('A fresh answer.')).toBeTruthy());
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.path)).toEqual([`/papers/${PAPER}/threads`]);
    expect(posts[0]?.body).toMatchObject({ kind: 'ask', question: 'What is new here?' });
  });

  it('a read that fails says so with Try again, and Try again shows the thread', async () => {
    let fail = true;
    installFetch({
      [LIST]: () => jsonResponse(200, [NEWER]),
      [`GET /papers/${PAPER}/threads/thr_new`]: () =>
        fail
          ? jsonResponse(500, errorBody('internal', 'boom', true))
          : jsonResponse(200, stored('thr_new')),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toContain('This conversation could not be loaded.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText(/central proposal/)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
