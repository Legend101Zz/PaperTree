/**
 * #204's pure parts: live markers while an answer streams (partial `[b` never shows, a handle the
 * thread knows resolves at once, an unknown one draws nothing), the Stop note and its no-text rule,
 * the daily-cap figures and usage rows, and the folded earlier answer. The thread is the golden
 * Attention thread (frame 04's real stored thread).
 */
import { describe, expect, it } from 'vitest';

import { buildExchanges } from './exchange';
import {
  budgetFigures,
  foldedCounts,
  foldedPreview,
  formatUsd,
  opensFolded,
  refusalSentence,
  refusedBeforeStream,
  stoppedNote,
  usageRows,
  wasNotSent,
  wasStopped,
} from './states';
import { originOf } from './threads';
import { GOLDEN, goldenMessages } from '../../../../test/fixtures/attention-thread';

import type { ThreadMessage } from './messages';

function liveFollowUp(text: string, over: Partial<ThreadMessage> = {}): ThreadMessage[] {
  const stored = goldenMessages();
  const answer = stored[3] as ThreadMessage;
  return [
    ...stored,
    { ...(stored[2] as ThreadMessage), key: 'm-ask', messageId: null, text: 'And the cost?' },
    {
      ...answer,
      key: 'm-live',
      messageId: null,
      text,
      status: 'streaming',
      citations: [],
      coverage: null,
      usage: null,
      ...over,
    },
  ];
}

function live(text: string) {
  const exchanges = buildExchanges(liveFollowUp(text), originOf(GOLDEN.thread));
  return exchanges[2]?.model;
}

describe('live markers while an answer streams (#204)', () => {
  it('a handle the thread already resolved draws its passage number and final tab at once', () => {
    const model = live('Recurrence is sequential [b6]. And');
    expect(model?.live).toBe(true);
    expect(model?.handleNumbers.get('b6')).toBe(2);
    const marker = model?.body[0]?.markers[0];
    expect(marker).toMatchObject({ n: 2, page: 2, para: 2, notVerified: false });
    // The verdict is this claim's, not the earlier answer's: unknown until its own citations land.
    expect(marker?.citation.supported).toBeNull();
    expect(model?.trace).toEqual([]);
  });

  it('a partial handle at the end of a chunk is dropped, never shown raw', () => {
    for (const tail of ['[', '[b', '[b6', '[b6, b', '[b6, b8']) {
      const model = live(`Recurrence is sequential ${tail}`);
      expect(model?.body[0]?.text).toBe('Recurrence is sequential');
      expect(model?.body[0]?.markers).toEqual([]);
    }
  });

  it('a handle nobody resolved yet draws nothing until its citation arrives', () => {
    const model = live('A new claim [b9].');
    expect(model?.handleNumbers.has('b9')).toBe(false);
    expect(model?.body[0]?.markers).toEqual([]);
    expect(model?.body[0]?.cited).toBe(true); // nothing is classed uncited while it streams
  });

  it("the answer's own citations, once they arrive, keep the same number", () => {
    const own = { ...(GOLDEN.messages[3]?.citations[0] as ThreadMessage['citations'][number]) };
    const { locator: _locator, ...bare } = own; // a live citation carries no locator
    const exchanges = buildExchanges(
      liveFollowUp('Recurrence is sequential [b6].', { citations: [bare], generation: 1 }),
      originOf(GOLDEN.thread),
    );
    expect(exchanges[2]?.model?.handleNumbers.get('b6')).toBe(2);
    expect(exchanges[2]?.model?.body[0]?.markers[0]).toMatchObject({ n: 2, page: 2, para: 2 });
  });
});

describe('after Stop, before the stored copy lands (#204)', () => {
  const text =
    'Recurrence is sequential [b6].\n\nSo training is slow [b6, b1].\n\nA new claim [b9]. And [b';

  it('the markers shown live stay; a claim citing an unseen handle is held, not shown uncited', () => {
    const messages = liveFollowUp(text, { status: 'aborted', stopped: true, awaitingStored: true });
    const model = buildExchanges(messages, originOf(GOLDEN.thread))[2]?.model;
    // Held as while streaming: nothing classed uncited, no trace or readout to move later.
    expect(model?.live).toBe(true);
    expect(model?.body.map((p) => [p.markers.map((m) => m.n), p.cited])).toEqual([
      [[2], true],
      [[2, 1], true],
      [[], true],
    ]);
    expect(model?.uncited).toEqual([]);
    expect(model?.trace).toEqual([]);
    // The cut-off run at the end never reaches the screen as text.
    expect(model?.body.at(-1)?.text).toBe('A new claim [b9]. And');
  });

  it('once the stored copy lands with its citations, the trace stands on what arrived', () => {
    const golden = GOLDEN.messages[3]?.citations ?? [];
    const own = ['b6', 'b1'].map((h) => golden.find((c) => c.marker === h)).flatMap((c) => c ?? []);
    const messages = liveFollowUp(text, {
      status: 'aborted',
      stopped: true,
      awaitingStored: false,
      citations: own,
      generation: 1,
    });
    const model = buildExchanges(messages, originOf(GOLDEN.thread))[2]?.model;
    expect(model?.live).toBe(false);
    expect(model?.body.map((p) => p.markers.map((m) => m.n))).toEqual([[2], [2, 1]]);
    expect(model?.uncited.map((p) => p.text)).toEqual(['A new claim [b9]. And']);
    expect(model?.trace.map((r) => [r.n, r.citedCount])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});

describe('after Stop (#204, #179)', () => {
  it('says the part that arrived is kept only when something arrived', () => {
    expect(stoppedNote('Half an answer')).toBe('Stopped. The part that arrived is kept.');
    expect(stoppedNote('')).toBe('Stopped before any text arrived.');
    expect(stoppedNote('  \n ')).toBe('Stopped before any text arrived.');
  });

  it('a stored aborted answer was stopped; an agent that went away was not', () => {
    const base = { stopped: false, status: 'aborted' as const, failure: null };
    expect(wasStopped({ ...base, stopped: true, status: 'streaming' })).toBe(true);
    expect(wasStopped({ ...base, failure: { code: 'aborted', retryable: true } })).toBe(true);
    expect(wasStopped(base)).toBe(true);
    expect(
      wasStopped({
        ...base,
        status: 'partial',
        failure: { code: 'agent_unavailable', retryable: true },
      }),
    ).toBe(false);
  });

  it('only a refusal before the stream is "not sent"', () => {
    expect(
      wasNotSent({ failure: { code: 'budget_exhausted', retryable: false, notSent: true } }),
    ).toBe(true);
    expect(wasNotSent({ failure: { code: 'network', retryable: true } })).toBe(false);
    expect(wasNotSent(null)).toBe(false);
  });
});

describe('what a refusal before the stream may claim (#204 review 1.1)', () => {
  it('only a documented pre-stream refusal (an error status) counts as not sent', () => {
    expect(refusedBeforeStream(429, 'budget_exhausted')).toBe(true);
    expect(refusedBeforeStream(503, 'agent_unavailable')).toBe(true);
    expect(refusedBeforeStream(409, 'busy')).toBe(true);
    // A 200 whose stream was empty, and a proxy's own 502 page: the rows may exist.
    expect(refusedBeforeStream(200, 'internal')).toBe(false);
    expect(refusedBeforeStream(502, 'internal')).toBe(false);
  });

  it('says "kept" only while the box holds the question, and never "not sent" of a sent one', () => {
    expect(refusalSentence('kept')).toBe(
      'Your question was not sent; your text is kept in the box below.',
    );
    expect(refusalSentence('question')).toBe('Your question was not sent.');
    expect(refusalSentence('retry')).toBe(
      'Your retry was not sent; the answer above is as it was.',
    );
    expect(refusalSentence('nothing')).toBe('Nothing was sent to the AI.');
  });
});

describe('the daily cap (#204, frame 04c)', () => {
  it('writes cents, and four decimals below a cent so real spend never reads $0.00', () => {
    expect(formatUsd(0.9712)).toBe('$0.97');
    expect(formatUsd(0.0027)).toBe('$0.0027');
    expect(formatUsd(0)).toBe('$0.00');
    expect(budgetFigures({ cost_usd_est: 0.0036, budget_usd: 0.001 })).toBe(
      '≈ $0.0036 of $0.0010 used in the last 24 hours (estimate).',
    );
  });

  it('states the figures as an estimate', () => {
    expect(budgetFigures({ cost_usd_est: 0.9712, budget_usd: 1 })).toBe(
      '≈ $0.97 of $1.00 used in the last 24 hours (estimate).',
    );
  });

  it("lists today's usage by kind, leaving out kinds that did not run", () => {
    const bucket = (runs: number, cost: number) => ({
      runs,
      input_tokens: 10_000,
      output_tokens: 2_345,
      cost_usd_est: cost,
    });
    expect(
      usageRows({
        by_kind: {
          explain: bucket(3, 0.31),
          ask: bucket(0, 0),
          summary: bucket(1, 0.6),
          diagram: bucket(2, 0.004),
          topic: bucket(0, 0),
        },
      }),
    ).toEqual([
      { kind: 'Explain', line: '3 runs · 12,345 tokens · ≈ $0.31 (estimate)' },
      { kind: 'Summaries', line: '1 run · 12,345 tokens · ≈ $0.60 (estimate)' },
      { kind: 'Diagrams', line: '2 runs · 12,345 tokens · ≈ $0.0040 (estimate)' },
    ]);
    expect(usageRows({ by_kind: {} as never })).toEqual([]);
  });
});

describe('a folded earlier answer (#204, frame 04c)', () => {
  it('a long thread opens with its last two exchanges whole', () => {
    expect([0, 1].map((i) => opensFolded(i, 2))).toEqual([false, false]);
    expect([0, 1, 2, 3].map((i) => opensFolded(i, 4))).toEqual([true, true, false, false]);
  });

  it('shows its counts from data and its first paragraph as plain words', () => {
    const first = buildExchanges(goldenMessages(), originOf(GOLDEN.thread))[0]?.model;
    expect(
      foldedCounts(first?.coverage ?? { passages: 0, citations: 0, uncitedParagraphs: 0 }),
    ).toBe("4 passages · 11 citations · 1 paragraph uncited (the AI's own reading)");
    expect(foldedPreview([{ text: 'The **Transformer** drops recurrence [b1, b8].' }])).toBe(
      'The Transformer drops recurrence.',
    );
    expect(foldedPreview([{ text: 'Each layer has width d_model = 512 [b3].' }])).toBe(
      'Each layer has width d_model = 512.',
    );
  });
});
