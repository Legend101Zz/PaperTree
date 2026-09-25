/**
 * quotenorm-pin (#122) — `normaliseForMatch`'s measured behaviour, pinned with the SAME cases the
 * Python binding pins in `packages/anchoring/python/tests/test_selectors.py`
 * (`test_de_hyphenation_joins_a_broken_word_and_leaves_a_range_alone`).
 *
 * The docstrings said the result is "ws-collapsed"; it is ws-DELETED (the per-code-point identity
 * fold strips a lone space to nothing). The behaviour is kept on purpose — every persisted
 * `*Normalised` field was produced this way — and the two bindings are held to it together: the day
 * one side changes, its own pin fails instead of the other side drifting silently.
 */
import { describe, expect, it } from 'vitest';

import { normaliseForMatch } from '../src/quotenorm.js';

describe('normaliseForMatch — the #122 pin (same cases as the Python binding)', () => {
  it.each([
    ['transduc-\ntion', 'transduction'],
    ['2015-\n2016', '2015-2016'],
    ['Kaiming-\nHe', 'kaiming-he'],
    ['state-of-the-art', 'state-of-the-art'],
    ['a b', 'ab'],
  ])('%j normalises to %j', (raw, expected) => {
    expect(normaliseForMatch(raw).text).toBe(expected);
  });

  it('keeps the offset map: one entry per normalised code point, plus the raw length', () => {
    const folded = normaliseForMatch('ﬁne  text');
    expect(folded.text).toBe('finetext');
    expect(folded.rawOffsetAt).toEqual([0, 0, 1, 2, 5, 6, 7, 8, 9]);
  });

  it('deletes every whitespace code point, not only runs of them', () => {
    // The finding #122 records, stated directly rather than through a single example.
    expect(normaliseForMatch(' a\tb c\n d ').text).toBe('abcd');
  });
});
