/**
 * #338: maths in the one Markdown parser. `$…$` / `$$…$$` / `\(…\)` / `\[…\]` become `math` and
 * `dm` nodes holding TeX source; currency, escapes, code and an unclosed tail stay text; what is
 * inside maths is opaque to emphasis, handles and dehyphenation.
 */
import { describe, expect, it } from 'vitest';

import {
  dehyphenate,
  endsInsideMath,
  inlinePlain,
  mathToPlain,
  parseMarkdown,
  plainText,
  splitMath,
  type Block,
  type Inline,
} from '@/lib/markdown';
import { texToPlain } from '@/lib/texPlain';

type Wrapped = Extract<Inline, { t: 'em' | 'strong' }>;

const lineOf = (text: string, options = {}): readonly Inline[] => {
  const block = parseMarkdown(text, options)[0] as Block;
  if (block.k !== 'p') throw new Error(`expected a paragraph, got ${block.k}`);
  return block.lines[0] as readonly Inline[];
};

const maths = (nodes: readonly Inline[]): string[] =>
  nodes.flatMap((n) => (n.t === 'math' ? [n.tex] : []));

describe('inline maths', () => {
  it('reads $…$ as a math node between text', () => {
    expect(lineOf('the residual $F(x) := H(x) - x$ is learnt')).toEqual([
      { t: 'text', v: 'the residual ' },
      { t: 'math', tex: 'F(x) := H(x) - x', display: false },
      { t: 'text', v: ' is learnt' },
    ]);
  });

  it('reads \\(…\\) as inline maths', () => {
    expect(maths(lineOf('so \\(y = x\\) holds'))).toEqual(['y = x']);
  });

  it('leaves currency as text', () => {
    const nodes = lineOf('it costs $5 and $10 each');
    expect(nodes).toEqual([{ t: 'text', v: 'it costs $5 and $10 each' }]);
    expect(lineOf('between $5 and $x$ today')).toEqual([
      { t: 'text', v: 'between $5 and ' },
      { t: 'math', tex: 'x', display: false },
      { t: 'text', v: ' today' },
    ]);
  });

  it('needs a non-space after the opening and before the closing dollar', () => {
    expect(maths(lineOf('a $ x $ b'))).toEqual([]);
    expect(maths(lineOf('a $x $ b'))).toEqual([]);
    expect(maths(lineOf('a $x$ b'))).toEqual(['x']);
  });

  it('does not close on a dollar that a digit follows', () => {
    expect(maths(lineOf('$x$5'))).toEqual([]);
  });

  it('treats \\$ as a literal dollar sign', () => {
    expect(lineOf('pay \\$5 or \\$6 now')).toEqual([{ t: 'text', v: 'pay $5 or $6 now' }]);
    expect(maths(lineOf('$a \\$ b$'))).toEqual(['a \\$ b']);
  });

  it('does not look inside code', () => {
    const nodes = lineOf('run `echo $HOME and $PATH` then $x$');
    expect(nodes.find((n) => n.t === 'code')).toEqual({ t: 'code', v: 'echo $HOME and $PATH' });
    expect(maths(nodes)).toEqual(['x']);
  });

  it('keeps _ and * inside maths out of emphasis', () => {
    const nodes = lineOf('see $x_i * y_j$ and _really_ so');
    expect(maths(nodes)).toEqual(['x_i * y_j']);
    expect(nodes.filter((n) => n.t === 'em')).toHaveLength(1);
    expect(maths(lineOf('$a_1 + b_2$'))).toEqual(['a_1 + b_2']);
  });

  it('nests maths inside emphasis and strong', () => {
    const nodes = lineOf('**the $x_0$ case** and *a $y$ one*');
    const strong = nodes[0] as Wrapped;
    expect(strong.t).toBe('strong');
    expect(maths(strong.c)).toEqual(['x_0']);
    const em = nodes.find((n) => n.t === 'em') as Wrapped;
    expect(maths(em.c)).toEqual(['y']);
  });

  it('keeps a citation handle next to maths a handle, and its punctuation with it', () => {
    const nodes = lineOf('fits $F(x)$ [b3].');
    expect(nodes.map((n) => n.t)).toEqual(['text', 'math', 'cite']);
    expect(nodes[2]).toEqual({ t: 'cite', markers: ['b3'], after: '.' });
    expect(lineOf('a [b1] $x$ [b2]').filter((n) => n.t === 'cite')).toHaveLength(2);
  });

  it('does not read a handle inside maths', () => {
    expect(lineOf('$a[b1]$').map((n) => n.t)).toEqual(['math']);
  });

  it('keeps maths that a line wrap split on one line', () => {
    const [block] = parseMarkdown('a $x\n+ y$ b');
    expect((block as Extract<Block, { k: 'p' }>).lines).toHaveLength(1);
    expect(maths(lineOf('a $x\n+ y$ b'))).toEqual(['x + y']);
  });

  it('finds maths in list items and headings', () => {
    const blocks = parseMarkdown('# About $x$\n\n- first $a$\n- second $b$');
    expect(blocks.map((b) => b.k)).toEqual(['h', 'ul']);
    expect(maths((blocks[0] as Extract<Block, { k: 'h' }>).c)).toEqual(['x']);
    expect((blocks[1] as Extract<Block, { k: 'ul' }>).items.map(maths)).toEqual([['a'], ['b']]);
  });
});

describe('display maths', () => {
  it('makes a $$…$$ line a display block', () => {
    expect(parseMarkdown('so\n\n$$y = F(x) + x$$\n\nnext')).toEqual([
      { k: 'p', lines: [[{ t: 'text', v: 'so' }]] },
      { k: 'dm', tex: 'y = F(x) + x' },
      { k: 'p', lines: [[{ t: 'text', v: 'next' }]] },
    ]);
  });

  it('lets $$ span lines, and splits the paragraph around it', () => {
    const blocks = parseMarkdown('so\n$$\ny =\nF(x) + x\n$$\nnext');
    expect(blocks.map((b) => b.k)).toEqual(['p', 'dm', 'p']);
    expect((blocks[1] as Extract<Block, { k: 'dm' }>).tex).toBe('y = F(x) + x');
  });

  it('reads \\[…\\] as display', () => {
    expect(parseMarkdown('\\[a^2 + b^2\\]')).toEqual([{ k: 'dm', tex: 'a^2 + b^2' }]);
  });

  it('keeps a $$ run that shares its line with text as an inline display node', () => {
    expect(lineOf('where $$x$$ holds')[1]).toEqual({ t: 'math', tex: 'x', display: true });
  });
});

describe('unclosed and broken maths', () => {
  it('shows an unmatched dollar as a dollar', () => {
    expect(lineOf('lone $ here and a$')).toEqual([{ t: 'text', v: 'lone $ here and a$' }]);
    expect(lineOf('ends with $')).toEqual([{ t: 'text', v: 'ends with $' }]);
  });

  it('shows a final unclosed TeX tail as text without its delimiter', () => {
    expect(plainText(parseMarkdown('so $\\frac{a'))).toBe('so \\frac{a');
    expect(plainText(parseMarkdown('so $$ y = F('))).toBe('so  y = F(');
    expect(plainText(parseMarkdown('so \\(x'))).toBe('so x');
  });

  it('hands a closed but invalid string on as maths (the renderer falls back)', () => {
    expect(maths(lineOf('a $\\frac{$ b'))).toEqual(['\\frac{']);
  });

  it('strips private-use characters that would impersonate a placeholder', () => {
    expect(plainText(parseMarkdown('x \uE0000\uE001 y'))).toBe('x 0 y');
  });
});

describe('streaming hold-back', () => {
  const shown = (text: string): string => plainText(parseMarkdown(text, { streaming: true }));

  it('holds back an unclosed $…, $$… and \\(… tail until it closes', () => {
    expect(shown('the residual $F(x) :=')).toBe('the residual');
    expect(shown('the residual $F(x) := H(x) - x$ and $$y = F(')).toBe(
      'the residual F(x) := H(x) - x and',
    );
    expect(shown('so \\(x +')).toBe('so');
    expect(shown('so \\[x +')).toBe('so');
    expect(shown('a $')).toBe('a');
    expect(shown('a $$')).toBe('a');
  });

  it('shows the maths the moment it closes', () => {
    expect(shown('the residual $F(x)$')).toBe('the residual F(x)');
    const blocks = parseMarkdown('$$y = F(x) + x$$', { streaming: true });
    expect(blocks).toEqual([{ k: 'dm', tex: 'y = F(x) + x' }]);
  });

  it('shows a price that is still arriving', () => {
    expect(shown('it costs $5 and')).toBe('it costs $5 and');
  });

  it('holds back a tail only in the paragraph that is still arriving', () => {
    expect(shown('first costs $5 or\n\nsecond $x')).toBe('first costs $5 or\n\nsecond');
  });

  it('is not held back once the text is final', () => {
    expect(plainText(parseMarkdown('the residual $F(x) :='))).toBe('the residual $F(x) :=');
  });

  it('knows when a paragraph ends inside maths', () => {
    expect(endsInsideMath('so $$ y =')).toBe(true);
    expect(endsInsideMath('so $x$ and $$y$$')).toBe(false);
    expect(endsInsideMath('it costs $5 and')).toBe(false);
  });
});

describe('dehyphenate leaves maths alone', () => {
  it('joins a broken word outside maths but not "a- b" inside it', () => {
    expect(dehyphenate('sin-\ngle and $a- b$ here')).toBe('single and $a- b$ here');
    expect(dehyphenate('so $$x- y$$ and sin- gle')).toBe('so $$x- y$$ and single');
  });

  it('keeps an unclosed tail exactly as written, for the streaming parse after it', () => {
    expect(dehyphenate('so $$ y = F(')).toBe('so $$ y = F(');
  });
});

describe('plain text for maths', () => {
  it('writes TeX as readable words, never a $', () => {
    expect(texToPlain('F(x) := H(x) - x')).toBe('F(x) := H(x) - x');
    expect(texToPlain('\\frac{a}{b} \\le \\alpha')).toBe('(a/b) ≤ α');
    expect(texToPlain('\\sqrt{x} \\cdot \\text{rate}')).toBe('√x · rate');
    expect(texToPlain('x_{i}^{2}')).toBe('x_i^2');
  });

  it('turns a string with maths into plain words', () => {
    expect(mathToPlain('shift $F(x)$ by \\$5')).toBe('shift F(x) by $5');
    expect(splitMath('a $x$ b').map((s) => s.t)).toEqual(['text', 'math', 'text']);
  });

  it('reads maths into a preview without dollars', () => {
    const line = lineOf('the residual $F(x) := H(x) - x$ here');
    expect(inlinePlain(line)).toBe('the residual F(x) := H(x) - x here');
  });
});
