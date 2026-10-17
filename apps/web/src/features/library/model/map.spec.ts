/**
 * The Map model (#198): the plan is deterministic, islands never overlap and hold their papers, a
 * paper keeps its place when papers arrive in another topic (or a topic is added after it), and
 * only the API's links are drawn, worded from `matched_by`, with their tags inside the plan.
 */
import { describe, expect, it } from 'vitest';

import {
  layoutMap,
  linkLabel,
  mapGroups,
  mapLinks,
  mapPlanName,
  type MapGroup,
  type MapLayout,
  type MapLink,
} from './map';

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

  // Every island of `before` but those in `changed` is exactly where it was, at the same size.
  function unmoved(before: MapLayout, after: MapLayout, changed: readonly string[]): void {
    for (const was of before.islands) {
      if (changed.includes(was.group.key)) continue;
      const now = after.islands.find((i) => i.group.key === was.group.key);
      expect(now?.tokens, was.group.key).toEqual(was.tokens);
      expect([now?.cx, now?.cy, now?.r, now?.cart], was.group.key).toEqual([
        was.cx,
        was.cy,
        was.r,
        was.cart,
      ]);
    }
  }
  const grow = (key: string, n: number): MapGroup[] =>
    GROUPS.map((g) =>
      g.key === key
        ? {
            ...g,
            papers: [
              ...g.papers,
              ...Array.from({ length: n }, (_, i) => paper(`${key}-9${String(i)}`)),
            ],
          }
        : g,
    );

  it.each([
    ['a full island in the first row', 'g1', 1],
    ['a small island in a middle row (rows never pack by their tallest island)', 'g4', 3],
    ['the largest island (no island is sized against the largest)', 'g6', 5],
    ['the first island shrinking to one paper', 'g0', -6],
  ])('a paper keeps its place when papers arrive in or leave another topic: %s', (_, key, n) => {
    const changed =
      n > 0
        ? grow(key, n)
        : GROUPS.map((g) =>
            g.key === key ? { ...g, papers: g.papers.slice(0, g.papers.length + n) } : g,
          );
    for (const width of [1216, 900, 326])
      unmoved(layoutMap(GROUPS, width), layoutMap(changed, width), [key]);
  });

  it('a new topic (after the others, before Unshelved) moves only Unshelved', () => {
    const withTopic = [
      ...GROUPS.slice(0, -1),
      group('new', 2),
      GROUPS[GROUPS.length - 1] as MapGroup,
    ];
    unmoved(layoutMap(GROUPS, 1216), layoutMap(withTopic, 1216), ['g6']);
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

type Box = readonly [number, number, number, number];
const hits = (a: Box, b: Box): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Every tag drawn is inside the plan and covers no paper, no cartouche and no other tag. */
function expectTagsClear(plan: MapLayout, drawn: readonly MapLink[], total: number): void {
  expect(drawn).toHaveLength(total);
  const papers: Box[] = [...plan.at.values()].map(({ left, right }) => [
    left.x - 6,
    left.y - 14,
    right.x + 4,
    left.y + 14,
  ]);
  const carts: Box[] = plan.islands.map(({ cart }) => [
    cart.x,
    cart.y,
    cart.x + cart.w,
    cart.y + 44,
  ]);
  const tags: Box[] = drawn.flatMap((d) =>
    d.tag === null
      ? []
      : [[d.tag.x - d.tagWidth / 2, d.tag.y - 17, d.tag.x + d.tagWidth / 2, d.tag.y + 17] as const],
  );
  for (const [i, tag] of tags.entries()) {
    expect(tag[0]).toBeGreaterThanOrEqual(0);
    expect(tag[2]).toBeLessThanOrEqual(plan.width);
    expect(tag[1]).toBeGreaterThanOrEqual(0);
    expect(tag[3]).toBeLessThanOrEqual(plan.height);
    expect([...papers, ...carts].some((other) => hits(tag, other))).toBe(false);
    expect(tags.some((other, j) => j !== i && hits(tag, other))).toBe(false);
  }
}

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
    expectTagsClear(narrow, mapLinks(narrow, [link('a-02', 'a-00'), link('b-01', 'a-00')]), 2);
  });
});

describe('the 14-paper corpus: 12 topics (a 60-character name, five empty) and its 15 real links', () => {
  // The titles, topics and links of an account holding every corpus and fresh PDF (measured on the
  // S2g stack, 2026-10-17): the case the review found tags covering papers and each other in.
  const TOPICS: [string, string[]][] = [
    ['Transformers & attention', ['p01', 'p02', 'p03', 'p10', 'p12']],
    ['Vision & detection', ['p06', 'p11', 'p13']],
    ['Methods for modelling very long sequences in language and vi', ['p00']],
    ['Generative models', ['p04', 'p09']],
    ['Optimization & training', ['p08']],
    ['Document parsing', ['p05']],
    ['Reinforcement learning', []],
    ['Benchmarks', ['p07']],
    ['Retrieval', []],
    ['Graph networks', []],
    ['Speech', []],
    ['Theory', []],
  ];
  const TITLES: Record<string, string> = {
    p00: 'Abstract',
    p01: 'Attention Is All You Need',
    p02: 'BERT: Pre-training of Deep Bidirectional Transformers for',
    p03: 'Language Models are Few-Shot Learners',
    p04: 'Neural Ordinary Differential Equations',
    p05: 'PDF-to-Tree: Parsing PDF Text Blocks into a Tree',
    p06: 'Deep Residual Learning for Image Recognition',
    p07: 'SuperGLUE: A Stickier Benchmark for General-Purpose Language Understanding Systems',
    p08: 'ADAM: A METHOD FOR STOCHASTIC OPTIMIZATION',
    p09: 'Denoising Diffusion Probabilistic Models',
    p10: 'FlashAttention: Fast and Memory-Efficient Exact Attention',
    p11: 'Mask R-CNN',
    p12: 'Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks',
    p13: 'You Only Look Once: Unified, Real-Time Object Detection',
  };
  const LINKS = [
    'p12>p02:arxiv_id',
    'p12>p01:title',
    'p10>p03:title',
    'p10>p01:title',
    'p09>p01:title',
    'p09>p08:title',
    'p07>p02:arxiv_id',
    'p07>p08:arxiv_id',
    'p04>p06:title',
    'p04>p08:arxiv_id',
    'p03>p02:arxiv_id',
    'p03>p01:title',
    'p02>p01:title',
    'p01>p06:title',
    'p01>p08:title',
  ].map((spec): LibraryLink => {
    const [ends = '', how] = spec.split(':');
    const [from = '', to = ''] = ends.split('>');
    return {
      from_paper_id: from,
      to_paper_id: to,
      via: 'citation',
      matched_by: how === 'arxiv_id' ? 'arxiv_id' : 'title',
      reference: { index: 0, text: '' },
    };
  });
  const groups: MapGroup[] = TOPICS.map(([label, ids]) => ({
    key: label,
    label,
    kind: 'topic',
    meta: `${String(ids.length)} papers · arXiv cs.CL, cs.CV, cs.LG, stat.ML · no topic yet, and more words`,
    papers: ids.map((id) => paper(id, { title: TITLES[id] ?? id })),
  }));

  it.each([1216, 326])(
    'no link tag covers a paper, a cartouche or another tag (%i px)',
    (width) => {
      const plan = layoutMap(groups, width);
      const drawn = mapLinks(plan, LINKS);
      expectTagsClear(plan, drawn, 15);
      // Measured on this corpus: 12 of the 15 tags find a free place at 1216 px, 11 at 326 px; the
      // others are labelled in the list only (the legend counts them).
      expect(drawn.filter((d) => d.tag !== null)).toHaveLength(width > 900 ? 12 : 11);
    },
  );

  it.each([1216, 326])(
    'a cartouche stays in its cell and on the plan, a long name cut (%i px)',
    (width) => {
      const plan = layoutMap(groups, width);
      const cells = Math.min(3, Math.max(1, Math.floor((width - 48) / 380)));
      const cellW = (width - 48) / cells;
      for (const [i, island] of plan.islands.entries()) {
        const { x, w, name, meta } = island.cart;
        expect(x).toBeGreaterThanOrEqual(4);
        expect(x + w).toBeLessThanOrEqual(width - 4);
        expect(w).toBeLessThanOrEqual(cellW - 16);
        expect(name.length * 8.4 + 28).toBeLessThanOrEqual(w + 8.4);
        expect(meta.length * 6.4 + 28).toBeLessThanOrEqual(w + 6.4);
        for (const other of plan.islands.slice(i + 1)) {
          const apart =
            other.cart.x >= x + w ||
            other.cart.x + other.cart.w <= x ||
            other.cart.y >= island.cart.y + 44 ||
            other.cart.y + 44 <= island.cart.y;
          expect(apart).toBe(true);
        }
      }
      const long = plan.islands.find((island) => island.group.label.startsWith('Methods'));
      expect(long?.cart.name.endsWith('…')).toBe(true);
      expect(long?.group.label).toBe(
        'Methods for modelling very long sequences in language and vi',
      );
    },
  );

  it('names the plan without claiming a link count it does not have', () => {
    const plan = layoutMap(groups, 1216);
    expect(mapPlanName(plan, 15, 'ready')).toBe(
      'Plan of the reading room: 12 topics, 14 papers, 15 citation links. The plan as a list, after it, says the same in words.',
    );
    expect(mapPlanName(plan, 0, 'loading')).toContain('14 papers, citation links still loading.');
    expect(mapPlanName(plan, 0, 'error')).toContain('the citation links could not be read.');
  });
});
