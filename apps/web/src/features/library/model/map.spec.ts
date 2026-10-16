/**
 * The Map model (#198): the plan is deterministic, islands never overlap and hold their papers, a
 * paper keeps its place when papers arrive in another topic (or a topic is added after it), and
 * only the API's links are drawn, worded from `matched_by`, with their tags inside the plan.
 */
import { describe, expect, it } from 'vitest';

import { layoutMap, linkLabel, mapGroups, mapLinks, type MapGroup } from './map';

import type { ShelfPaper } from './shelf';
import type { Topic } from '@/lib/api/topics';
import type { LibraryLink } from '@/lib/api/types';

const TITLES = [
  'Attention Is All You Need',
  'BERT: Pre-training of Deep Bidirectional Transformers',
  'Neural Machine Translation by Jointly Learning to Align and Translate',
  'GPT-3',
  'ViT',
  'Deep Residual Learning for Image Recognition',
  'You Only Look Once: Unified, Real-Time Object Detection',
];

function paper(id: string, overrides: Partial<ShelfPaper> = {}): ShelfPaper {
  const title = TITLES[Number(id.replace(/\D/g, '')) % TITLES.length] ?? id;
  return {
    id,
    title,
    authors: [],
    pageCount: 12,
    processing: 'complete',
    addedAt: `2026-10-01T00:00:${id.slice(-2).padStart(2, '0')}Z`,
    ...overrides,
  };
}

function group(key: string, count: number, kind: MapGroup['kind'] = 'topic'): MapGroup {
  return {
    key,
    label: key,
    kind,
    meta: `${String(count)} papers`,
    papers: Array.from({ length: count }, (_, i) => paper(`${key}-${String(i).padStart(2, '0')}`)),
  };
}

const SIZES = [7, 6, 4, 0, 3, 1, 25];
const GROUPS = SIZES.map((n, i) =>
  group(`g${String(i)}`, n, i === SIZES.length - 1 ? 'unshelved' : 'topic'),
);

describe('layoutMap', () => {
  it('is deterministic: the same groups and width give the same plan', () => {
    expect(layoutMap(GROUPS, 1216)).toEqual(
      layoutMap(
        GROUPS.map((g) => ({ ...g })),
        1216,
      ),
    );
  });

  it.each([1216, 900, 326])(
    'never lets two islands overlap, and keeps every paper in its circle (%i px)',
    (width) => {
      const plan = layoutMap(GROUPS, width);
      for (const [i, a] of plan.islands.entries()) {
        expect(a.cx - a.r).toBeGreaterThanOrEqual(0);
        expect(a.cx + a.r).toBeLessThanOrEqual(width);
        for (const b of plan.islands.slice(i + 1)) {
          expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThanOrEqual(a.r + b.r);
        }
        // Nor does any cartouche stand on another island.
        for (const b of plan.islands) {
          if (b === a) continue;
          const { x, y, w } = b.cart;
          const gap = Math.hypot(
            Math.max(x - a.cx, 0, a.cx - (x + w)),
            Math.max(y - a.cy, 0, a.cy - (y + 44)),
          );
          expect(gap).toBeGreaterThanOrEqual(a.r);
        }
        for (const token of a.tokens) {
          const { left, right } = plan.at.get(token.id) ?? {
            left: { x: 0, y: 0 },
            right: { x: 0, y: 0 },
          };
          for (const point of [left, right])
            expect(Math.hypot(point.x - a.cx, point.y - a.cy)).toBeLessThanOrEqual(a.r);
        }
      }
      expect(plan.height).toBeGreaterThan(Math.max(...plan.islands.map((i) => i.cy + i.r)));
    },
  );

  it('shows what fits and says how many more, and every paper still has a link point', () => {
    const plan = layoutMap(GROUPS, 1216);
    const big = plan.islands.find((i) => i.group.key === 'g6');
    expect(big?.hidden).toBeGreaterThan(0);
    expect((big?.tokens.length ?? 0) + (big?.hidden ?? 0)).toBe(25);
    expect(big?.more).not.toBeNull();
    for (const g of GROUPS) for (const p of g.papers) expect(plan.at.has(p.id)).toBe(true);
  });

  it('a paper keeps its place when another paper arrives in a different topic, or a topic is added', () => {
    const before = layoutMap(GROUPS, 1216);
    const grown = GROUPS.map((g) =>
      g.key === 'g1' ? { ...g, papers: [...g.papers, paper('g1-99')] } : g,
    );
    const withTopic = [
      ...GROUPS.slice(0, -1),
      group('new', 2),
      GROUPS[GROUPS.length - 1] as MapGroup,
    ];
    for (const after of [layoutMap(grown, 1216), layoutMap(withTopic, 1216)]) {
      for (const key of ['g0', 'g2', 'g3', 'g4', 'g5']) {
        const was = before.islands.find((i) => i.group.key === key);
        const now = after.islands.find((i) => i.group.key === key);
        expect(now?.tokens).toEqual(was?.tokens);
        expect([now?.cx, now?.cy, now?.r]).toEqual([was?.cx, was?.cy, was?.r]);
      }
    }
  });

  it('cuts long titles to the room and says a paper is being read or could not be read', () => {
    const papers = [
      paper('a02', { processing: 'parsing' }),
      paper('a01', { processing: 'failed' }),
    ];
    const plan = layoutMap([{ key: 't', label: 't', kind: 'topic', meta: '', papers }], 1216);
    const [first, second] = plan.islands[0]?.tokens ?? [];
    expect(first?.label).toMatch(/^Neural Machine .*…$/);
    expect(first?.label.length).toBeLessThanOrEqual(26);
    expect(first?.note).toBe('being read');
    expect(second?.note).toBe('could not read');
  });
});

describe('mapGroups', () => {
  const topic = (id: string, name: string): Topic => ({
    topic_id: id,
    name,
    cloth: null,
    sort_order: 0,
    paper_count: 0,
    page_count: 0,
    categories: [],
  });
  const on = (id: string, name: string) => ({ id, name, cloth: null });

  it('keeps the topics’ order (an empty one too), then Unshelved, with their cartouche lines', () => {
    const papers = [
      paper('p01', { topic: on('t2', 'Vision'), arxivCategory: 'cs.CV', pageCount: 12 }),
      paper('p02', { arxivCategory: 'cs.LG', pageCount: 25 }),
      paper('p00', { topic: on('t2', 'Vision'), arxivCategory: 'cs.CV', pageCount: 10 }),
    ];
    const groups = mapGroups([topic('t1', 'Empty'), topic('t2', 'Vision')], papers);
    expect(groups.map((g) => [g.label, g.kind, g.meta, g.papers.map((p) => p.id)])).toEqual([
      ['Empty', 'topic', 'No papers yet', []],
      ['Vision', 'topic', '2 papers · 22 pages · arXiv cs.CV', ['p00', 'p01']],
      ['Unshelved', 'unshelved', '1 paper · 25 pages · arXiv cs.LG · no topic yet', ['p02']],
    ]);
    expect(mapGroups([topic('t1', 'Empty')], []).map((g) => g.label)).toEqual(['Empty']);
  });

  it('never drops a paper whose topic the topics list lacks (a failed or late read)', () => {
    const lost = paper('p05', { topic: on('t9', 'Lost') });
    const groups = mapGroups([topic('t1', 'Empty')], [lost]);
    expect(groups.map((g) => [g.key, g.papers.map((p) => p.id)])).toEqual([
      ['t1', []],
      ['t9', ['p05']],
    ]);
  });
});

describe('mapLinks: only real links', () => {
  const plan = layoutMap([group('a', 3), group('b', 2), group('c', 1, 'unshelved')], 1216);
  const link = (
    from: string,
    to: string,
    matched_by: LibraryLink['matched_by'] = 'title',
  ): LibraryLink => ({
    from_paper_id: from,
    to_paper_id: to,
    via: 'citation',
    matched_by,
    reference: { index: 0, text: 'Attention is all you need.' },
  });

  it('draws exactly the API’s links, worded from matched_by, and invents none', () => {
    const links = [link('a-01', 'a-00'), link('c-00', 'a-00'), link('a-00', 'b-00', 'arxiv_id')];
    const drawn = mapLinks(plan, links);
    expect(drawn.map((d) => d.link)).toEqual(links);
    expect(drawn.map((d) => d.label)).toEqual([
      'cites it · matched by title',
      'cites it · matched by title',
      'cites it · matched by arXiv id',
    ]);
    expect(mapLinks(plan, [])).toEqual([]);
    expect(linkLabel({ matched_by: 'arxiv_id' })).toBe('cites it · matched by arXiv id');
  });

  it('drops a link whose paper is not on the plan, and a paper never links to itself', () => {
    expect(mapLinks(plan, [link('a-00', 'gone'), link('a-00', 'a-00')])).toEqual([]);
  });

  it('runs from the citing paper to the cited one, and keeps every tag inside the plan, off the papers', () => {
    const [across] = mapLinks(plan, [link('a-00', 'b-00')]);
    const from = plan.at.get('a-00');
    const to = plan.at.get('b-00');
    expect(across?.d.startsWith(`M${(from?.right.x ?? 0).toFixed(1)} `)).toBe(true);
    expect(
      across?.d.endsWith(`${(to?.left.x ?? 0).toFixed(1)} ${(to?.left.y ?? 0).toFixed(1)}`),
    ).toBe(true);
    const narrow = layoutMap([group('a', 3), group('b', 2)], 326);
    for (const drawn of mapLinks(narrow, [link('a-02', 'a-00'), link('b-01', 'a-00')])) {
      expect(drawn.tag.x - drawn.tagWidth / 2).toBeGreaterThanOrEqual(0);
      expect(drawn.tag.x + drawn.tagWidth / 2).toBeLessThanOrEqual(326);
      for (const { left, right } of narrow.at.values()) {
        const clear =
          drawn.tag.x + drawn.tagWidth / 2 <= left.x - 6 ||
          drawn.tag.x - drawn.tagWidth / 2 >= right.x + 4 ||
          Math.abs(drawn.tag.y - left.y) >= 31;
        expect(clear).toBe(true);
      }
    }
  });
});
