import { describe, expect, it } from 'vitest';

import {
  locateQuote,
  normaliseWords,
  nthIndexOf,
  occurrencesBefore,
  plainOf,
  spanNth,
} from './spans';

const SOURCE = [
  '## TL;DR',
  'An **identity mapping** hands its input straight on [b3].',
  '',
  '## How it works',
  'With $F(x)=0$ the block outputs x. An identity mapping adds no extra parameters.',
].join('\n');

describe('plainOf', () => {
  it('drops marks, handles, heading hashes and maths, and keeps a way back', () => {
    const { plain, map } = plainOf(SOURCE);
    expect(plain).toBe(
      'TL;DR An identity mapping hands its input straight on . How it works With the block outputs x. An identity mapping adds no extra parameters.',
    );
    // Every plain character points at the same character in the source.
    for (let i = 0; i < plain.length; i += 1) {
      const at = map[i]!;
      if (plain[i] !== ' ') expect(SOURCE[at]).toBe(plain[i]);
    }
  });

  it('skips a diagram fence altogether', () => {
    const text = 'Before.\n```diagram\nbox: a\n```\nAfter.';
    expect(plainOf(text).plain).toBe('Before. After.');
  });
});

describe('locateQuote', () => {
  it('finds words across a bold mark and gives offsets into the Markdown', () => {
    const span = locateQuote(SOURCE, 'An identity mapping hands', 0)!;
    expect(SOURCE.slice(span.start, span.end)).toBe('An **identity mapping** hands');
    expect(span.quote).toBe('An identity mapping hands');
  });

  it('picks the occurrence the reader selected when the words appear twice', () => {
    const first = locateQuote(SOURCE, 'identity mapping', 0)!;
    const second = locateQuote(SOURCE, 'identity mapping', 1)!;
    expect(second.start).toBeGreaterThan(first.start);
    expect(SOURCE.slice(second.start, second.end)).toBe('identity mapping');
    // And back again: the stored span names the same occurrence.
    expect(spanNth(SOURCE, second)).toBe(1);
    expect(spanNth(SOURCE, first)).toBe(0);
  });

  it('says null for words the source does not spell, such as a formula', () => {
    expect(locateQuote(SOURCE, 'F(x)=0 the block', 0)).toBeNull();
    expect(locateQuote(SOURCE, '   ', 0)).toBeNull();
  });
});

describe('small helpers', () => {
  it('collapses whitespace like a selection does', () => {
    expect(normaliseWords('  a\n  b\tc ')).toBe('a b c');
  });

  it('counts and finds occurrences, overlapping ones too', () => {
    expect(occurrencesBefore('aaa', 'aa', 2)).toBe(2);
    expect(occurrencesBefore('abcabc', 'bc', 3)).toBe(1);
    expect(nthIndexOf('abcabc', 'bc', 1)).toBe(4);
    expect(nthIndexOf('abc', 'bc', 1)).toBe(-1);
  });
});
