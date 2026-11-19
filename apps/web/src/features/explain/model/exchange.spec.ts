import { describe, expect, it } from 'vitest';

import { buildExchanges, formatAskTime, type Exchange } from './exchange';
import { fromStored, type ThreadMessage } from './messages';
import { originOf } from './threads';
import { GOLDEN, goldenMessages } from '../../../../test/fixtures/attention-thread';
import DIAGRAM from '../../../../test/fixtures/diagram-thread.json';

import type { ThreadDetail } from '../api/threads';
import type { Citation } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

const origin = originOf(GOLDEN.thread);

function build(messages: readonly ThreadMessage[] = goldenMessages()): Exchange<ThreadMessage>[] {
  return buildExchanges(messages, origin);
}

/** Each paragraph's pages, as "From the paper: p. 1 · p. 2" would list them. */
function pages(exchange: Exchange | undefined): number[][] {
  return (exchange?.model?.paragraphs ?? []).map((p) => p.sources.map((s) => s.page));
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

  it('gathers each paragraph’s handles into its pages, once each, in page order', () => {
    // Paragraph 5 is the AI's own words: no handle, no source.
    expect(pages(first)).toEqual([[1], [1, 2], [2], [1, 2], []]);
    expect(first?.model?.paragraphs.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(first?.model?.paragraphs[4]?.text).toMatch(/^This is my reading, not the paper's claim/);
  });

  it('gives each page the passage’s own words, de-hyphenated, for the peek', () => {
    const [p1] = first?.model?.paragraphs ?? [];
    expect(p1?.sources[0]?.passage).toMatch(
      /^The dominant sequence transduction models are based on/,
    );
    expect(p1?.sources[0]?.citation.marker).toBe('b1');
  });

  it('reads the follow-up the same way', () => {
    expect(pages(second)).toEqual([[2], [2], [1, 2], [2], [1, 2]]);
  });
});

describe('exchange building beyond the stored copy', () => {
  it('while streaming: no half-typed handle and no "General knowledge" yet', () => {
    const answer = goldenMessages()[1] as ThreadMessage;
    const streaming = {
      ...answer,
      status: 'streaming' as const,
      text: 'Partly [b1]. Then [b',
      citations: [],
    };
    const [ask1, first, ask2] = goldenMessages() as [ThreadMessage, ThreadMessage, ThreadMessage];
    const model = build([ask1, first, ask2, streaming])[1]?.model;
    expect(model?.live).toBe(true);
    expect(model?.paragraphs[0]?.text).toBe('Partly [b1]. Then');
    // The thread already resolved b1 (the first answer), so its page shows at once, from the
    // first answer's citation of it.
    expect(model?.paragraphs[0]?.sources.map((s) => s.page)).toEqual([1]);
  });

  it('names a live answer whose ask is not loaded yet by the question it answers', () => {
    const answer = { ...(goldenMessages()[1] as ThreadMessage), question: 'Explain this passage.' };
    const [only] = build([answer]);
    expect(only?.ask).toBe('Explain this passage.');
    expect(only?.key).toBe(answer.key);
    expect(only?.quote?.para).toBe(1);
  });

  it('an answer with no handle at all has no source on any paragraph', () => {
    const answer = {
      ...(goldenMessages()[1] as ThreadMessage),
      text: 'The paper does not say.\n\nNor does it hint.',
      citations: [],
    };
    const model = build([answer])[0]?.model;
    expect(model?.live).toBe(false);
    expect(model?.paragraphs.map((p) => [p.index, p.sources.length])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it('splits paragraphs on blank lines and drops an unknown heading line', () => {
    const model = build([
      {
        ...(goldenMessages()[1] as ThreadMessage),
        text: '# Title\n\nOne [b1].\n  \nTwo\nstill two.\n\n## Next\n\n',
      },
    ])[0]?.model;
    expect(model?.paragraphs.map((p) => p.text)).toEqual(['One [b1].', 'Two\nstill two.']);
  });
});

describe('sources (#340)', () => {
  const answer = goldenMessages()[1] as ThreadMessage;
  const cite = (marker: string): Citation =>
    answer.citations.find((c) => c.marker === marker) as Citation;

  it('a paragraph citing b3 (p. 3) and b7 (p. 1) lists p. 1 then p. 3, each once', () => {
    const at = (c: Citation, pageIndex: number, marker: string): Citation => {
      const { locator: _l, ...rest } = c;
      return { ...rest, marker, citation_id: `cit_${marker}`, page_index: pageIndex };
    };
    const model = build([
      {
        ...answer,
        text: 'Claim [b3]. Another [b7]. Again [b3].',
        citations: [at(cite('b1'), 2, 'b3'), at(cite('b1'), 0, 'b7')],
      },
    ])[0]?.model;
    expect(model?.paragraphs[0]?.sources.map((s) => s.page)).toEqual([1, 3]);
  });

  it('a handle that resolves to nothing is not a source', () => {
    const model = build([
      { ...answer, text: 'Cited [b1].\n\nInvented [b9].', citations: [cite('b1')] },
    ])[0]?.model;
    expect(model?.paragraphs.map((p) => p.sources.length)).toEqual([1, 0]);
  });

  it('a settled live answer lists its pages at once, from the citation alone (no locator)', () => {
    const { locator: _l, ...bare } = cite('b6');
    const model = buildExchanges(
      [{ ...answer, text: 'A [b6].', citations: [bare] as Citation[] }],
      null,
    )[0]?.model;
    expect(model?.paragraphs[0]?.sources.map((s) => s.page)).toEqual([2]);
  });

  it('a selection whose Anchor names no page gets no tab, never a guessed "p. 1"', () => {
    const anchor = GOLDEN.thread.origin_anchor as Anchor;
    const noPage = {
      ...anchor,
      selectors: anchor.selectors.filter((s) => s.type !== 'PageSelector'),
    };
    const [first] = buildExchanges(goldenMessages(), { anchor: noPage, quote: 'We propose' });
    expect(first?.quote).toMatchObject({ page: null });
  });
});

describe('a diagram thread (#217)', () => {
  it('places the call slip’s ¶ from a plate part on the selected block (p. 4 ¶1)', () => {
    const detail = DIAGRAM as unknown as ThreadDetail;
    let ask = '';
    const messages = detail.messages.map((m) => {
      if (m.role === 'user') ask = m.content;
      return fromStored(m, m.role === 'user' ? '' : ask);
    });
    const [first] = buildExchanges(messages, originOf(detail.thread));
    expect(first?.quote).toMatchObject({ page: 4, para: 1 });
  });
});

describe('answers at other levels (v0.3)', () => {
  const [ask, answer] = goldenMessages() as [ThreadMessage, ThreadMessage];
  const root = { ...answer, level: 'familiar' as const, messageId: 'msg_root' };
  const sibling = (level: 'new' | 'expert', key: string, over: Partial<ThreadMessage> = {}) => ({
    ...root,
    key,
    messageId: `msg_${key}`,
    level,
    siblingGroup: 'msg_root',
    text: `Answer at ${level}.`,
    ...over,
  });

  it('a re-levelled answer joins the exchange of the answer it re-levels, never a new one', () => {
    const exchanges = build([ask, root, sibling('expert', 'e'), sibling('new', 'n')]);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.answer).toBe(root);
    expect(exchanges[0]?.variants.map((v) => v.level)).toEqual(['familiar', 'expert', 'new']);
    expect(exchanges[0]?.variants[1]?.model?.paragraphs[0]?.text).toBe('Answer at expert.');
  });

  it('an answer with no level is Familiar', () => {
    const exchanges = build([ask, { ...answer, level: null }]);
    expect(exchanges[0]?.variants.map((v) => v.level)).toEqual(['familiar']);
  });

  it('keeps one answer per level: a retried sibling replaces the attempt it retried', () => {
    const failed = sibling('expert', 'e1', { status: 'error', text: '' });
    const retried = sibling('expert', 'e2');
    const exchanges = build([ask, root, failed, retried]);
    const expert = exchanges[0]?.variants.filter((v) => v.level === 'expert');
    expect(expert).toHaveLength(1);
    expect(expert?.[0]?.answer.key).toBe('e2');
  });

  it('a follow-up after a level switch is its own exchange, and the siblings stay on the first', () => {
    const [, , ask2, answer2] = goldenMessages() as ThreadMessage[] as [
      ThreadMessage,
      ThreadMessage,
      ThreadMessage,
      ThreadMessage,
    ];
    const exchanges = build([ask, root, sibling('expert', 'e'), ask2, answer2]);
    expect(exchanges.map((e) => e.variants.length)).toEqual([2, 1]);
  });

  it('a sibling whose root is not in the thread stays an exchange of its own', () => {
    const orphan = sibling('expert', 'o', { siblingGroup: 'msg_gone' });
    expect(build([ask, root, orphan])).toHaveLength(2);
  });
});
