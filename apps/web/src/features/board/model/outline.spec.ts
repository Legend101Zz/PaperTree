import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_INCLUDE, buildOutline, exportMarkdown } from './outline';
import { buildTree } from './tree';
import { node, resetClock, spanOf } from './treeFixtures';

const ANSWER_A = [
  '## TL;DR',
  'A block adds its input back, so doing nothing is easy.',
  '',
  '## How it works',
  'The mapping is $y = F(x) + x$ with an identity mapping on the shortcut.',
  '```diagram',
  '{"part":"x"}',
  '```',
  '',
  '```check',
  'prompt: ___',
  '```',
].join('\n');

function board() {
  const rows = [
    node({ id: 'p', body: 'We let the layers fit a residual.\nNot the whole map.' }),
    node({ id: 'pn', parent: 'p', kind: 'note', body: 'my note on the passage' }),
    node({
      id: 'a',
      parent: 'p',
      branch: 'down',
      question: 'Why does adding x help?',
      finalText: ANSWER_A,
    }),
    node({
      id: 'b',
      parent: 'a',
      question: 'what is an identity mapping?',
      span: spanOf(ANSWER_A, 'identity mapping'),
      finalText: '## TL;DR\nA map that returns its input.',
    }),
    node({
      id: 'c',
      parent: 'b',
      branch: 'down',
      question: 'so a block can do nothing?',
      finalText: '## TL;DR\nYes: set $F(x)=0$.',
    }),
    node({
      id: 'an',
      parent: 'a',
      kind: 'note',
      body: 'kept words',
      span: spanOf(ANSWER_A, 'adds'),
    }),
    node({
      id: 'd',
      parent: 'a',
      branch: 'down',
      question: 'and why does it train?',
      finalText: '## TL;DR\nGradients flow through the shortcut.',
    }),
  ];
  return buildTree(rows);
}

const rowIds = (tree = board()) => buildOutline(tree).rows.map((r) => r.id);

beforeEach(resetClock);

describe('buildOutline', () => {
  it('walks passage, its notes, then each answer: notes, right branches one step in, follow-up level', () => {
    expect(rowIds()).toEqual(['p', 'pn', 'a', 'an', 'b', 'c', 'd']);
  });

  it('indents a branch one step and leaves a follow-up level', () => {
    const depth = Object.fromEntries(buildOutline(board()).rows.map((r) => [r.id, r.depth]));
    expect(depth).toMatchObject({ a: 0, b: 1, c: 1, d: 0 });
  });

  it('marks a follow-up as down and a branch as not down', () => {
    const rows = buildOutline(board()).rows;
    const find = (id: string) => rows.find((r) => r.id === id);
    expect(find('c')).toMatchObject({ kind: 'question', down: true, from: null });
    expect(find('b')).toMatchObject({ kind: 'question', down: false, from: 'identity mapping' });
  });

  it('does not mark the first answer to a passage as a follow-up', () => {
    expect(buildOutline(board()).rows.find((r) => r.id === 'a')).toMatchObject({ down: false });
  });

  it('shows the answer’s first line, and keeps the whole answer for opening', () => {
    const row = buildOutline(board()).rows.find((r) => r.id === 'a');
    expect(row).toMatchObject({
      kind: 'question',
      firstLine: 'A block adds its input back, so doing nothing is easy.',
    });
    expect(row?.kind === 'question' ? row.text : '').toBe(ANSWER_A);
  });

  it('lists the questions as contents, with depth', () => {
    const nav = buildOutline(board()).nav;
    expect(nav.map((n) => [n.id, n.title, n.depth])).toEqual([
      ['a', 'Why does adding x help?', 0],
      ['b', 'what is an identity mapping?', 1],
      ['c', 'so a block can do nothing?', 1],
      ['d', 'and why does it train?', 0],
    ]);
  });

  it('stops at a folded answer and says what it holds', () => {
    const rows = board();
    const folded = buildTree(
      [...rows.byId.values()].map((n) => (n.node_id === 'b' ? { ...n, folded: true } : n)),
    );
    const out = buildOutline(folded);
    expect(out.rows.map((r) => r.id)).toEqual(['p', 'pn', 'a', 'an', 'b', 'd']);
    const row = out.rows.find((r) => r.id === 'b');
    expect(row?.kind === 'question' ? row.folded?.label : '').toBe('2 answers');
  });

  it('says an empty board is empty', () => {
    expect(buildOutline(buildTree([])).empty).toBe(true);
    expect(buildOutline(board()).empty).toBe(false);
  });

  it('falls back to the title, then the first line, when a card has no question', () => {
    const tree = buildTree([
      node({ id: 'p' }),
      {
        ...node({ id: 'x', parent: 'p', branch: 'down', finalText: '## TL;DR\nGist.' }),
        title: 'Titled',
      },
      node({ id: 'y', parent: 'x', branch: 'down', finalText: '## TL;DR\nGist two.' }),
    ]);
    expect(buildOutline(tree).nav.map((n) => n.title)).toEqual(['Titled', 'Gist two.']);
  });
});

describe('exportMarkdown', () => {
  const opts = {
    title: 'How do residual nets train?',
    sourceOf: () => 'Deep Residual Learning, p. 3',
  };

  it('starts with the title and quotes the passage with its source', () => {
    const md = exportMarkdown(board(), opts).split('\n');
    expect(md[0]).toBe('# How do residual nets train?');
    expect(md).toContain('> We let the layers fit a residual.');
    expect(md).toContain('> Not the whole map.');
    expect(md).toContain('> (Deep Residual Learning, p. 3)');
  });

  it('writes a heading per question: branches with their words, follow-ups marked, nested by depth', () => {
    const headings = exportMarkdown(board(), opts)
      .split('\n')
      .filter((l) => /^#{2,6} /.test(l));
    expect(headings).toEqual([
      '## Why does adding x help?',
      '### \u201cidentity mapping\u201d \u2192 what is an identity mapping?',
      '#### \u2193 so a block can do nothing?',
      '### \u2193 and why does it train?',
    ]);
  });

  it('keeps maths as dollars, bolds the lead, never includes the check block or handles', () => {
    const md = exportMarkdown(board(), opts);
    expect(md).toContain('$y = F(x) + x$');
    expect(md).toContain('**A block adds its input back, so doing nothing is easy.**');
    expect(md).toContain('*[diagram: see the card]*');
    expect(md).not.toContain('prompt:');
    expect(md).not.toMatch(/\[b\d/);
  });

  it('includes notes by default and leaves them out when the toggle is off', () => {
    expect(exportMarkdown(board(), opts)).toContain('> **Note.** my note on the passage');
    const without = exportMarkdown(board(), {
      ...opts,
      include: { ...DEFAULT_INCLUDE, notes: false },
    });
    expect(without).not.toContain('**Note.**');
  });

  it('writes only the first paragraph and […] when full answers are off', () => {
    const md = exportMarkdown(board(), { ...opts, include: { ...DEFAULT_INCLUDE, full: false } });
    expect(md).toContain('**A block adds its input back, so doing nothing is easy.** […]');
    expect(md).not.toContain('$y = F(x) + x$');
  });

  it('replaces a folded branch with its counts unless folded branches are included', () => {
    const rows = [...board().byId.values()].map((n) =>
      n.node_id === 'b' ? { ...n, folded: true } : n,
    );
    const folded = buildTree(rows);
    const shut = exportMarkdown(folded, opts);
    expect(shut).toContain('*2 answers, folded on the board.*');
    expect(shut).not.toContain('so a block can do nothing?');
    const open = exportMarkdown(folded, { ...opts, include: { ...DEFAULT_INCLUDE, folded: true } });
    expect(open).toContain('so a block can do nothing?');
    expect(open).not.toContain('folded on the board');
  });

  it('says so for an empty board', () => {
    expect(exportMarkdown(buildTree([]), opts)).toBe(
      '# How do residual nets train?\n\n*Nothing on the board yet.*',
    );
  });

  it('ends without a trailing blank line', () => {
    expect(exportMarkdown(board(), opts).endsWith('\n')).toBe(false);
  });
});
