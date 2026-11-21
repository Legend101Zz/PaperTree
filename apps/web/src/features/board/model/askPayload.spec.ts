import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_LEVEL,
  QUICK_ASKS,
  buildAskBody,
  branchesFromSpan,
  defaultUses,
  isValidQuestion,
  levelStorageKey,
  quickAskUses,
  readBoardLevel,
  usesLine,
  whatTheAiWillRead,
  writeBoardLevel,
  type LevelStorage,
} from './askPayload';
import { askAnchorFixture } from './imageFixtures';
import { buildTree } from './tree';
import { node, resetClock, spanOf } from './treeFixtures';

const TEXT = 'An identity mapping adds no extra parameters, so the block can do nothing.';

beforeEach(resetClock);

function memory(): LevelStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('defaults', () => {
  it('starts with the path on, the paper’s page, Familiar and a diagram allowed', () => {
    expect(defaultUses()).toEqual({
      path: true,
      paper: 'page',
      level: 'familiar',
      diagram: 'may',
      extra_node_ids: [],
    });
  });

  it('starts at the level the board last used', () => {
    expect(defaultUses('expert').level).toBe('expert');
  });
});

describe('the board’s remembered level', () => {
  it('is Familiar until one is chosen', () => {
    expect(readBoardLevel(memory(), 'brd_1')).toBe(DEFAULT_LEVEL);
  });

  it('is kept per board', () => {
    const storage = memory();
    writeBoardLevel(storage, 'brd_1', 'new');
    writeBoardLevel(storage, 'brd_2', 'expert');
    expect(readBoardLevel(storage, 'brd_1')).toBe('new');
    expect(readBoardLevel(storage, 'brd_2')).toBe('expert');
    expect(storage.data.get(levelStorageKey('brd_1'))).toBe('new');
  });

  it('ignores a stored value that is not a level', () => {
    const storage = memory();
    storage.data.set(levelStorageKey('brd_1'), 'genius');
    expect(readBoardLevel(storage, 'brd_1')).toBe('familiar');
  });

  it('still works with no storage, or storage that throws', () => {
    const broken: LevelStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readBoardLevel(null, 'brd_1')).toBe('familiar');
    expect(readBoardLevel(broken, 'brd_1')).toBe('familiar');
    expect(() => writeBoardLevel(broken, 'brd_1', 'new')).not.toThrow();
    expect(() => writeBoardLevel(null, 'brd_1', 'new')).not.toThrow();
  });
});

describe('quick asks (rule 8)', () => {
  it('Simpler asks at New to this', () => {
    const uses = quickAskUses('simpler', defaultUses('expert'));
    expect(uses.level).toBe('new');
    expect(QUICK_ASKS.simpler.question).toBe('Explain this more simply.');
  });

  it('Example keeps the reader’s level and diagram', () => {
    const base = { ...defaultUses('expert'), diagram: 'never' as const };
    expect(quickAskUses('example', base)).toEqual(base);
    expect(QUICK_ASKS.example.question).toBe('Give me a concrete example of this.');
  });

  it('Diagram always draws one', () => {
    expect(quickAskUses('diagram', defaultUses()).diagram).toBe('always');
    expect(QUICK_ASKS.diagram.question).toBe('Draw a diagram of this.');
  });

  it('keeps the reader’s other choices', () => {
    const base = { ...defaultUses(), paper: 'whole' as const, extra_node_ids: ['x'] };
    expect(quickAskUses('simpler', base)).toMatchObject({ paper: 'whole', extra_node_ids: ['x'] });
  });
});

describe('buildAskBody', () => {
  const span = spanOf(TEXT, 'identity mapping');

  it('carries the typed question, the Uses and the level, and no check flag', () => {
    const body = buildAskBody({ question: '  why?  ', uses: defaultUses('new') });
    expect(body).toEqual({ question: 'why?', uses: defaultUses('new'), level: 'new' });
    expect(body).not.toHaveProperty('check');
  });

  it('carries the span for a span ask and the flag for Ask differently', () => {
    expect(buildAskBody({ question: 'q', span, uses: defaultUses() })?.span).toEqual(span);
    expect(
      buildAskBody({ question: 'q', askDifferently: true, uses: defaultUses() }),
    ).toMatchObject({
      ask_differently: true,
    });
  });

  it('sends a quick ask with its own question and adjusted Uses, whatever was typed', () => {
    const body = buildAskBody({
      question: 'ignored',
      quick: 'simpler',
      span,
      uses: defaultUses('expert'),
    });
    expect(body).toMatchObject({
      question: 'Explain this more simply.',
      quick: 'simpler',
      level: 'new',
      uses: { level: 'new' },
    });
  });

  it('refuses an empty or over-long question', () => {
    expect(buildAskBody({ question: '   ', uses: defaultUses() })).toBeNull();
    expect(isValidQuestion('x'.repeat(2000))).toBe(true);
    expect(isValidQuestion('x'.repeat(2001))).toBe(false);
  });
});

describe('what the AI will read', () => {
  // p -> a1 -> a2 -> a3 -> a4 (a chain of follow-ups), with a sibling branch off a1.
  const tree = buildTree([
    node({ id: 'p', body: 'x'.repeat(120) }),
    node({ id: 'a1', parent: 'p', branch: 'down', question: 'q1', finalText: '## TL;DR\nOne.' }),
    node({ id: 'a2', parent: 'a1', branch: 'down', question: 'q2', finalText: '## TL;DR\nTwo.' }),
    node({ id: 'a3', parent: 'a2', branch: 'down', question: 'q3', finalText: '## TL;DR\nThree.' }),
    node({ id: 'a4', parent: 'a3', branch: 'down', question: 'q4', finalText: '## TL;DR\nFour.' }),
    node({ id: 'side', parent: 'a1', question: 'a sibling idea', finalText: 'Side.' }),
  ]);

  it('lists the passage first, then the ancestors in order, then the selected words', () => {
    const span = spanOf(TEXT, 'identity mapping');
    const list = whatTheAiWillRead(tree, 'a4', defaultUses(), { span });
    expect(list.items.map((i) => [i.kind, i.id])).toEqual([
      ['passage', 'p'],
      ['answer', 'a1'],
      ['answer', 'a2'],
      ['answer', 'a3'],
      ['answer', 'a4'],
      ['words', null],
    ]);
    expect(list.items[5]?.title).toBe('the words “identity mapping”');
  });

  it('sends the parent and grandparent in full and older ancestors as their TL;DR line', () => {
    const notes = Object.fromEntries(
      whatTheAiWillRead(tree, 'a4', defaultUses()).items.map((i) => [i.id, i.note]),
    );
    expect(notes.a4).toContain('in full');
    expect(notes.a3).toBe('in full');
    expect(notes.a2).toBe('its TL;DR line');
    expect(notes.a1).toBe('its TL;DR line');
    expect(notes.p).toBe('120 characters');
  });

  it('says whether the parent is being followed up or branched from', () => {
    expect(whatTheAiWillRead(tree, 'a4', defaultUses()).items.at(-1)?.note).toContain(
      'following up',
    );
    expect(
      whatTheAiWillRead(tree, 'a4', defaultUses(), { askDifferently: true }).items.at(-1)?.note,
    ).toContain('branches from');
  });

  it('never reads a sibling branch, and names it so the reader can see that', () => {
    const list = whatTheAiWillRead(tree, 'a2', defaultUses());
    expect(list.items.some((i) => i.id === 'side')).toBe(false);
    // The sibling idea, and the later turn already hanging below the card being asked from.
    expect(list.notRead).toEqual(['a sibling idea', 'q3']);
  });

  it('adds the cards the reader picked', () => {
    const list = whatTheAiWillRead(tree, 'a2', { ...defaultUses(), extra_node_ids: ['side'] });
    expect(list.items.at(-1)).toMatchObject({ kind: 'extra', id: 'side', title: 'a sibling idea' });
    expect(list.notRead).toEqual(['q3']);
  });

  it('reads only the passage and the card asked from when the path is off', () => {
    const list = whatTheAiWillRead(tree, 'a4', { ...defaultUses(), path: false });
    expect(list.items.map((i) => i.id)).toEqual(['p', 'a4']);
    expect(list.pathLabel).toBe('this card only');
  });

  it('describes the paper in a sentence for each scope', () => {
    const sentence = (paper: 'page' | 'whole' | 'off') =>
      whatTheAiWillRead(tree, 'a1', { ...defaultUses(), paper }).paper;
    expect(sentence('page')).toMatch(/page.*before and after/);
    expect(sentence('whole')).toMatch(/whole paper/);
    expect(sentence('off')).toMatch(/Nothing from the paper/);
  });

  it('labels the path by size', () => {
    expect(whatTheAiWillRead(tree, 'p', defaultUses()).pathLabel).toBe('this passage');
    expect(whatTheAiWillRead(tree, 'a2', defaultUses()).pathLabel).toBe('this path (3 cards)');
  });

  it('calls a picked figure "this figure" and a drawn area "this area", not "this passage"', () => {
    const root = (kind: 'figure' | 'figure_region') =>
      buildTree([
        { ...node({ id: 'img' }), source_anchor: { ...askAnchorFixture(1), targetKind: kind } },
      ]);
    expect(whatTheAiWillRead(root('figure'), 'img', defaultUses()).pathLabel).toBe('this figure');
    expect(whatTheAiWillRead(root('figure_region'), 'img', defaultUses()).pathLabel).toBe(
      'this area',
    );
  });
});

describe('the feedforward line', () => {
  it('reads like the prototype’s', () => {
    expect(usesLine(defaultUses(), 'this path (3 cards)')).toBe(
      'this path (3 cards) · the paper · Familiar · may draw a diagram',
    );
    expect(
      usesLine({ ...defaultUses('new'), paper: 'off', diagram: 'never' }, 'this passage'),
    ).toBe('this passage · not the paper · New to this · no diagram');
  });
});

describe('branchesFromSpan', () => {
  it('counts the branches already on exactly these words', () => {
    const span = spanOf(TEXT, 'identity mapping');
    const tree = buildTree([
      node({ id: 'p' }),
      node({ id: 'a', parent: 'p', branch: 'down' }),
      node({ id: 'x', parent: 'a', span }),
      node({ id: 'y', parent: 'a', span: spanOf(TEXT, 'extra parameters') }),
    ]);
    expect(branchesFromSpan(tree, 'a', span)).toBe(1);
    expect(branchesFromSpan(tree, 'a', { start: 0, end: 1 })).toBe(0);
  });
});
