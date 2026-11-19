import { beforeEach, describe, expect, it } from 'vitest';

import { DRAFT_ID, DRAG_HANDLE, displayNodes, draftNode } from './display';
import { toFlowNode } from './flow';
import { layoutBoard } from './layout';
import { buildTree } from './tree';
import { node, resetClock } from './treeFixtures';

import type { AskUses } from '@/lib/api/types';

const USES: AskUses = {
  path: true,
  paper: 'page',
  level: 'familiar',
  diagram: 'may',
  extra_node_ids: [],
};

beforeEach(resetClock);

describe('displayNodes: the cards as xyflow draws them', () => {
  const rows = [
    node({ id: 'p', x: 40, y: 60 }),
    node({ id: 'a', parent: 'p', branch: 'right' }),
    node({ id: 'b', parent: 'a', branch: 'down', folded: false }),
    node({ id: 'loose', kind: 'note', x: 900, y: 900 }),
  ];
  const tree = buildTree(rows);
  const layout = layoutBoard(tree, { viewportHeight: 800, measure: () => 100 });
  const flow = rows.map((r) => toFlowNode(r, 'ppr_1'));
  const base = { paperId: 'ppr_1', onPath: null, draft: null, arrivedId: null } as const;

  it('puts a tree card where the layout says, with a handle on its top strip only', () => {
    const out = displayNodes(flow, layout, base);
    const a = out.find((n) => n.id === 'a')!;
    expect(a.position).toEqual({ x: layout.cards.get('a')!.x, y: layout.cards.get('a')!.y });
    expect(a.dragHandle).toBe(DRAG_HANDLE);
    // The stored position of a tree card is not what is drawn.
    expect(a.position).not.toEqual({ x: rows[1]!.x, y: rows[1]!.y });
  });

  it('leaves a loose card where it is stored', () => {
    const out = displayNodes(flow, layout, base);
    expect(out.find((n) => n.id === 'loose')!.position).toEqual({ x: 900, y: 900 });
  });

  it('dims the cards off the focused path', () => {
    const out = displayNodes(flow, layout, { ...base, onPath: new Set(['p', 'a']) });
    expect(out.find((n) => n.id === 'a')!.className ?? '').not.toContain('pt-tn--dim');
    expect(out.find((n) => n.id === 'b')!.className).toContain('pt-tn--dim');
  });

  it('marks the card that just arrived, to glow once', () => {
    const out = displayNodes(flow, layout, { ...base, arrivedId: 'p' });
    expect(out.find((n) => n.id === 'p')!.className).toContain('pt-tn--arrived');
  });

  it('adds the ask box as a node of its own, placed by the same layout', () => {
    const draft = draftNode(
      'brd_1',
      { parentId: 'b', span: null, askDifferently: false, expanded: true, text: '', uses: USES },
      'down',
    );
    const withDraft = layoutBoard(buildTree([...rows, draft]), {
      viewportHeight: 800,
      measure: () => 100,
    });
    const out = displayNodes(flow, withDraft, { ...base, draft });
    const box = out.find((n) => n.id === DRAFT_ID)!;
    expect(box.type).toBe('draft');
    expect(box.draggable).toBe(false);
    expect(box.position.y).toBeGreaterThan(withDraft.cards.get('b')!.y);
  });
});
