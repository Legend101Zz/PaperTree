import { describe, expect, it } from 'vitest';

import { answerParagraphs, buildExchanges, formatAskTime, type Exchange } from './exchange';
import { originOf } from './threads';
import { GOLDEN, goldenMessages } from '../../../../test/fixtures/attention-thread';

import type { ThreadMessage } from './messages';

const origin = originOf(GOLDEN.thread);

function build(messages: readonly ThreadMessage[] = goldenMessages()): Exchange<ThreadMessage>[] {
  return buildExchanges(messages, origin);
}

function tabs(exchange: Exchange | undefined): string[] {
  return (exchange?.model?.trace ?? []).map(
    (row) => `p. ${String(row.page)}${row.para === null ? '' : ` ¶${String(row.para)}`}`,
  );
}

describe('the golden thread as exchanges (frame 04)', () => {
  const [first, second] = build();

  it('names each exchange by its ask, oldest first, with its time', () => {
    expect(build().map((e) => e.ask)).toEqual([
      'Explain this passage.',
      'Why does dropping recurrence make training faster?',
    ]);
    expect(first?.askedAt).toBe('2026-10-15T17:14:13.068Z');
    expect(formatAskTime(first?.askedAt ?? null, 'UTC')).toBe('17:14');
  });

  it('quotes the selected passage with its tab on the first call slip only', () => {
    expect(first?.quote?.text.startsWith('We propose a new simple network architecture')).toBe(
      true,
    );
    expect(first?.quote).toMatchObject({ page: 1, para: 1 });
    expect(second?.quote).toBeNull();
  });

  it('traces 4 passages: tabs, sections, cited counts and the paper’s words', () => {
    const trace = first?.model?.trace ?? [];
    expect(trace.map((r) => r.n)).toEqual([1, 2, 3, 4]);
    expect(tabs(first)).toEqual(['p. 1 ¶1', 'p. 2 ¶2', 'p. 2 ¶3', 'p. 2 ¶4']);
    expect(trace.map((r) => r.where)).toEqual([
      'Abstract',
      'Introduction',
      'Introduction',
      'Introduction',
    ]);
    expect(trace.map((r) => r.citedCount)).toEqual([5, 1, 2, 3]);
    expect(trace.every((r) => r.status === 'cited')).toBe(true);
    // De-hyphenated and on one line: "transduc-\ntion" reads "transduction".
    expect(trace[0]?.quote).toMatch(/^The dominant sequence transduction models are based on/);
    expect(trace[2]?.quote).toContain('sequence modeling and transduction models');
  });

  it('reads 4 passages · 11 citations · 1 paragraph uncited, the 5th paragraph the AI’s own', () => {
    const model = first?.model;
    expect(model?.coverage).toEqual({ passages: 4, citations: 11, uncitedParagraphs: 1 });
    expect(model?.body.map((p) => p.markers.map((m) => m.n))).toEqual([
      [1],
      [1, 2, 3],
      [4],
      [1, 4],
    ]);
    expect(model?.uncited.map((p) => p.index)).toEqual([4]);
    expect(model?.uncited[0]?.text).toMatch(/^This is my reading, not the paper's claim/);
  });

  it('keeps the thread’s numbers in the follow-up: its first marker is 2, p. 2 ¶2', () => {
    const model = second?.model;
    expect(model?.body[0]?.markers.map((m) => [m.n, m.page, m.para])).toEqual([[2, 2, 2]]);
    expect(model?.body[4]?.markers.map((m) => m.n)).toEqual([1, 4]);
    expect(model?.trace.map((r) => [r.n, r.citedCount])).toEqual([
      [1, 2],
      [2, 5],
      [4, 2],
    ]);
    expect(model?.coverage).toEqual({ passages: 3, citations: 9, uncitedParagraphs: 0 });
    expect(model?.uncited).toEqual([]);
  });
});

describe('exchange building beyond the stored copy', () => {
  it('recomputes the coverage the server sends, paragraph for paragraph', () => {
    const live = goldenMessages().map((m) => ({ ...m, coverage: null }));
    const [first, second] = build(live);
    expect(first?.model?.coverage).toEqual({ passages: 4, citations: 11, uncitedParagraphs: 1 });
    expect(first?.model?.uncited.map((p) => p.index)).toEqual([4]);
    expect(second?.model?.coverage).toEqual({ passages: 3, citations: 9, uncitedParagraphs: 0 });
  });

  it('marks a passage "not verified" when any of its citations was not matched', () => {
    const messages = goldenMessages().map((m) => ({
      ...m,
      citations: m.citations.map((c) => (c.marker === 'b7' ? { ...c, supported: false } : c)),
    }));
    const row = build(messages)[0]?.model?.trace.find((r) => r.n === 3);
    expect(row?.status).toBe('not-verified');
    expect(build(messages)[0]?.model?.markers.get(3)?.notVerified).toBe(true);
  });

  it('while streaming: no uncited block, no half-typed handle', () => {
    const answer = goldenMessages()[1] as ThreadMessage;
    const streaming = {
      ...answer,
      status: 'streaming' as const,
      text: 'Partly [b1]. Then [b',
      citations: [],
      coverage: null,
    };
    const model = build([goldenMessages()[0] as ThreadMessage, streaming])[0]?.model;
    expect(model?.uncited).toEqual([]);
    expect(model?.coverage.uncitedParagraphs).toBe(0);
    expect(model?.body[0]?.text).toBe('Partly [b1]. Then');
  });

  it('names a live answer whose ask is not loaded yet by the question it answers', () => {
    const answer = { ...(goldenMessages()[1] as ThreadMessage), question: 'Explain this passage.' };
    const [only] = build([answer]);
    expect(only?.ask).toBe('Explain this passage.');
    expect(only?.key).toBe(answer.key);
    expect(only?.quote?.para).toBe(1);
  });

  it('an answer with no citation at all is all the AI’s own reading', () => {
    const answer = {
      ...(goldenMessages()[1] as ThreadMessage),
      text: 'The paper does not say.\n\nNor does it hint.',
      citations: [],
      coverage: null,
    };
    const model = build([answer])[0]?.model;
    expect(model?.body).toEqual([]);
    expect(model?.uncited.map((p) => p.index)).toEqual([0, 1]);
    expect(model?.coverage).toEqual({ passages: 0, citations: 0, uncitedParagraphs: 2 });
  });

  it('splits paragraphs like the server: blank lines, headings dropped', () => {
    expect(answerParagraphs('# Title\n\nOne [b1].\n  \nTwo\nstill two.\n\n## Next\n\n')).toEqual([
      'One [b1].',
      'Two\nstill two.',
    ]);
  });
});
