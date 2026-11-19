import { describe, expect, it } from 'vitest';

import { parseAnswerItems, sectionOf, SECTION_LABEL } from './sections';

const FAMILIAR = [
  '## TL;DR',
  'A shortcut adds the input back.',
  '',
  '## In plain words',
  'Think of an editor, not an author [b1].',
  '',
  '## How it works',
  'The layers compute a correction.',
  '```diagram',
  '{"t":"part","label":"Input","kind":"input","after":[],"cite":null}',
  '```',
  '$$y = F(x) + x$$',
  'What each symbol means.',
  '',
  '## In the paper',
  'The paper notes no extra parameters [b3].',
].join('\n');

describe('sectionOf', () => {
  it('names the five sections, tolerant of case, emphasis and a colon', () => {
    expect(sectionOf('## TL;DR')).toBe('tldr');
    expect(sectionOf('## In plain words')).toBe('plain');
    expect(sectionOf('## The trade-off')).toBe('tradeoff');
    expect(sectionOf('### **How it works**:')).toBe('how');
    expect(sectionOf('## In The Paper')).toBe('paper');
  });

  it('leaves any other heading, and any other line, alone', () => {
    expect(sectionOf('## Overview')).toBeNull();
    expect(sectionOf('In plain words')).toBeNull();
  });
});

describe('parseAnswerItems', () => {
  it('reads the familiar shape: labels, paragraphs in their sections, the figure', () => {
    const items = parseAnswerItems(FAMILIAR);
    expect(items.map((i) => (i.k === 'label' ? `# ${i.section}` : i.k))).toEqual([
      '# tldr',
      'p',
      '# plain',
      'p',
      '# how',
      'p',
      'diagram',
      'p',
      '# paper',
      'p',
    ]);
    const lead = items[1];
    expect(lead).toMatchObject({
      k: 'p',
      section: 'tldr',
      text: 'A shortcut adds the input back.',
    });
    expect(items.find((i) => i.k === 'diagram')).toMatchObject({ closed: true });
    // The sentence before the figure, and the $$ line with its symbol sentence after it.
    expect(items.filter((i) => i.k === 'p' && i.section === 'how')).toHaveLength(2);
  });

  it("reads expert's 'The trade-off' as the second section", () => {
    const items = parseAnswerItems('## TL;DR\nShort.\n\n## The trade-off\nBuys x, costs y.');
    expect(items.filter((i) => i.k === 'label').map((i) => i.k === 'label' && i.section)).toEqual([
      'tldr',
      'tradeoff',
    ]);
    expect(SECTION_LABEL.tradeoff).toBe('the trade-off');
    expect(items.at(-1)).toMatchObject({ k: 'p', section: 'tradeoff' });
  });

  it('an older answer with no known heading is plain paragraphs with no section', () => {
    const items = parseAnswerItems('# Title\n\nOne [b1].\n  \nTwo\nstill two.\n\n## Next\n\n');
    expect(items).toEqual([
      { k: 'p', text: 'One [b1].', section: null },
      { k: 'p', text: 'Two\nstill two.', section: null },
    ]);
  });

  it('a missing section is simply absent: no empty label, no gap', () => {
    const items = parseAnswerItems('## TL;DR\nShort.\n\n## In the paper\nThe paper says so.');
    expect(items.map((i) => i.k)).toEqual(['label', 'p', 'label', 'p']);
  });

  it('holds back a half-typed heading while streaming, and shows it as a label once whole', () => {
    expect(parseAnswerItems('## TL;DR\nShort.\n\n## In pl', true).map((i) => i.k)).toEqual([
      'label',
      'p',
    ]);
    expect(parseAnswerItems('## TL;DR\nShort.\n\n##', true).map((i) => i.k)).toEqual([
      'label',
      'p',
    ]);
    // Glued to the paragraph above with no blank line: still held back, not shown as a bold line.
    expect(parseAnswerItems('## TL;DR\nShort.\n## How it', true).map((i) => i.k)).toEqual([
      'label',
      'p',
    ]);
    expect(parseAnswerItems('## TL;DR\nShort.\n\n## In plain words', true).map((i) => i.k)).toEqual(
      ['label', 'p', 'label'],
    );
  });

  it('a heading that is not a prefix of a section name is not held back', () => {
    expect(parseAnswerItems('Some text\n## Overview', true)).toEqual([
      { k: 'p', text: 'Some text\n## Overview', section: null },
    ]);
  });

  it('a half-typed fence marker never flashes', () => {
    expect(parseAnswerItems('Some text.\n`', true)).toEqual([
      { k: 'p', text: 'Some text.', section: null },
    ]);
    expect(parseAnswerItems('Some text.\n``', true)).toEqual([
      { k: 'p', text: 'Some text.', section: null },
    ]);
  });

  it('an open diagram fence is an unclosed item while streaming, closed once its fence arrives', () => {
    const open = parseAnswerItems('## How it works\nSee:\n```diagram\n{"t":"par', true);
    expect(open.at(-1)).toEqual({ k: 'diagram', body: '{"t":"par', closed: false });
    const partial = parseAnswerItems('See:\n```diag', true);
    expect(partial.at(-1)).toMatchObject({ k: 'diagram', closed: false });
    const closed = parseAnswerItems('See:\n```diagram\n{"t":"end"}\n```\nAfter.', true);
    expect(closed.map((i) => i.k)).toEqual(['p', 'diagram', 'p']);
    expect(closed[1]).toMatchObject({ closed: true });
  });

  it('a check fence is an item only when whole', () => {
    const body = 'prompt: If $x$ is ___.\naccept: x';
    expect(parseAnswerItems(`Text.\n\`\`\`check\n${body}`, true).map((i) => i.k)).toEqual(['p']);
    expect(parseAnswerItems(`Text.\n\`\`\`check\n${body}\n\`\`\``).at(-1)).toEqual({
      k: 'check',
      body,
    });
  });

  it('an unknown fence keeps its lines as text', () => {
    expect(parseAnswerItems('Before.\n```latex\nx^2\n```\nAfter.')).toEqual([
      { k: 'p', text: 'Before.\nx^2\nAfter.', section: null },
    ]);
  });

  it('a heading inside a fence is not a section', () => {
    const items = parseAnswerItems('```diagram\n## TL;DR\n```');
    expect(items.map((i) => i.k)).toEqual(['diagram']);
  });
});
