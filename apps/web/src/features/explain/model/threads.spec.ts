import { describe, expect, it } from 'vitest';

import {
  opensOnNewest,
  originOf,
  sortThreads,
  threadPosition,
  type PanelSnapshot,
} from './threads';
import { GOLDEN } from '../../../../test/fixtures/attention-thread';

import type { Thread } from '@/lib/api/types';

function thread(id: string, createdAt: string): Thread {
  return { ...GOLDEN.thread, thread_id: id, created_at: createdAt, updated_at: createdAt };
}

// The API's order: newest first (by updated_at); a follow-up on an old thread moves it to the top.
const listed = [
  thread('thr_B', '2026-10-16T10:18:24.070Z'),
  thread('thr_C2', '2026-10-16T10:20:17.216Z'),
  thread('thr_C1', '2026-10-16T10:20:17.216Z'),
  thread('thr_A', '2026-10-15T17:14:13.068Z'),
];

const EMPTY: PanelSnapshot = {
  open: true,
  view: 'thread',
  threadId: null,
  hasRequest: false,
  messageCount: 0,
  fresh: false,
};

describe('thread order for "Thread n of N"', () => {
  it('sorts by created_at ascending, the id breaking ties, whatever the API order', () => {
    expect(sortThreads(listed).map((t) => t.thread_id)).toEqual([
      'thr_A',
      'thr_B',
      'thr_C1',
      'thr_C2',
    ]);
  });

  it('gives the current thread’s place, or 0 while a new thread is not listed', () => {
    const sorted = sortThreads(listed);
    expect(threadPosition(sorted, 'thr_B')).toEqual({ position: 2, total: 4 });
    expect(threadPosition(sorted, 'thr_new')).toEqual({ position: 0, total: 4 });
  });
});

describe('the thread an empty panel opens on', () => {
  const sorted = sortThreads(listed);

  it('is the newest stored thread', () => {
    expect(opensOnNewest(EMPTY, sorted)?.thread_id).toBe('thr_C2');
    expect(opensOnNewest(EMPTY, [])).toBeNull();
  });

  it('never replaces what the panel already holds', () => {
    expect(opensOnNewest({ ...EMPTY, threadId: 'thr_A' }, sorted)).toBeNull();
    expect(opensOnNewest({ ...EMPTY, hasRequest: true }, sorted)).toBeNull();
    expect(opensOnNewest({ ...EMPTY, messageCount: 1 }, sorted)).toBeNull();
    expect(opensOnNewest({ ...EMPTY, view: 'summary' }, sorted)).toBeNull();
    expect(opensOnNewest({ ...EMPTY, open: false }, sorted)).toBeNull();
    // "New thread": the person asked for an empty panel, so a fresh question starts a new thread.
    expect(opensOnNewest({ ...EMPTY, fresh: true }, sorted)).toBeNull();
  });
});

describe('a stored thread’s origin', () => {
  it('is its origin Anchor and that Anchor’s exact words', () => {
    const origin = originOf(GOLDEN.thread);
    expect(origin?.anchor).toBe(GOLDEN.thread.origin_anchor);
    expect(origin?.quote).toMatch(
      /^We propose a new simple network architecture, the Transformer,/,
    );
  });

  it('is null for a free question', () => {
    expect(originOf({ origin_anchor: null })).toBeNull();
  });
});
