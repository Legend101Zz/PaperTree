/**
 * lib/readingStateSync (#192): the debounce, the de-duplication, the flush, and that a failed
 * write is dropped quietly and not retried.
 */
import { describe, expect, it, vi } from 'vitest';

import { clearSessionToken, setSessionToken } from '../src/lib/api/client';
import { papersApi } from '../src/lib/api/papers';

import {
  createReadingStateSync,
  READING_STATE_DEBOUNCE_MS,
  type ReadingStateSync,
  type ReadingStateSyncOptions,
  type SendReadingState,
} from '../src/lib/readingStateSync';

/** A hand-driven clock: `tick(ms)` runs what is due. */
function clock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    tick(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
    },
  };
}

function setup(send: SendReadingState = vi.fn((_page, _mode, _options) => Promise.resolve())): {
  send: SendReadingState;
  sync: ReadingStateSync;
  time: ReturnType<typeof clock>;
} {
  const time = clock();
  const options: ReadingStateSyncOptions = {
    send,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  };
  return { send, sync: createReadingStateSync(options), time };
}

describe('createReadingStateSync', () => {
  it('sends once, about two seconds after the page stops changing', () => {
    const { send, sync, time } = setup();
    sync.update(1, 'source');
    time.tick(1500);
    sync.update(2, 'source'); // still moving: the wait starts again
    time.tick(1500);
    expect(send).not.toHaveBeenCalled();
    time.tick(600);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(2, 'source', { keepalive: false });
  });

  it('does not send the same place twice in a row', () => {
    const { send, sync, time } = setup();
    sync.update(4, 'guided');
    time.tick(READING_STATE_DEBOUNCE_MS);
    sync.update(4, 'guided');
    time.tick(READING_STATE_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    sync.update(4, 'split'); // a new mode is a change
    time.tick(READING_STATE_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('flush sends a pending change now, and is a no-op when nothing is pending', () => {
    const { send, sync, time } = setup();
    sync.flush();
    expect(send).not.toHaveBeenCalled();
    sync.update(7, 'source');
    sync.flush(); // the page is being hidden
    expect(send).toHaveBeenCalledWith(7, 'source', { keepalive: false });
    time.tick(5000); // the cancelled timer does not send it again
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('drops a failed write silently and does not retry it', async () => {
    const send = vi.fn(() => Promise.reject(new Error('offline')));
    const { sync, time } = setup(send);
    sync.update(3, 'source');
    time.tick(READING_STATE_DEBOUNCE_MS);
    await Promise.resolve();
    time.tick(60_000);
    expect(send).toHaveBeenCalledTimes(1); // no unhandled rejection, no retry loop
  });

  it('ignores a null page: nothing is written for a place nobody has seen', () => {
    const { send, sync, time } = setup();
    sync.update(null, 'source');
    sync.flush();
    time.tick(READING_STATE_DEBOUNCE_MS * 3);
    expect(send).not.toHaveBeenCalled();
    sync.update(5, 'source');
    sync.update(null, 'guided'); // a later null does not erase or replace the real page
    time.tick(READING_STATE_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledWith(5, 'source', { keepalive: false });
  });

  it('flush({ keepalive: true }) asks the send to outlive the page', () => {
    const { send, sync } = setup();
    sync.update(8, 'split');
    sync.flush({ keepalive: true });
    expect(send).toHaveBeenCalledWith(8, 'split', { keepalive: true });
  });
});

describe('papersApi.putReadingState', () => {
  it('sets fetch keepalive only when asked, and keeps the bearer header', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        calls.push(init);
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    setSessionToken('tok_test');
    try {
      await papersApi.putReadingState('ppr_x', 3, 'source', { keepalive: true });
      await papersApi.putReadingState('ppr_x', 4);
    } finally {
      vi.unstubAllGlobals();
      clearSessionToken();
    }
    expect(calls[0]?.keepalive).toBe(true);
    expect(new Headers(calls[0]?.headers).get('Authorization')).toBe('Bearer tok_test');
    expect(calls[1]?.keepalive).toBeUndefined();
  });
});
