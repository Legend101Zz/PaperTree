/**
 * The opened book's actions (v0.3 #337, V3-36), through the library page: Read becomes "Continue at
 * p. n" once reading has started; the ⋯ menu (Rename, Topic, Delete) is reached by keyboard and
 * Esc closes it before it puts the book back; Rename edits the title in place (`PATCH /papers/{id}`);
 * Topic moves the spine to another group or off its shelf; Delete asks nothing, hides the book and
 * offers Undo for 10 s before the real request goes (fake timers); a failed, queued or being-read
 * paper opens its spread with its status, Retry and Remove, or a disabled Read.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '@/features/library';
import { ApiError, type LibraryPaper } from '@/lib/api/types';

import { readingAt } from './library-corpus';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  uploadWithProgress: vi.fn(),
  putReadingState: vi.fn(),
}));
const auth = vi.hoisted(() => ({ me: vi.fn(), setDisplayName: vi.fn() }));
vi.mock('@/lib/api/papers', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api/papers')>();
  return { ...real, papersApi: api, authApi: { ...real.authApi, ...auth } };
});
const book = vi.hoisted(() => ({
  figures: vi.fn(),
  abstract: vi.fn(),
  setPlate: vi.fn(),
  clearPlate: vi.fn(),
}));
vi.mock('@/features/book/api/bookApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/book/api/bookApi')>()),
  bookApi: book,
}));
const summary = vi.hoisted(() => ({ get: vi.fn(), generate: vi.fn() }));
vi.mock('@/lib/api/summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/summary')>()),
  summaryApi: summary,
}));
const topics = vi.hoisted(() => ({
  list: vi.fn(),
  ofPaper: vi.fn(),
  accept: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/lib/api/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/topics')>()),
  topicsApi: topics,
}));

const ID = 'ppr_ATTENTION';
const OTHER = 'ppr_SECOND';
const TRANSFORMERS = {
  topic_id: 'top_T',
  name: 'Transformers & attention',
  cloth: 'transformers' as const,
};
const VISION = { topic_id: 'top_V', name: 'Vision', cloth: 'vision' as const };

function row(overrides: Partial<LibraryPaper> = {}): LibraryPaper {
  return {
    paper_id: ID,
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani'],
    original_filename: 'attention.pdf',
    source_hash: 'sha256:a',
    page_count: 15,
    processing: 'ready',
    job: null,
    generation: 1,
    parser_version: '1.0.0',
    highlight_count: 3,
    created_at: '2026-10-15T09:00:00+00:00',
    updated_at: '2026-10-15T09:00:00+00:00',
    reading: readingAt(3, 15, '2026-10-16T09:00:00Z'),
    year: 2017,
    arxiv_id: '1706.03762',
    arxiv_category: 'cs.CL',
    thread_count: 2,
    has_summary: true,
    topic: { ...TRANSFORMERS, source: 'arxiv_category', source_detail: 'cs.CL' },
    notebook_count: 1,
    plate: null,
    ...overrides,
  };
}
const SECOND = row({
  paper_id: OTHER,
  title: 'Deep Residual Learning',
  reading: null,
  highlight_count: 0,
  thread_count: 0,
  created_at: '2026-10-14T09:00:00+00:00',
});

function setReducedMotion(reduced: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
const animate = vi.fn();

beforeEach(() => {
  push.mockReset();
  for (const fn of [api.retry, api.remove, api.rename, topics.accept, topics.clear]) fn.mockReset();
  book.figures.mockReset();
  summary.get.mockReset();
  api.list.mockResolvedValue([row(), SECOND]);
  api.remove.mockResolvedValue(undefined);
  auth.me.mockResolvedValue({ user_id: 'usr_1', email: 'a@example.test', display_name: 'Mrigesh' });
  book.figures.mockResolvedValue([]);
  book.abstract.mockResolvedValue({ text: null, page_index: null, anchor: null });
  summary.get.mockResolvedValue({ state: 'none', summary: null });
  topics.list.mockResolvedValue([
    { ...TRANSFORMERS, sort_order: 0, paper_count: 1, page_count: 15, categories: [] },
    { ...VISION, sort_order: 1, paper_count: 0, page_count: 0, categories: [] },
  ]);
  topics.ofPaper.mockResolvedValue({
    status: 'none',
    topic: null,
    suggested_name: null,
    source: null,
    source_detail: null,
    arxiv_category: null,
  });
  setReducedMotion(false);
  animate.mockReset();
  animate.mockImplementation(() => ({
    finished: Promise.resolve(),
    cancel: () => undefined,
    finish: () => undefined,
  }));
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  window.localStorage.clear();
  window.localStorage.setItem('papertree.session', 'tok_test');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

async function renderLibrary(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(spine(ID)).not.toBeNull());
}

const spine = (id: string) =>
  document.querySelector<HTMLElement>(`[aria-label="Your shelf"] [data-paper-id="${id}"]`);
/** The ids of the spines on the shelf, in order. */
const shelfOrder = (): string[] =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[aria-label="Your shelf"] [data-paper-id]'),
  ).map((node) => node.dataset.paperId ?? '');

async function open(id = ID, title = 'Attention Is All You Need'): Promise<HTMLElement> {
  const node = spine(id) as HTMLElement;
  node.focus();
  fireEvent.click(node);
  const dialog = await screen.findByRole('dialog', { name: title });
  await waitFor(() => expect(dialog.getAttribute('data-book-stage')).toBe('open'));
  return dialog;
}
const moreButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /^More: rename, topic, delete/ });
async function openMenu(dialog: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(moreButton(dialog));
  return within(dialog).findByRole('menu', { name: 'More' });
}
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('Read and Continue', () => {
  it('says "Continue at p. 4" once reading has started, takes focus, and resumes there', async () => {
    await renderLibrary();
    const dialog = await open();
    const go = within(dialog).getByRole('button', { name: /^Continue at p\. 4 / });
    expect(document.activeElement).toBe(go);
    fireEvent.click(go);
    await waitFor(() => expect(push).toHaveBeenLastCalledWith(`/paper/${ID}/read`));
    // useContinue wrote the server's page (zero-based 3) as the reader's place first.
    const stored = Object.entries(window.localStorage).find(([key]) => key.includes(ID));
    expect(stored?.[1]).toMatch(/"page":3/);
  });

  it('says plain Read for a paper not started or finished', async () => {
    api.list.mockResolvedValue([row({ reading: null })]);
    await renderLibrary();
    const dialog = await open();
    expect(within(dialog).getByRole('button', { name: /^Read / })).toBe(document.activeElement);
    expect(within(dialog).queryByRole('button', { name: /^Continue/ })).toBeNull();
  });
});

describe('the ⋯ menu', () => {
  it('opens by keyboard on its first item and walks with the arrow keys', async () => {
    await renderLibrary();
    const dialog = await open();
    const menu = await openMenu(dialog);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Rename…',
      'TopicTransformers & attention',
      'Delete this paperundo for 10 s',
    ]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]); // wraps
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('Esc closes the menu first, and a second Esc puts the book back', async () => {
    await renderLibrary();
    const dialog = await open();
    const menu = await openMenu(dialog);
    fireEvent.keyDown(within(menu).getAllByRole('menuitem')[0] as HTMLElement, { key: 'Escape' });
    expect(within(dialog).queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog); // the book is still open
    expect(document.activeElement).toBe(moreButton(dialog));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(spine(ID));
  });
});

describe('Rename', () => {
  async function startRename(dialog: HTMLElement): Promise<HTMLTextAreaElement> {
    const menu = await openMenu(dialog);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename…' }));
    const field = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: 'Title' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    return field;
  }

  it('edits the title in place: Enter saves the trimmed title, and the spine and the heading follow', async () => {
    api.rename.mockImplementation((id: string, title: string) => {
      api.list.mockResolvedValue([row({ title }), SECOND]);
      return Promise.resolve(row({ paper_id: id, title }));
    });
    await renderLibrary();
    const dialog = await open();
    const field = await startRename(dialog);
    expect(field.value).toBe('Attention Is All You Need');
    fireEvent.change(field, { target: { value: '  Attention, my notes  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith(ID, 'Attention, my notes'));
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: 'Attention, my notes' })).toBeTruthy(),
    );
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(spine(ID)?.getAttribute('aria-label')).toMatch(/Attention, my notes/);
    expect(document.activeElement).toBe(moreButton(dialog));
  });

  it('Esc cancels without a request, and the book stays open', async () => {
    await renderLibrary();
    const dialog = await open();
    const field = await startRename(dialog);
    fireEvent.change(field, { target: { value: 'Something else' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Attention Is All You Need' })).toBeTruthy();
    expect(api.rename).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('refuses a blank title in a sentence and keeps the field open', async () => {
    await renderLibrary();
    const dialog = await open();
    const field = await startRename(dialog);
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect((await within(dialog).findByRole('alert')).textContent).toBe('A title cannot be empty.');
    expect(api.rename).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toBe(field);
  });

  it('says so when the server refuses, and keeps what was typed', async () => {
    api.rename.mockRejectedValue(new ApiError(500, 'internal', 'down', false));
    await renderLibrary();
    const dialog = await open();
    const field = await startRename(dialog);
    fireEvent.change(field, { target: { value: 'New name' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/not changed/);
    expect(field.value).toBe('New name');
  });
});

describe('Topic', () => {
  async function topicList(dialog: HTMLElement): Promise<HTMLElement> {
    const menu = await openMenu(dialog);
    await waitFor(() => expect(topics.list).toHaveBeenCalled());
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Topic/ }));
    return within(menu).findByRole('group', { name: 'Choose a topic' });
  }

  it('lists the existing topics with the current one ticked, and choosing another shelves it there', async () => {
    topics.accept.mockResolvedValue({ status: 'accepted', topic: VISION });
    await renderLibrary();
    const dialog = await open();
    const list = await topicList(dialog);
    const radios = await within(list).findAllByRole('menuitemradio');
    expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['Transformers & attention', 'true'],
      ['Vision', 'false'],
      ['No topic', 'false'],
    ]);
    fireEvent.click(radios[1] as HTMLElement);
    await waitFor(() => expect(topics.accept).toHaveBeenCalledWith(ID, { topic_id: 'top_V' }));
    await waitFor(() => expect(within(dialog).queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(moreButton(dialog));
  });

  it('"No topic" takes the book off its shelf', async () => {
    topics.clear.mockResolvedValue({ status: 'none', topic: null });
    await renderLibrary();
    const dialog = await open();
    const list = await topicList(dialog);
    fireEvent.click(await within(list).findByRole('menuitemradio', { name: 'No topic' }));
    await waitFor(() => expect(topics.clear).toHaveBeenCalledWith(ID));
  });
});

describe('Delete, with Undo for 10 seconds', () => {
  beforeEach(() => {
    // The clock moves with real time too, so findBy / waitFor keep polling; the 10 s are jumped.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  async function deleteIt(): Promise<void> {
    const dialog = await open();
    const menu = await openMenu(dialog);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Delete this paper/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
  // The fake clock also runs with real time (shouldAdvanceTime), so a slow machine pushes it on by
  // itself: "not yet" checks stop well short of the 10 s, never at its edge (that was the flake).
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('closes the book, removes the spine and offers Undo; nothing is sent while it is on offer', async () => {
    await renderLibrary();
    await deleteIt();
    expect(spine(ID)).toBeNull();
    expect(shelfOrder()).toEqual([OTHER]);
    const toast = await screen.findByText(
      'Deleted “Attention Is All You Need”, with your 3 highlights and 2 threads',
    );
    expect(toast).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBe(document.activeElement);
    await advance(4_000);
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('Undo puts the spine back exactly where it was, and the request never goes', async () => {
    await renderLibrary();
    const before = shelfOrder();
    expect([...before].sort()).toEqual([ID, OTHER]);
    await deleteIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(shelfOrder()).toEqual(before));
    expect(document.activeElement).toBe(spine(ID));
    await advance(20_000);
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('sends DELETE only when the 10 s run out, and the spine stays gone', async () => {
    await renderLibrary();
    await deleteIt();
    await advance(4_000);
    expect(api.remove).not.toHaveBeenCalled();
    await advance(6_200);
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledWith(ID);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    expect(shelfOrder()).toEqual([OTHER]);
    // With nothing left to focus, focus went to the shelf rather than the page.
    expect(document.activeElement).not.toBe(document.body);
  });

  it('sends it at once, with keepalive, when the page is hidden first', async () => {
    await renderLibrary();
    await deleteIt();
    expect(api.remove).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.remove).toHaveBeenCalledWith(ID, { keepalive: true });
    await advance(20_000);
    expect(api.remove).toHaveBeenCalledTimes(1);
  });

  it('sends the first delete at once when a second book is deleted (one Undo at a time)', async () => {
    await renderLibrary();
    await deleteIt();
    const dialog = await open(OTHER, 'Deep Residual Learning');
    const menu = await openMenu(dialog);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Delete this paper/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledWith(ID);
    await advance(10_100);
    expect(api.remove).toHaveBeenLastCalledWith(OTHER);
  });

  it('puts the book back with a sentence when the server refuses', async () => {
    api.remove.mockRejectedValue(new ApiError(500, 'internal', 'boom', false));
    await renderLibrary();
    await deleteIt();
    await advance(10_100);
    await waitFor(() => expect(spine(ID)).not.toBeNull());
    expect(await screen.findByText(/Could not delete “Attention Is All You Need”/)).toBeTruthy();
  });

  it('under reduced motion plays no reverse: the book just goes', async () => {
    setReducedMotion(true);
    await renderLibrary();
    const dialog = await open();
    animate.mockClear();
    const menu = await openMenu(dialog);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Delete this paper/ }));
    expect(screen.queryByRole('dialog')).toBeNull(); // no 420 ms to wait for
    await flush();
    expect(animate).not.toHaveBeenCalled();
    expect(spine(ID)).toBeNull();
  });
});

describe('papers that are not simply ready', () => {
  const job = (overrides: Partial<NonNullable<LibraryPaper['job']>> = {}) => ({
    job_id: 'job_1',
    kind: 'parse' as const,
    state: 'running' as const,
    step: 'parse' as const,
    done: 0,
    total: 3,
    attempt: 1,
    max_attempts: 3,
    error_code: null,
    ...overrides,
  });

  it('a failed paper opens its spread with the reason, Retry and Remove, and no Read', async () => {
    api.list.mockResolvedValue([
      row({
        processing: 'failed',
        generation: null,
        reading: null,
        job: job({ state: 'dead_letter', error_code: 'pdf_unreadable' }),
      }),
    ]);
    api.retry.mockResolvedValue({ job_id: 'job_2', generation: 1 });
    await renderLibrary();
    const dialog = await open();
    expect(push).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/could not be read as a PDF/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /^Read/ })).toBeNull();
    const retry = within(dialog).getByRole('button', { name: /^Retry/ });
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith(ID));
    // It asked for nothing a failed paper does not have.
    expect(book.figures).not.toHaveBeenCalled();
    expect(summary.get).not.toHaveBeenCalled();
  });

  it('Remove on a failed paper is the same Delete: the book closes and Undo is offered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.list.mockResolvedValue([
      row({
        processing: 'failed',
        generation: null,
        reading: null,
        job: job({ state: 'dead_letter' }),
      }),
    ]);
    await renderLibrary();
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Remove/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('a paper being read has a disabled Read and says why', async () => {
    api.list.mockResolvedValue([
      row({ processing: 'reading', generation: null, reading: null, job: job() }),
    ]);
    await renderLibrary();
    const dialog = await open();
    expect(within(dialog).getByText(/reading this paper now/i)).toBeTruthy();
    const read = within(dialog).getByRole('button', { name: /^Read/ });
    expect(read.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(read);
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dialog); // focus is not parked on a button that does nothing
    expect(push).not.toHaveBeenCalled();
  });

  it('a queued paper says it is waiting and still opens its PDF in Source mode', async () => {
    api.list.mockResolvedValue([
      row({ processing: 'queued', generation: null, reading: null, job: null }),
    ]);
    await renderLibrary();
    const dialog = await open();
    expect(within(dialog).getByText(/waiting for its turn/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Read/ }));
    await waitFor(() => expect(push).toHaveBeenLastCalledWith(`/paper/${ID}/read`));
  });

  it('a partial paper reads, and says what is missing in place of the abstract', async () => {
    api.list.mockResolvedValue([row({ processing: 'partial', reading: null })]);
    await renderLibrary();
    const dialog = await open();
    expect(within(dialog).getByText(/Some parts of this paper could not be read/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Read/ })).toBe(document.activeElement);
  });
});
