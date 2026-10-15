/**
 * s6-one-ask-per-mount — a second Ask, or a new selection, RESETS the panel.
 *
 * The old Inspector kept one state machine per mount, so a second ask landed in the first answer's
 * place or was dropped (R12). The explain panel starts a fresh thread per Ask: the old answer is
 * gone, the old run is cancelled, and a slow byte from the old stream cannot write into the new
 * answer.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Harness, stubDesktop } from './s6-harness';
import {
  done,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  text,
  type SseHandle,
} from './s6-support';

beforeEach(() => {
  stubDesktop();
  window.localStorage.setItem('papertree.session', 'test-token');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('one ask per mount', () => {
  it('a second Ask starts a new thread, replaces the quote and answer, and cancels the first run', async () => {
    const handles: SseHandle[] = [];
    let n = 0;
    const { calls } = installFetch({
      [`POST /papers/${PAPER}/threads`]: (_c, signal) => {
        n += 1;
        return n === 1
          ? // `signal: null` on purpose: this stream IGNORES the abort (a proxy that buffers, a
            // fetch that does not honour it), so only the epoch guard stands between a late byte
            // and the new answer.
            sseResponse([run({ run_id: 'run_1' }), text('FIRST answer, still streaming')], {
              hold: true,
              signal: null,
              onHandle: (h) => handles.push(h),
            })
          : sseResponse(
              [
                run({ run_id: 'run_2', thread_id: 'thr_2', message_id: 'msg_a2' }),
                text('SECOND answer'),
                done('complete', null, 'msg_a2'),
              ],
              { signal },
            );
      },
      'POST /runs/run_1/cancel': () => jsonResponse(202, {}),
      [`POST /papers/${PAPER}/threads/thr_2/messages`]: (_c, signal) =>
        sseResponse(
          [
            run({ thread_id: 'thr_2', message_id: 'msg_f' }),
            text('ok'),
            done('complete', null, 'msg_f'),
          ],
          { signal },
        ),
    });
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
    await waitFor(() => expect(screen.getByText(/FIRST answer/)).toBeTruthy());
    expect(screen.getByText(/We reframe object detection/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'ask two' }));
    await waitFor(() => expect(screen.getByText('SECOND answer')).toBeTruthy());

    // Reset: the first answer and quote are gone, the second quote is shown, one answer remains.
    expect(screen.queryByText(/FIRST answer/)).toBeNull();
    expect(screen.queryByText(/We reframe object detection/)).toBeNull();
    expect(screen.getByText(/divides the input image/)).toBeTruthy();
    expect(document.querySelectorAll('[data-message-status]')).toHaveLength(1);

    // Two THREAD creations (not a follow-up), and the first run was cancelled, not abandoned.
    const creates = calls.filter(
      (c) => c.method === 'POST' && c.path === `/papers/${PAPER}/threads`,
    );
    expect(creates).toHaveLength(2);
    expect(creates.map((c) => (c.body as { anchor: { id: string } }).anchor.id)).toEqual([
      'anchor-sel1',
      'anchor-sel2',
    ]);
    expect(calls.some((c) => c.path.endsWith('/messages'))).toBe(false);
    expect(calls.some((c) => c.path === '/runs/run_1/cancel')).toBe(true);

    // A late byte from the first (aborted) stream never reaches the second answer.
    try {
      handles[0]?.push(text(' LATE FROM FIRST'));
    } catch {
      /* errored by the abort: also fine */
    }
    expect(screen.queryByText(/LATE FROM FIRST/)).toBeNull();

    // Nor can its late `run` event re-point the new conversation at the OLD thread.
    try {
      handles[0]?.push(run({ run_id: 'run_stale', thread_id: 'thr_stale' }));
    } catch {
      /* errored by the abort: also fine */
    }
    await new Promise((done) => setTimeout(done, 30));
    fireEvent.change(screen.getByLabelText('Ask a question about this paper'), {
      target: { value: 'and that?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/messages'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/messages'))?.path).toBe(
      `/papers/${PAPER}/threads/thr_2/messages`,
    );
  });

  it('the question typed after a reset follows the NEW thread', async () => {
    let n = 0;
    const { calls } = installFetch({
      [`POST /papers/${PAPER}/threads`]: (_c, signal) => {
        n += 1;
        const t = `thr_${String(n)}`;
        return sseResponse(
          [
            run({ thread_id: t, run_id: `run_${String(n)}`, message_id: `msg_${String(n)}` }),
            text(`answer ${String(n)}`),
            done('complete', null, `msg_${String(n)}`),
          ],
          { signal },
        );
      },
      [`POST /papers/${PAPER}/threads/thr_2/messages`]: (_c, signal) =>
        sseResponse(
          [
            run({ thread_id: 'thr_2', message_id: 'msg_f' }),
            text('follow-up for two'),
            done('complete', null, 'msg_f'),
          ],
          { signal },
        ),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
    await waitFor(() => expect(screen.getByText('answer 1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'ask two' }));
    await waitFor(() => expect(screen.getByText('answer 2')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Ask a question about this paper'), {
      target: { value: 'and then?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText('follow-up for two')).toBeTruthy());
    expect(calls.some((c) => c.path === `/papers/${PAPER}/threads/thr_1/messages`)).toBe(false);
  });
});
