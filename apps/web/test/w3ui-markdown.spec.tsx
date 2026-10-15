/**
 * W3UI round 2 (#141): the safe Markdown subset, hostile input, chip punctuation, quote display,
 * canvas citation labels.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RichText } from '@/components/explain/RichText';
import type { Citation } from '@/lib/api/types';
import { dehyphenate, parseMarkdown, plainText, truncateAtWord } from '@/lib/markdown';

const cite = (n: number, page = 0): Citation => ({
  citation_id: `cit_${String(n)}`,
  ordinal: n,
  marker: `b${String(n)}`,
  page_index: page,
  anchor: { id: 'a', doc: { paperId: 'p' }, selectors: [] } as never,
  supported: true,
});

describe('markdown subset', () => {
  it('renders emphasis, strong, code, lists and paragraphs', () => {
    const { container } = render(
      <RichText
        citations={[]}
        text={'**Lead-in.** It is *where* the _box_ goes, in `code`.\n\n- one\n- two\n\n1. first\n2. second'}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Lead-in.');
    expect(Array.from(container.querySelectorAll('em')).map((e) => e.textContent)).toEqual(['where', 'box']);
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.textContent).not.toContain('*');
    expect(container.textContent).not.toContain('_box_');
  });

  it('keeps a single newline as a line break', () => {
    const { container } = render(<RichText citations={[]} text={'line one\nline two'} />);
    expect(container.querySelectorAll('p br')).toHaveLength(1);
  });

  it.each([
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '**<img src=x onerror=alert(1)>**',
    '[click](javascript:alert(1))',
    '[<b>x</b>](https://evil.test)',
    '***a** b* **c *d**',
    '**unclosed and *nested',
    '_ _ __ ** * `',
    '`<script>`',
  ])('never renders raw HTML or a link: %s', (hostile) => {
    const { container } = render(<RichText citations={[]} text={hostile} />);
    expect(container.querySelector('script, img, a, b, iframe')).toBeNull();
    expect(container.innerHTML).not.toMatch(/<(script|img|a |b>)/);
    if (hostile.includes('javascript:')) {
      expect(container.textContent).toBe('click');
      expect(container.querySelector('[href]')).toBeNull();
    }
    if (hostile.startsWith('<img')) expect(container.textContent).toBe(hostile);
  });

  it('terminates on unbalanced markers', () => {
    const text = `${'*a '.repeat(500)}${'_'.repeat(50)}${'`'.repeat(51)}${'**'.repeat(77)}`;
    expect(() => parseMarkdown(text)).not.toThrow();
  });

  it('keeps [bN] chips working inside lists and bold', () => {
    const { container } = render(
      <RichText citations={[cite(1), cite(2, 3)]} text={'- **Idea** [b1]\n- second [b2]'} />,
    );
    const chips = container.querySelectorAll('li .pt-chip');
    expect(chips).toHaveLength(2);
    expect(chips[1]?.textContent).toBe('p. 4');
    expect(container.textContent).not.toContain('[b');
  });

  it('glues the full stop to the chip in one unbreakable run', () => {
    const { container } = render(<RichText citations={[cite(1)]} text="uses specialized sensors [b1]." />);
    const run = container.querySelector('.pt-cite-run');
    expect(run?.textContent).toBe('p. 1.');
    expect(run?.querySelector('.pt-chip')).not.toBeNull();
    expect(container.querySelector('p')?.lastChild).toBe(run);
  });

  it('shows a canvas citation as a page label, never as [bN]', () => {
    const { container } = render(
      <RichText citeAs="label" citations={[cite(1, 0)]} text="Classes [b1], names [b9] too [b1, b9]." />,
    );
    expect(container.querySelectorAll('.pt-cite-label')).toHaveLength(2);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).not.toMatch(/\[b\d/);
  });

  it('strips handles when the message has no citations', () => {
    const { container } = render(<RichText citeAs="label" citations={[]} text="Classes [b1], names." />);
    expect(container.textContent).toBe('Classes, names.');
  });

  it('hides unclosed markers while streaming', () => {
    const { container } = render(<RichText streaming citations={[]} text="This is **bold" />);
    expect(container.textContent).toBe('This is bold');
  });

  it('plainText flattens a tree', () => {
    expect(plainText(parseMarkdown('a **b** [b1].'))).toBe('a b.');
  });
});

describe('dehyphenate', () => {
  it.each([
    ['A sin- gle convolutional network', 'A single convolutional network'],
    ['detec- tion performance', 'detection performance'],
    ['multi- ple objects', 'multiple objects'],
    ['regression prob-\nlem', 'regression problem'],
    ['regression prob- \n  lem', 'regression problem'],
    ['state-of-\nthe-art', 'state-of-the-art'],
  ])('joins a line-end hyphen: %j', (input, expected) => {
    expect(dehyphenate(input)).toBe(expected);
  });

  it.each([
    'a real end-to-end detector',
    'state-of-the-art results',
    'pre- and post-training',
    'train- or test-time',
    'a - b',
    'minus-1 value',
  ])('leaves a real hyphen alone: %j', (input) => {
    expect(dehyphenate(input)).toBe(input);
  });
});

describe('underscore identifiers and answer hyphens', () => {
  it('keeps window.__pwn=1 and __init__ literal, with no italics after them', () => {
    for (const src of ['window.__pwn=1 and more', 'call __init__ then run_this_now']) {
      const blocks = parseMarkdown(src);
      expect(plainText(blocks)).toBe(src);
      expect(JSON.stringify(blocks)).not.toContain('"em"');
    }
  });

  it('still renders _emphasis_', () => {
    expect(JSON.stringify(parseMarkdown('a _word_ here'))).toContain('"em"');
  });

  it('joins PDF hyphen breaks inside an answer body', () => {
    const { container } = render(<RichText citations={[]} text="Models per- form well and re- gression works." />);
    expect(container.textContent).toBe('Models perform well and regression works.');
  });
});

describe('compounds broken at a line end keep their hyphen', () => {
  it.each([
    ['data- driven methods', 'data-driven methods'],
    ['a non- linear map', 'a non-linear map'],
    ['a well- known result', 'a well-known result'],
  ])('%j', (input, expected) => {
    expect(dehyphenate(input)).toBe(expected);
  });
});

describe('truncateAtWord', () => {
  it('cuts at a word boundary with an ellipsis', () => {
    const text = 'This unified model has several benefits over traditional methods of object detection';
    const out = truncateAtWord(text, 30);
    expect(out.endsWith('…')).toBe(true);
    const kept = out.slice(0, -1);
    expect(text.startsWith(kept)).toBe(true);
    expect(text[kept.length]).toBe(' ');
    expect(out).toBe('This unified model has several…');
  });
  it('leaves short text alone', () => {
    expect(truncateAtWord('short', 30)).toBe('short');
  });
});

describe('mid-word cut', () => {
  it('never ends inside a word', () => {
    const text = 'This unified model has several benefits over traditional methods of detection';
    for (let max = 20; max < 70; max += 1) {
      const kept = truncateAtWord(text, max).slice(0, -1);
      expect(text.startsWith(kept)).toBe(true);
      expect(kept === text || /\s/.test(text[kept.length] ?? ' ')).toBe(true);
    }
  });
});
