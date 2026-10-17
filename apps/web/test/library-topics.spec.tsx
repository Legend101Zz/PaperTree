/**
 * The Topics view (#198, frame 03) through the whole page, against a small in-memory server that
 * keeps S2b's rules (an offer shelves nothing; accepting the offer keeps its arXiv source, any other
 * choice is the person's; deleting a topic unshelves its papers): topic CRUD through the UI (create,
 * rename and recolour, delete with its inline confirmation), accepting a suggestion moves the paper
 * from Unshelved onto the topic, "Not this" and choosing a topic, the grid's one tab stop and arrows,
 * Enter shows the topic on the shelf, and axe finds nothing at WCAG 2.2 AA.
 */
import axe from 'axe-core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/types';
import type { AcceptTopicBody, Cloth, PaperTopic, Topic } from '@/lib/api/topics';
import type { LibraryPaper } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';

import { renderLibrary, row } from './library-table-cases';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

interface Placement {
  topic_id: string;
  source: 'arxiv_category' | 'manual';
  source_detail: string | null;
}

/** The fake server's state: topics, accepted placements, and stored offers / refusals. */
const db = vi.hoisted(() => ({
  topics: [] as Topic[],
  placed: new Map<string, Placement>(),
  rejected: new Set<string>(),
  next: 1,
  /** More unshelved papers, for "Show all". */
  more: [] as LibraryPaper[],
}));

const PAPERS: LibraryPaper[] = [
  row('ppr_att', 'Attention Is All You Need', { arxiv_category: 'cs.CL', page_count: 15 }),
  row('ppr_bert', 'BERT: Pre-training of Deep Bidirectional Transformers', {
    arxiv_category: 'cs.CL',
    page_count: 16,
    created_at: '2026-10-02T10:00:00+00:00',
  }),
  row('ppr_resnet', 'Deep Residual Learning for Image Recognition', {
    created_at: '2026-10-03T10:00:00+00:00',
  }),
];

const all = () => [...PAPERS, ...db.more];
const category = (id: string) => all().find((p) => p.paper_id === id)?.arxiv_category ?? null;
const topicOf = (id: string) => db.topics.find((t) => t.topic_id === id);

/** S2b's deterministic rule: the topic already holding a paper of the same category. */
function offerFor(paperId: string): PaperTopic {
  const cat = category(paperId);
  const placed = db.placed.get(paperId);
  const base = { suggested_name: null, arxiv_category: cat };
  if (placed !== undefined) {
    const t = topicOf(placed.topic_id) as Topic;
    return {
      ...base,
      status: 'accepted',
      topic: { topic_id: t.topic_id, name: t.name, cloth: t.cloth },
      source: placed.source,
      source_detail: placed.source_detail,
    };
  }
  if (db.rejected.has(paperId))
    return {
      ...base,
      status: 'rejected',
      topic: null,
      source: 'arxiv_category',
      source_detail: cat,
    };
  const holder = [...db.placed.entries()].find(([id]) => category(id) === cat)?.[1];
  const t = holder === undefined ? undefined : topicOf(holder.topic_id);
  return t === undefined
    ? { ...base, status: 'none', topic: null, source: null, source_detail: null }
    : {
        ...base,
        status: 'suggested',
        topic: { topic_id: t.topic_id, name: t.name, cloth: t.cloth },
        source: 'arxiv_category',
        source_detail: cat,
      };
}

const topicsApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  ofPaper: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
}));
const papersApi = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
vi.mock('@/lib/api/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/topics')>()),
  topicsApi,
}));
vi.mock('@/lib/api/papers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/papers')>()),
  papersApi,
}));

function wire(): void {
  papersApi.list.mockImplementation(async () =>
    all().map((p) => {
      const placed = db.placed.get(p.paper_id);
      const t = placed === undefined ? undefined : topicOf(placed.topic_id);
      return {
        ...p,
        topic:
          t === undefined || placed === undefined
            ? null
            : {
                topic_id: t.topic_id,
                name: t.name,
                cloth: t.cloth,
                source: placed.source,
                source_detail: placed.source_detail,
              },
      };
    }),
  );
  topicsApi.list.mockImplementation(async () =>
    db.topics.map((t) => {
      const held = PAPERS.filter((p) => db.placed.get(p.paper_id)?.topic_id === t.topic_id);
      return {
        ...t,
        paper_count: held.length,
        page_count: held.reduce((n, p) => n + (p.page_count ?? 0), 0),
      };
    }),
  );
  topicsApi.create.mockImplementation(async ({ name, cloth }: { name: string; cloth?: Cloth }) => {
    if (db.topics.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      // The real API's detail (papertree_db.topics): a log line, lower case, Python quotes.
      throw new ApiError(409, 'topic_exists', `you already have a topic called '${name}'`, false);
    }
    const topic: Topic = {
      topic_id: `top_${String(db.next++)}`,
      name,
      cloth: cloth ?? null,
      sort_order: 0,
      paper_count: 0,
      page_count: 0,
      categories: [],
    };
    db.topics.push(topic);
    return topic;
  });
  topicsApi.patch.mockImplementation(async (id: string, body: Partial<Topic>) => {
    const t = topicOf(id) as Topic;
    Object.assign(t, body);
    return t;
  });
  topicsApi.remove.mockImplementation(async (id: string) => {
    db.topics = db.topics.filter((t) => t.topic_id !== id);
    for (const [paper, placed] of db.placed) if (placed.topic_id === id) db.placed.delete(paper);
  });
  topicsApi.ofPaper.mockImplementation(async (id: string) => offerFor(id));
  topicsApi.accept.mockImplementation(async (id: string, body: AcceptTopicBody) => {
    const offer = offerFor(id);
    const kept = offer.status === 'suggested' && offer.topic?.topic_id === body.topic_id;
    db.placed.set(id, {
      topic_id: body.topic_id ?? '',
      source: kept ? 'arxiv_category' : 'manual',
      source_detail: kept ? offer.source_detail : null,
    });
    return offerFor(id);
  });
  topicsApi.reject.mockImplementation(async (id: string) => {
    db.rejected.add(id);
    return offerFor(id);
  });
}

beforeEach(() => {
  db.topics = [];
  db.placed = new Map();
  db.rejected = new Set();
  db.next = 1;
  db.more = [];
  for (const fn of [...Object.values(topicsApi), ...Object.values(papersApi)]) fn.mockReset();
  wire();
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

async function openTopics(): Promise<HTMLElement> {
  await renderLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'Topics' }));
  return screen.findByRole('region', { name: 'Topics' });
}

async function createTopic(name: string, cloth = 'Oxblood'): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'New topic' }));
  const form = screen.getByRole('group', { name: 'New topic' });
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(within(form).getByLabelText(cloth));
  fireEvent.click(within(form).getByRole('button', { name: 'Create topic' }));
  await waitFor(() => expect(screen.queryByRole('group', { name: 'New topic' })).toBeNull());
}

const card = (name: string) => screen.getByRole('button', { name }).closest('li') as HTMLElement;
const unshelvedRow = (id: string) =>
  screen
    .getByRole('region', { name: 'Unshelved' })
    .querySelector<HTMLElement>(`[data-paper-id="${id}"]`);

describe('the Topics view (#198)', () => {
  it('with no topics says how they arrive, and lists every paper as Unshelved', async () => {
    const view = await openTopics();
    expect(within(view).getByText('No topics yet')).toBeTruthy();
    expect(within(view).getByText(/nothing is\s+shelved until you accept/)).toBeTruthy();
    await waitFor(() =>
      expect(unshelvedRow('ppr_resnet')?.textContent).toContain('No suggestion yet'),
    );
    expect(unshelvedRow('ppr_att')).toBeTruthy();
  });

  it('creates a topic with its cloth, and refuses a name already used without losing it', async () => {
    await openTopics();
    await createTopic('Transformers & attention', 'Green');
    expect(topicsApi.create).toHaveBeenCalledWith({
      name: 'Transformers & attention',
      cloth: 'vision',
    });
    const made = card('Transformers & attention');
    expect(made.textContent).toContain('No papers yet');
    expect(made.textContent).toContain('Made by you');
    expect(made.querySelector('.pt-topicbanner--vision')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New topic' }));
    const form = screen.getByRole('group', { name: 'New topic' });
    fireEvent.change(within(form).getByLabelText('Name'), {
      target: { value: 'transformers & ATTENTION' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Create topic' }));
    expect(
      await within(form).findByText(
        'You already have a topic called “transformers & ATTENTION” (letter case aside). Choose another name.',
      ),
    ).toBeTruthy();
    expect(within(form).queryByText(/you already have a topic called '/)).toBeNull();
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'transformers & ATTENTION',
    );
  });

  it('renames and recolours through the card’s menu', async () => {
    await openTopics();
    await createTopic('Transformers');
    fireEvent.click(screen.getByRole('button', { name: 'Manage Transformers' }));
    const panel = screen.getByRole('group', { name: 'Manage Transformers' });
    fireEvent.change(within(panel).getByLabelText('Name'), {
      target: { value: 'Transformers & attention' },
    });
    fireEvent.click(within(panel).getByLabelText('Navy'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Manage/ })).toBeNull());
    expect(topicsApi.patch).toHaveBeenCalledWith('top_1', {
      name: 'Transformers & attention',
      cloth: 'optimization',
    });
    expect(
      card('Transformers & attention').querySelector('.pt-topicbanner--optimization'),
    ).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Manage Transformers & attention',
    );
  });

  it('deletes only after the inline confirmation; its papers go back to Unshelved', async () => {
    await openTopics();
    await createTopic('Transformers');
    await createTopic('Vision', 'Green');
    // Shelve Attention on Transformers by choosing it.
    await waitFor(() => expect(unshelvedRow('ppr_att')?.querySelector('select')).toBeTruthy());
    const att = unshelvedRow('ppr_att') as HTMLElement;
    fireEvent.change(within(att).getByLabelText(/Choose a topic for Attention/), {
      target: { value: 'top_1' },
    });
    fireEvent.click(within(att).getByRole('button', { name: 'Shelve Attention Is All You Need' }));
    await waitFor(() => expect(unshelvedRow('ppr_att')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Manage Transformers' }));
    const panel = screen.getByRole('group', { name: 'Manage Transformers' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete topic' }));
    const confirm = within(panel).getByRole('group', { name: 'Confirm deleting Transformers' });
    expect(confirm.textContent).toContain(
      'Its paper goes back to Unshelved; the papers and their highlights stay.',
    );
    expect(document.activeElement?.textContent).toBe('Keep it');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(within(panel).queryByRole('group', { name: /^Confirm/ })).toBeNull();
    expect(document.activeElement?.textContent).toBe('Delete topic');
    expect(topicsApi.remove).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole('button', { name: 'Delete topic', expanded: false }));
    const again = within(panel).getByRole('group', { name: 'Confirm deleting Transformers' });
    fireEvent.click(within(again).getByRole('button', { name: 'Delete topic' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Transformers' })).toBeNull());
    expect(topicsApi.remove).toHaveBeenCalledWith('top_1');
    expect(unshelvedRow('ppr_att')).toBeTruthy();
    // Focus goes to the neighbouring card, never to the page.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Vision'));
  });

  it('accepting a suggestion moves the paper from Unshelved onto the topic, keeping its source', async () => {
    await openTopics();
    await createTopic('Transformers & attention');
    await waitFor(() => expect(unshelvedRow('ppr_att')?.querySelector('select')).toBeTruthy());
    const att = unshelvedRow('ppr_att') as HTMLElement;
    fireEvent.change(within(att).getByLabelText(/Choose a topic for Attention/), {
      target: { value: 'top_1' },
    });
    fireEvent.click(within(att).getByRole('button', { name: /^Shelve Attention/ }));
    await waitFor(() => expect(unshelvedRow('ppr_att')).toBeNull());

    // Attention (cs.CL) is on the topic now, so BERT (cs.CL) is offered it; nothing is shelved yet.
    const bert = await waitFor(() => {
      const found = unshelvedRow('ppr_bert');
      expect(found?.textContent).toContain(
        'Suggested: Transformers & attention · from arXiv cs.CL',
      );
      return found as HTMLElement;
    });
    expect(card('Transformers & attention').textContent).toContain('1 paper');
    fireEvent.click(within(bert).getByRole('button', { name: 'Accept the suggestion for BERT' }));
    await waitFor(() => expect(unshelvedRow('ppr_bert')).toBeNull());
    expect(topicsApi.accept).toHaveBeenLastCalledWith('ppr_bert', { topic_id: 'top_1' });
    const topic = card('Transformers & attention');
    expect(topic.textContent).toContain('2 papers');
    expect(topic.textContent).toContain('31 pages');
    expect(topic.textContent).toContain(
      'Suggested from arXiv cs.CL · you accepted · 1 chosen by you',
    );
    expect(topic.querySelectorAll('.pt-sky__spine')).toHaveLength(2);
    // Focus moved to the next Unshelved row, not to the page.
    await waitFor(() =>
      expect(unshelvedRow('ppr_resnet')?.contains(document.activeElement)).toBe(true),
    );
  });

  it('"Not this" records the no and keeps the paper unshelved', async () => {
    db.topics.push({
      topic_id: 'top_9',
      name: 'Transformers',
      cloth: 'transformers',
      sort_order: 0,
      paper_count: 0,
      page_count: 0,
      categories: [],
    });
    db.placed.set('ppr_att', { topic_id: 'top_9', source: 'manual', source_detail: null });
    await openTopics();
    const bert = await waitFor(() => {
      const found = unshelvedRow('ppr_bert');
      expect(found?.textContent).toContain('Suggested: Transformers');
      return found as HTMLElement;
    });
    fireEvent.click(within(bert).getByRole('button', { name: 'Not this topic for BERT' }));
    await waitFor(() =>
      expect(unshelvedRow('ppr_bert')?.textContent).toContain('You said no to the suggestion'),
    );
    expect(topicsApi.reject).toHaveBeenCalledWith('ppr_bert');
    expect(topicsApi.accept).not.toHaveBeenCalled();
    expect(
      within(unshelvedRow('ppr_bert') as HTMLElement).queryByRole('button', { name: /^Accept/ }),
    ).toBeNull();
  });

  it('is one tab stop: arrows move between cards, Enter shows the topic on the shelf', async () => {
    await openTopics();
    await createTopic('Transformers');
    await createTopic('Vision', 'Green');
    await waitFor(() => expect(unshelvedRow('ppr_att')?.querySelector('select')).toBeTruthy());
    fireEvent.change(
      within(unshelvedRow('ppr_resnet') as HTMLElement).getByLabelText(/Choose a topic for Deep/),
      { target: { value: 'top_2' } },
    );
    fireEvent.click(
      within(unshelvedRow('ppr_resnet') as HTMLElement).getByRole('button', {
        name: /^Shelve Deep/,
      }),
    );
    await waitFor(() => expect(unshelvedRow('ppr_resnet')).toBeNull());

    const first = screen.getByRole('button', { name: 'Transformers' });
    const second = screen.getByRole('button', { name: 'Vision' });
    expect([first.tabIndex, second.tabIndex]).toEqual([0, -1]);
    expect(screen.getByRole('button', { name: 'Manage Vision' }).tabIndex).toBe(-1);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
    expect([first.tabIndex, second.tabIndex]).toEqual([-1, 0]);
    expect(screen.getByRole('button', { name: 'Manage Vision' }).tabIndex).toBe(0);
    // An empty topic says so and opens nothing.
    expect(first.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(second);
    const shelf = await screen.findByRole('toolbar', { name: 'Shelf' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-paper-id')).toBe('ppr_resnet'),
    );
    expect(shelf.contains(document.activeElement)).toBe(true);
    expect((screen.getByLabelText('Arrange by') as HTMLSelectElement).value).toBe('topic');
  });

  it('dims the cards and rows a search does not match', async () => {
    await openTopics();
    await createTopic('Vision', 'Green');
    await waitFor(() => expect(unshelvedRow('ppr_resnet')?.querySelector('select')).toBeTruthy());
    fireEvent.change(
      within(unshelvedRow('ppr_resnet') as HTMLElement).getByLabelText(/Choose a topic for Deep/),
      { target: { value: 'top_1' } },
    );
    fireEvent.click(
      within(unshelvedRow('ppr_resnet') as HTMLElement).getByRole('button', {
        name: /^Shelve Deep/,
      }),
    );
    await waitFor(() => expect(unshelvedRow('ppr_resnet')).toBeNull());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bert' } });
    expect(card('Vision').getAttribute('data-match')).toBe('false');
    expect(unshelvedRow('ppr_bert')?.getAttribute('data-match')).toBe('true');
    expect(unshelvedRow('ppr_att')?.getAttribute('data-match')).toBe('false');
  });

  it('the title counts every topic, an empty one too', async () => {
    await openTopics();
    await createTopic('Transformers');
    await createTopic('Vision', 'Green');
    await waitFor(() =>
      expect(document.querySelector('.pt-libtitle__stats')?.textContent).toContain('2 topics'),
    );
  });

  it('Enter in the search acts on Topics and never takes a book down on the hidden shelf', async () => {
    await openTopics();
    await createTopic('Transformers');
    await waitFor(() => expect(unshelvedRow('ppr_att')?.querySelector('select')).toBeTruthy());
    const att = unshelvedRow('ppr_att') as HTMLElement;
    fireEvent.change(within(att).getByLabelText(/Choose a topic for Attention/), {
      target: { value: 'top_1' },
    });
    fireEvent.click(within(att).getByRole('button', { name: /^Shelve Attention/ }));
    await waitFor(() => expect(unshelvedRow('ppr_att')).toBeNull());
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'attention' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Transformers' }));
    // A search that only an Unshelved paper matches goes to that row.
    fireEvent.change(search, { target: { value: 'residual' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(unshelvedRow('ppr_resnet')?.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('[data-card-paper-id]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Shelf' }));
    expect(document.querySelector('[data-card-paper-id]')).toBeNull();
  });

  it('"Show all" puts focus on the first paper it brings in', async () => {
    db.more = Array.from({ length: 8 }, (_, i) =>
      row(`ppr_x${String(i)}`, `Extra paper ${String(i)}`, {
        created_at: `2026-10-0${String(4 + (i % 5))}T1${String(i)}:00:00+00:00`,
      }),
    );
    await openTopics();
    await createTopic('Transformers');
    const show = await screen.findByRole('button', { name: 'Show all 11' });
    const card = screen.getByRole('region', { name: 'Unshelved' });
    expect(card.querySelectorAll('li[data-paper-id]')).toHaveLength(8);
    fireEvent.click(show);
    const rows = card.querySelectorAll('li[data-paper-id]');
    expect(rows).toHaveLength(11);
    expect(rows[8]?.contains(document.activeElement)).toBe(true);
  });

  it('a rename keeps a topic without a cloth without one', async () => {
    db.topics.push({
      topic_id: 'top_9',
      name: 'Reading list',
      cloth: null,
      sort_order: 0,
      paper_count: 0,
      page_count: 0,
      categories: [],
    });
    await openTopics();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Reading list' }));
    const panel = screen.getByRole('group', { name: 'Manage Reading list' });
    expect(
      within(panel)
        .getAllByRole('radio')
        .some((r) => (r as HTMLInputElement).checked),
    ).toBe(false);
    fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'To read' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(topicsApi.patch).toHaveBeenCalledWith('top_9', { name: 'To read' }));
  });

  it('has no axe violations at WCAG 2.2 AA, with a card menu open', async () => {
    await openTopics();
    await createTopic('Transformers');
    await waitFor(() => expect(unshelvedRow('ppr_att')?.querySelector('select')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Manage Transformers' }));
    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`)).toEqual([]);
  });
});
