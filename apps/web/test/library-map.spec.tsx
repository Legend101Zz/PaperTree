/**
 * The Map view (#198, frame 01e) through the whole page: topic islands and Unshelved, ONLY the
 * links `GET /library/links` returned (drawn and listed, each "matched by title"), "none yet" when
 * there are none, the plan named as a picture with its list alternative reached by Tab, a search
 * dimming the papers it does not match, and axe at WCAG 2.2 AA. jsdom measures nothing, so the
 * plan's host reports the 1440 px frame's width (1216).
 */
import axe from 'axe-core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Topic } from '@/lib/api/topics';
import type { LibraryLink, LibraryPaper } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';

import { renderLibrary, row } from './library-table-cases';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

const papersApi = vi.hoisted(() => ({
  list: vi.fn(),
  links: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
const topicsApi = vi.hoisted(() => ({ list: vi.fn(), ofPaper: vi.fn() }));
vi.mock('@/lib/api/papers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/papers')>()),
  papersApi,
}));
vi.mock('@/lib/api/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/topics')>()),
  topicsApi,
}));

const topic = (id: string, name: string, cloth: Topic['cloth']): Topic => ({
  topic_id: id,
  name,
  cloth,
  sort_order: 0,
  paper_count: 2,
  page_count: 0,
  categories: [],
});
const T = topic('top_t', 'Transformers & attention', 'transformers');
const V = topic('top_v', 'Vision & detection', 'vision');
const on = (t: Topic) => ({
  topic_id: t.topic_id,
  name: t.name,
  cloth: t.cloth,
  source: 'manual' as const,
  source_detail: null,
});

const PAPERS: LibraryPaper[] = [
  row('ppr_att', 'Attention Is All You Need', { arxiv_category: 'cs.CL', topic: on(T) }),
  row('ppr_bert', 'BERT: Pre-training of Deep Bidirectional Transformers', {
    arxiv_category: 'cs.CL',
    topic: on(T),
  }),
  row('ppr_ddpm', 'Denoising Diffusion Probabilistic Models', { arxiv_category: 'cs.LG' }),
  row('ppr_resnet', 'Deep Residual Learning for Image Recognition', { topic: on(V) }),
  row('ppr_yolo', 'You Only Look Once: Unified, Real-Time Object Detection', { topic: on(V) }),
];
const cites = (from: string, to: string): LibraryLink => ({
  from_paper_id: from,
  to_paper_id: to,
  via: 'citation',
  matched_by: 'title',
  reference: { index: 3, text: 'Attention is all you need. In NIPS, 2017.' },
});
const LINKS = [
  cites('ppr_ddpm', 'ppr_att'),
  cites('ppr_bert', 'ppr_att'),
  cites('ppr_att', 'ppr_resnet'),
];

beforeEach(() => {
  for (const fn of [...Object.values(papersApi), ...Object.values(topicsApi)]) fn.mockReset();
  papersApi.list.mockResolvedValue(PAPERS);
  papersApi.links.mockResolvedValue({ links: LINKS });
  topicsApi.list.mockResolvedValue([T, V]);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1216);
  window.localStorage.clear();
  window.localStorage.setItem('papertree/library/shelf-hints', 'shown');
  useAuthStore.setState({
    user: { id: 'u', email: 'm@example.test' },
    isAuthenticated: true,
    isLoading: false,
    sessionUnverified: false,
    signedOutByUser: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openMap(): Promise<HTMLElement> {
  await renderLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'Map' }));
  const plan = await screen.findByRole('img', { name: /^Plan of the reading room/ });
  await waitFor(() => expect(plan.querySelectorAll('.pt-map__link')).toHaveLength(LINKS.length));
  return plan;
}

function openList(): HTMLElement {
  const summary = screen.getByText('The plan as a list');
  fireEvent.click(summary);
  return summary.closest('details') as HTMLElement;
}

describe('the Map view (#198)', () => {
  it('draws the topic islands, then Unshelved, with each paper inside its own', async () => {
    const plan = await openMap();
    const islands = [...plan.querySelectorAll<SVGGElement>('[data-group]')];
    expect(islands.map((g) => g.getAttribute('data-group'))).toEqual([
      'top_t',
      'top_v',
      'unshelved',
    ]);
    expect(islands[2]?.classList.contains('pt-map__island--unshelved')).toBe(true);
    const inside = (key: string) =>
      [
        ...(plan.querySelector(`[data-group="${key}"]`)?.querySelectorAll('[data-paper-id]') ?? []),
      ].map((t) => t.getAttribute('data-paper-id'));
    expect(inside('top_t')).toEqual(['ppr_att', 'ppr_bert']);
    expect(inside('unshelved')).toEqual(['ppr_ddpm']);
    expect(plan.getAttribute('aria-label')).toBe(
      'Plan of the reading room: 2 topics, 5 papers, 3 citation links. The plan as a list, after it, says the same in words.',
    );
  });

  it('draws only the real links, each tagged with how it matched', async () => {
    const plan = await openMap();
    const drawn = [...plan.querySelectorAll('.pt-map__link')];
    expect(drawn.map((g) => g.getAttribute('data-matched-by'))).toEqual([
      'title',
      'title',
      'title',
    ]);
    for (const g of drawn) expect(g.textContent).toBe('cites itmatched by title');
    expect(
      within(screen.getByRole('region', { name: 'Plan of the reading room' })).getByText(
        /matched by its title or arXiv id\) · 3/,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Papers you linked on a board · none yet')).toBeTruthy();
  });

  it('the list alternative, reached by Tab, lists the topics, their papers and the 3 real links', async () => {
    await openMap();
    const summary = screen.getByText('The plan as a list');
    expect(summary.tagName).toBe('SUMMARY');
    const list = openList();
    const links = [...list.querySelectorAll('[data-map-links] li')].map((li) => li.textContent);
    expect(links).toEqual([
      'Denoising Diffusion Probabilistic Models cites Attention Is All You Need · matched by title',
      'BERT cites Attention Is All You Need · matched by title',
      'Attention Is All You Need cites Deep Residual Learning for Image Recognition · matched by title',
    ]);
    expect(
      within(list).getByRole('link', { name: 'Attention Is All You Need' }).getAttribute('href'),
    ).toContain('ppr_att');
    expect(list.textContent).toContain(
      'Unshelved · 1 paper · 12 pages · arXiv cs.LG · no topic yet',
    );
    expect(list.textContent).toContain('Papers you linked on a board: none yet');
  });

  it('with no links says "none yet" and draws no line at all', async () => {
    papersApi.links.mockResolvedValue({ links: [] });
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    const plan = await screen.findByRole('img', { name: /0 citation links/ });
    expect(plan.querySelectorAll('.pt-map__link, path[marker-end]')).toHaveLength(0);
    expect(screen.getByText(/matched by its title or arXiv id\) · none yet/)).toBeTruthy();
    expect(openList().textContent).toContain(
      'None yet: no paper here cites another paper in your library.',
    );
  });

  it('a search dims the papers it does not match and lights the ones it does', async () => {
    const plan = await openMap();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bert' } });
    const match = (id: string) =>
      plan.querySelector(`[data-paper-id="${id}"]`)?.getAttribute('data-match');
    expect([match('ppr_bert'), match('ppr_att'), match('ppr_ddpm')]).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('has no axe violations at WCAG 2.2 AA, with the list open', async () => {
    await openMap();
    openList();
    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`)).toEqual([]);
  });
});
