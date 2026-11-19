/**
 * Where an answer's source line sits (#340, V3-AI-NOTES "Where a source line appears"): a SECTIONED
 * answer has ONE line, at the end of "In the paper", gathering every handle of the whole answer in
 * document order (none at all: one "General knowledge" there); no other paragraph carries one. An
 * UNSECTIONED older answer keeps a line only under a paragraph that has handles, and no answer or
 * summary bullet ever says "General knowledge" there.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Answer, sourceLines } from './answer-render';
import { anchorFixture } from './s6-support';

import type { Citation } from '@/lib/api/types';

afterEach(cleanup);

const cite = (marker: string, page: number): Citation =>
  ({
    citation_id: `cit_${marker}`,
    ordinal: Number(marker.slice(1)),
    marker,
    page_index: page - 1,
    anchor: anchorFixture(marker),
  }) as Citation;

const CITES = [cite('b1', 7), cite('b2', 2), cite('b3', 7)];

const SECTIONED = [
  '## TL;DR',
  'The whole idea.',
  '',
  '## In plain words',
  'Think of an editor [b1].',
  '',
  '## How it works',
  'Add the input back [b2] [b3].',
  '',
  '## In the paper',
  'The paper reports no extra parameters.',
].join('\n');

/** Which block each `.pt-source` line follows: the text of the element before it. */
function previousOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.pt-source')].map((line) => {
    const row = line.closest('.pt-ai-sourceline') ?? line.parentElement;
    return row?.previousElementSibling?.textContent ?? '';
  });
}

describe('a sectioned answer: one source line, at the end of "In the paper"', () => {
  it('gathers every handle of the whole answer, in document order, each page once', () => {
    const { container } = render(<Answer text={SECTIONED} citations={CITES} />);
    expect(sourceLines(container)).toEqual(['From the paper: p. 7 · p. 2']);
    expect(previousOf(container)).toEqual(['The paper reports no extra parameters.']);
  });

  it('sits last in the "In the paper" section, before nothing under the earlier sections', () => {
    const { container } = render(<Answer text={SECTIONED} citations={CITES} />);
    const source = container.querySelector('.pt-source') as HTMLElement;
    expect(source.closest('.pt-ai-sourceline')?.nextElementSibling).toBeNull();
    for (const text of ['The whole idea.', 'Think of an editor', 'Add the input back']) {
      const row = [...container.querySelectorAll('.pt-ai-slip__row')].find((r) =>
        r.textContent?.includes(text),
      );
      expect(row?.querySelector('.pt-source'), text).toBeNull();
    }
  });

  it('an answer with no handle at all says "General knowledge" once, in that place', () => {
    const plain = SECTIONED.replace(/ \[b\d\]/g, '');
    const { container } = render(<Answer text={plain} citations={CITES} general />);
    expect(sourceLines(container)).toEqual(['General knowledge']);
    expect(previousOf(container)).toEqual(['The paper reports no extra parameters.']);
  });

  it('says nothing about general knowledge until the answer has settled', () => {
    const plain = SECTIONED.replace(/ \[b\d\]/g, '');
    const { container } = render(<Answer text={plain} citations={CITES} />);
    expect(sourceLines(container)).toEqual([]);
  });

  it('while streaming, no line appears (and moves) before "In the paper" has begun', () => {
    const early = SECTIONED.slice(0, SECTIONED.indexOf('## In the paper'));
    const { container } = render(<Answer text={early} citations={CITES} status="streaming" />);
    expect(sourceLines(container)).toEqual([]);
    const later = `${early}## In the paper\nThe paper reports`;
    const view = render(<Answer text={later} citations={CITES} status="streaming" />);
    expect(sourceLines(view.container)).toEqual(['From the paper: p. 7 · p. 2']);
  });

  it('a settled answer with no "In the paper" section ends in the line after its last paragraph', () => {
    const noPaper = SECTIONED.slice(0, SECTIONED.indexOf('## In the paper')).trimEnd();
    const { container } = render(<Answer text={noPaper} citations={CITES} />);
    expect(sourceLines(container)).toEqual(['From the paper: p. 7 · p. 2']);
    expect(previousOf(container)).toEqual(['Add the input back.']);
  });
});

describe('an unsectioned (older stored) answer', () => {
  const OLD = 'Claim [b1].\n\nSecond claim [b2].\n\nThe AI knows this.';

  it('keeps a line under each paragraph that has handles, never "General knowledge"', () => {
    const { container } = render(<Answer text={OLD} citations={CITES} general />);
    expect(sourceLines(container)).toEqual(['From the paper: p. 7', 'From the paper: p. 2']);
    expect(container.querySelector('.pt-source--general')).toBeNull();
  });
});
