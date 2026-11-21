import { beforeEach, describe, expect, it } from 'vitest';

import { askAnchorFixture } from './imageFixtures';
import { buildTree } from './tree';
import { node, resetClock } from './treeFixtures';
import { CALM, breadcrumbOf, escapeStep, onPathIds, type BoardUi } from './ui';

import type { AskUses } from '@/lib/api/types';

const USES: AskUses = {
  path: true,
  paper: 'page',
  level: 'familiar',
  diagram: 'may',
  extra_node_ids: [],
};
const DRAFT = {
  parentId: 'a',
  span: null,
  askDifferently: false,
  expanded: true,
  text: '',
  uses: USES,
};
const MENU = {
  cardId: 'a',
  span: { start: 0, end: 3, quote: 'abc' },
  anchor: { x: 0, y: 0, w: 1, h: 1 },
};

beforeEach(resetClock);

describe('Escape backs out one level per press (P4 notes)', () => {
  it('closes, in this order: export sheet, picker, span menu, ask box, path focus, Outline', () => {
    let ui: BoardUi = {
      focusId: 'a',
      draft: DRAFT,
      picker: 'paper',
      menu: MENU,
      outline: true,
      sheet: true,
    };
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const step = escapeStep(ui);
      expect(step.used).toBe(true);
      ui = step.ui;
      seen.push(
        [
          ui.sheet && 'sheet',
          ui.picker && 'picker',
          ui.menu && 'menu',
          ui.draft && 'draft',
          ui.focusId && 'focus',
          ui.outline && 'outline',
        ]
          .filter(Boolean)
          .join(','),
      );
    }
    expect(seen).toEqual([
      'picker,menu,draft,focus,outline',
      'menu,draft,focus,outline',
      'draft,focus,outline',
      'focus,outline',
      'outline',
      '',
    ]);
    expect(ui).toEqual(CALM);
  });

  it('is not used when nothing is open, so the page may have the key', () => {
    expect(escapeStep(CALM)).toEqual({ ui: CALM, used: false });
  });
});

describe('path focus', () => {
  const tree = buildTree([
    node({ id: 'p', body: 'The passage words.' }),
    node({ id: 'a', parent: 'p', branch: 'right', question: 'Why does adding x help training?' }),
    node({ id: 'b', parent: 'a', branch: 'down', question: 'so a block can just do nothing?' }),
    node({ id: 'side', parent: 'a', branch: 'right', question: 'how can it be free?' }),
  ]);

  it('lights the focused card and everything above it; the rest dims', () => {
    const lit = onPathIds(tree, 'b')!;
    expect([...lit].sort()).toEqual(['a', 'b', 'p']);
    expect(lit.has('side')).toBe(false);
    expect(onPathIds(tree, null)).toBeNull();
    expect(onPathIds(tree, 'gone')).toBeNull();
  });

  it('writes the breadcrumb from the passage down, one crumb per card', () => {
    expect(breadcrumbOf(tree, 'b').map((c) => c.label)).toEqual([
      'Passage',
      'Why does adding x help training?',
      'so a block can just do nothing?',
    ]);
    expect(breadcrumbOf(tree, 'b').map((c) => c.id)).toEqual(['p', 'a', 'b']);
  });

  it('names a picture’s root for the picture: "Figure 2", "Figure", "Selected area"', () => {
    const figure = (body: string, kind: 'figure' | 'figure_region') => ({
      ...node({ id: 'img', body }),
      source_anchor: { ...askAnchorFixture(1), targetKind: kind },
    });
    const first = (row: ReturnType<typeof figure>) =>
      breadcrumbOf(buildTree([row]), 'img')[0]?.label;
    expect(first(figure('Figure 2', 'figure'))).toBe('Figure 2');
    expect(first(figure('', 'figure'))).toBe('Figure');
    expect(first(figure('', 'figure_region'))).toBe('Selected area');
  });
});
