import { describe, expect, it } from 'vitest';

import {
  shownAnswerText,
  DIAGRAM_PLACEHOLDER,
  answerBlocks,
  exportParagraphs,
  firstLine,
  firstSentence,
  moreLineCount,
  normaliseMath,
  stripHandles,
} from './answerText';

const ANSWER = [
  '## TL;DR',
  'The block learns a correction, $F(x)$, and adds the input back. [b3]',
  '',
  '## How it works',
  'Start from the input $x$.',
  '```diagram',
  '{"part":"x"}',
  '```',
  '$$y = F(x) + x$$',
  '',
  '```check',
  'prompt: If $F(x) = 0$ the block outputs ___.',
  'accept: x',
  '```',
].join('\n');

describe('answerBlocks', () => {
  it('splits headings, paragraphs and the two fences', () => {
    expect(answerBlocks(ANSWER).map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'diagram',
      'paragraph',
      'check',
    ]);
  });

  it('keeps a plain old answer as paragraphs', () => {
    expect(answerBlocks('One.\n\nTwo.')).toEqual([
      { kind: 'paragraph', text: 'One.' },
      { kind: 'paragraph', text: 'Two.' },
    ]);
  });

  it('leaves out a fence that never closed', () => {
    expect(answerBlocks('Text\n```diagram\n{"part"')).toEqual([
      { kind: 'paragraph', text: 'Text' },
    ]);
  });
});

describe('first line and sentence', () => {
  it('takes the TL;DR paragraph without its handle', () => {
    expect(firstLine(ANSWER)).toBe(
      'The block learns a correction, $F(x)$, and adds the input back.',
    );
  });

  it('is empty for an empty answer', () => {
    expect(firstLine('')).toBe('');
  });

  it('cuts at the first sentence end', () => {
    expect(firstSentence('It adds x. Then it trains.')).toBe('It adds x.');
    expect(firstSentence('no end here')).toBe('no end here');
  });
});

describe('export text', () => {
  it('bolds the lead, keeps maths as dollars, notes the diagram and drops the check', () => {
    expect(exportParagraphs(ANSWER)).toEqual([
      '**The block learns a correction, $F(x)$, and adds the input back.**',
      'Start from the input $x$.',
      DIAGRAM_PLACEHOLDER,
      '$$y = F(x) + x$$',
    ]);
  });

  it('strips handles, including a comma list', () => {
    expect(stripHandles('Said so [b3]. And so [b4, b5].')).toBe('Said so. And so.');
  });

  it('turns a typographic minus inside maths into a plain one, and leaves prose alone', () => {
    expect(normaliseMath('a − b and $x − 1$')).toBe('a − b and $x - 1$');
  });

  it('never reports fewer than one more line', () => {
    expect(moreLineCount('short')).toBe(1);
    expect(moreLineCount('x'.repeat(420))).toBe(9);
  });
});

describe('shownAnswerText', () => {
  const streamed = { text: 'Intro\n```diagram\nbox: a\n```\nBody.' };
  it('shows the streamed words while it writes, and the STORED text once it is over', () => {
    const node = { final_text: 'Intro\nBody.', body: '' };
    expect(shownAnswerText(node, streamed, true)).toBe(streamed.text);
    expect(shownAnswerText(node, streamed, false)).toBe('Intro\nBody.');
  });
  it('falls back to what streamed while nothing is stored, then to the card body', () => {
    expect(shownAnswerText({ final_text: null, body: 'b' }, streamed, false)).toBe(streamed.text);
    expect(shownAnswerText({ final_text: null, body: 'b' }, undefined, false)).toBe('b');
  });
});
