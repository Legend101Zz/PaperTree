/** askHandoff.spec — Ask about this's words go through this tab's storage, once (#209). */
import { describe, expect, it } from 'vitest';

import { askDraft, hasAsk, stashAsk, takeAsk, withoutAsk } from './askHandoff';

import type { AskStorage } from './askHandoff';

/** A Map-backed stand-in for `sessionStorage`. */
function memory(): AskStorage & { size: () => number } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    size: () => m.size,
  };
}

describe('the hand-off', () => {
  it('keeps the words out of the URL, and gives them to the reader once', () => {
    const store = memory();
    const hand = stashAsk('without recurrence, how does it know order?', 'ak_1', store);
    expect(hand).toEqual({ key: 'ak_1' });
    const params = new URLSearchParams({ ask: 'ak_1', nb: 'np_1' });
    expect(hasAsk(params)).toBe(true);
    expect(takeAsk(params, store)).toBe('without recurrence, how does it know order?');
    expect(store.size()).toBe(0);
    expect(takeAsk(params, store)).toBeNull(); // a reload, or the same link again: nothing
    expect(withoutAsk(params)).toBe('nb=np_1');
  });

  it('falls back to the URL only where storage is blocked, and cuts long words', () => {
    const blocked: AskStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    expect(stashAsk('how?', 'ak_2', blocked)).toEqual({ text: 'how?' });
    expect(stashAsk('how?', 'ak_3', null)).toEqual({ text: 'how?' });
    const long = stashAsk('x'.repeat(5000), 'ak_4', null);
    expect('text' in long && long.text).toBe(`${'x'.repeat(1600)}…`);
    expect(takeAsk(new URLSearchParams({ ask_text: 'how?' }), null)).toBe('how?');
    expect(withoutAsk(new URLSearchParams({ ask_text: 'how?' }))).toBe('');
  });

  it('starts the question box with the words, quoted, and room to ask', () => {
    expect(askDraft('how?')).toBe('From my notes: “how?”\n\n');
    expect(hasAsk(new URLSearchParams({ nb: 'np_1' }))).toBe(false);
  });
});
