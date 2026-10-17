import { describe, expect, it } from 'vitest';

import {
  citationUse,
  handleRuns,
  numberPassages,
  passageKeyOf,
  runNumbers,
  type CitedAnswer,
} from './passages';
import { GOLDEN } from '../../../../test/fixtures/attention-thread';

import type { Citation } from '@/lib/api/types';

const answers: CitedAnswer[] = GOLDEN.messages
  .filter((m) => m.role === 'assistant')
  .map((m) => ({ text: m.content, citations: m.citations }));
const [first, followUp] = answers as [CitedAnswer, CitedAnswer];

function byMarker(answer: CitedAnswer, marker: string): Citation {
  const found = answer.citations.find((c) => c.marker === marker);
  if (found === undefined) throw new Error(`no ${marker}`);
  return found;
}

function bare(citation: Citation): Citation {
  const { locator: _dropped, ...rest } = citation;
  return rest;
}

describe('passage numbers on the golden thread (thr_01M508X9PC9K9HKHSVB2J9W1A1)', () => {
  const numbers = numberPassages(answers);
  const numberOf = (answer: CitedAnswer, marker: string): number | undefined =>
    numbers.byKey.get(passageKeyOf(byMarker(answer, marker), numbers.keyOfHandle));

  it('numbers b1, b6, b7, b8 as 1, 2, 3, 4 in order of first use', () => {
    expect(['b1', 'b6', 'b7', 'b8'].map((m) => numberOf(first, m))).toEqual([1, 2, 3, 4]);
    expect(numbers.byKey.size).toBe(4);
  });

  it('keeps each passage’s number in the follow-up (frame 04: its marker 2 is p. 2 ¶2)', () => {
    expect(numberOf(followUp, 'b6')).toBe(2);
    expect(numberOf(followUp, 'b1')).toBe(1);
    expect(numberOf(followUp, 'b8')).toBe(4);
  });

  it('gives a multi-handle run one marker per passage: [b1, b8] → 1, 4', () => {
    const runs = handleRuns(followUp.text);
    expect(runs[runs.length - 1]).toEqual(['b1', 'b8']);
    expect(runNumbers(['b1', 'b8'], followUp, numbers)).toEqual([1, 4]);
    expect(runNumbers(['b1', 'b1'], followUp, numbers)).toEqual([1]);
  });

  it('counts 11 cited occurrences in the first answer (the design’s "11 citations")', () => {
    const use = citationUse(first);
    expect(use.occurrences).toHaveLength(11);
    expect(use.loose).toHaveLength(0);
  });
});

describe('passage numbers without locators (a live answer before its stored read)', () => {
  it('finds a live citation’s passage through its handle, so numbers never shift', () => {
    const live: CitedAnswer = { text: followUp.text, citations: followUp.citations.map(bare) };
    const numbers = numberPassages([first, live]);
    expect(runNumbers(['b6'], live, numbers)).toEqual([2]);
    expect(runNumbers(['b1', 'b8'], live, numbers)).toEqual([1, 4]);
  });

  it('numbers an answer with no locator anywhere by its handles, in first-use order', () => {
    const live: CitedAnswer = { text: first.text, citations: first.citations.map(bare) };
    const numbers = numberPassages([live]);
    expect(['b1', 'b6', 'b7', 'b8'].map((m) => runNumbers([m], live, numbers)[0])).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('drops a handle with no citation, and keeps a citation the text never mentions', () => {
    const answer: CitedAnswer = {
      text: 'A claim [b1]. A slip [b9].',
      citations: [byMarker(first, 'b1'), { ...byMarker(first, 'b6'), ordinal: 5 }],
    };
    const use = citationUse(answer);
    expect(use.occurrences.map((c) => c.marker)).toEqual(['b1']);
    expect(use.loose.map((c) => c.marker)).toEqual(['b6']);
    const numbers = numberPassages([answer]);
    expect(runNumbers(['b9'], answer, numbers)).toEqual([]);
    expect(numbers.byKey.size).toBe(2);
  });
});
