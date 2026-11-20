/**
 * The library page (#195, part 2): the header search ("/" focuses it, Esc clears it, "2 of N",
 * Enter takes the first match off the shelf and opens it, nothing reorders), the stats line and
 * "need a look", Arrange by, the header menus and dropping PDFs anywhere. A click on a spine, the
 * motion and the spread are test/book.spec.tsx's.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '@/features/library';
import type { LibraryPaper } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';

import { corpusRows } from './library-corpus';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
vi.mock('@/lib/api/papers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/papers')>()),
  papersApi: api,
}));
// The library reads `GET /topics` for its stats line; this spec is not about topics (#310).
vi.mock('@/lib/api/topics', async (importOriginal) =>
  (await import('./api-stubs')).withNoTopics(await importOriginal()),
);
// The opened book reads its figures, abstract and summary; this spec only needs it to open.
vi.mock('@/features/book/api/bookApi', async (importOriginal) =>
  (await import('./api-stubs')).withEmptyBook(await importOriginal()),
);
vi.mock('@/lib/api/summary', async (importOriginal) =>
  (await import('./api-stubs')).withNoSummary(await importOriginal()),
);

let seq = 0;
function row(title: string, overrides: Partial<LibraryPaper> = {}): LibraryPaper {
  seq += 1;
  return {
    paper_id: `ppr_${String(seq)}`,
    title,
    authors: ['Ada Author', 'Bo Writer', 'Cy Third'],
    original_filename: `${title}.pdf`,
    source_hash: 'sha256:00',
    page_count: 12,
    processing: 'ready',
    job: null,
    generation: 1,
    parser_version: '1.0.0',
    highlight_count: 0,
    created_at: `2026-10-0${String(seq % 9)}T10:00:00+00:00`,
    updated_at: '2026-10-15T10:00:00+00:00',
    reading: null,
    year: 2017,
    arxiv_id: null,
    arxiv_category: 'cs.CL',
    thread_count: 0,
    has_summary: false,
    topic: null,
    notebook_count: 0,
    plate: null,
    ...overrides,
  };
}

const ROWS = (): LibraryPaper[] => {
  seq = 0;
  return [
    row('Attention Is All You Need', {
      reading: {
        last_page: 3,
        furthest_page: 3,
        page_count: 12,
        opened_at: '2026-10-10T00:00:00Z',
        finished_at: null,
        state: 'reading',
      },
    }),
    row('FlashAttention: Fast and Memory-Efficient Exact Attention', { year: 2022 }),
    row('Deep Residual Learning for Image Recognition', { year: 2015 }),
    row('garbage', {
      processing: 'failed',
      page_count: null,
      year: null,
      job: {
        job_id: 'j',
        kind: 'parse',
        state: 'dead_letter',
        step: 'parse',
        done: 0,
        total: 3,
        attempt: 3,
        max_attempts: 3,
        error_code: 'pdf_unreadable',
      },
    }),
  ];
};

async function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  return screen.findByRole('toolbar', { name: 'Shelf' });
}

// The books only: the toolbar holds the spines, and (at scale) a row's "+n more" bookend.
const spineOrder = (shelf: HTMLElement) =>
  within(shelf)
    .getAllByRole('button')
    .filter((book) => book.dataset['paperId'] !== undefined)
    .map((book) => book.dataset['paperId']);

// The Table's rows, in order (#197).
const tableIds = (table: HTMLElement) =>
  [...table.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')].map((r) => r.dataset['rowId']);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  push.mockReset();
  window.localStorage.clear();
  api.list.mockResolvedValue(ROWS());
  useAuthStore.setState({
    user: { id: 'u', email: 'mrigesh@example.test' },
    isAuthenticated: true,
    isLoading: false,
    sessionUnverified: false,
    signedOutByUser: false,
  });
});
afterEach(cleanup);

describe('the header search', () => {
  it('"/" focuses it from anywhere but a field', async () => {
    await renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search);
  });

  it('"/" typed in another field stays there, and in the search it is just a character', async () => {
    await renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    const arrange = screen.getByRole('combobox', { name: 'Arrange by' });
    arrange.focus();
    expect(fireEvent.keyDown(arrange, { key: '/' })).toBe(true); // not prevented
    expect(document.activeElement).toBe(arrange);
    search.focus();
    expect(fireEvent.keyDown(search, { key: '/' })).toBe(true); // the "/" is typed, not eaten
    expect(document.activeElement).toBe(search);
  });

  it('Ctrl, Cmd or Alt with "/" is left to the browser', async () => {
    await renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    for (const chord of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(fireEvent.keyDown(document.body, { key: '/', ...chord })).toBe(true);
      expect(document.activeElement).not.toBe(search);
    }
  });

  it('lights the matches, dims the rest, counts "2 of 4", reorders nothing, and Esc clears', async () => {
    const shelf = await renderLibrary();
    const before = spineOrder(shelf);
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    fireEvent.change(search, { target: { value: 'atten' } });

    const count = document.getElementById(search.getAttribute('aria-describedby') ?? '');
    expect(count?.getAttribute('role')).toBe('status');
    expect(count?.textContent).toBe('2 of 4');
    expect(spineOrder(shelf)).toEqual(before);
    const lit = within(shelf)
      .getAllByRole('button')
      .filter((spine) => spine.dataset['match'] === 'true')
      .map((spine) => spine.dataset['paperId']);
    expect(lit).toEqual(['ppr_1', 'ppr_2']);
    expect(document.body.textContent).toContain('2 of 4 match “atten”');

    fireEvent.keyDown(search, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    expect(
      within(shelf)
        .getAllByRole('button')
        .every((s) => s.dataset['match'] === undefined),
    ).toBe(true);
  });

  it('Enter takes the first match off the shelf and opens it', async () => {
    await renderLibrary();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    fireEvent.change(search, { target: { value: 'residual' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    const book = await screen.findByRole('dialog', {
      name: 'Deep Residual Learning for Image Recognition',
    });
    expect(within(book).getByText('Not started')).toBeTruthy();
    expect(document.querySelector('[data-card-paper-id]')).toBeNull();
  });
});

describe('the paper tag on a hovered spine (V3-34)', () => {
  it('names the book over its spine with author, year, pages and state, and goes when the pointer leaves', async () => {
    const shelf = await renderLibrary();
    const spine = within(shelf).getByRole('button', { name: /^Attention Is All You Need/ });
    expect(document.querySelector('[data-spine-tag]')).toBeNull();
    fireEvent.mouseOver(spine);
    const tag = document.querySelector<HTMLElement>('[data-spine-tag]');
    expect(tag?.querySelector('b')?.textContent).toBe('Attention Is All You Need');
    expect(tag?.querySelector('span')?.textContent).toBe(
      'Author et al. · 2017 · 12 pages · reading now, p. 4 of 12',
    );
    // The eyes' copy only: the spine's own name already says it all.
    expect(tag?.getAttribute('aria-hidden')).toBe('true');
    // Moving from spine to spine replaces the tag; leaving the shelf removes it.
    const garbage = within(shelf).getByRole('button', { name: /^garbage/ });
    fireEvent.mouseOut(spine, { relatedTarget: garbage });
    fireEvent.mouseOver(garbage);
    expect(document.querySelector('[data-spine-tag]')?.textContent).toMatch(/^garbage/);
    fireEvent.mouseOut(garbage, { relatedTarget: document.body });
    expect(document.querySelector('[data-spine-tag]')).toBeNull();
  });
});

describe('the title block', () => {
  it('computes the stats line from the papers and says how many need a look', async () => {
    await renderLibrary();
    expect(screen.getByRole('heading', { level: 1, name: 'Your library' })).toBeTruthy();
    const stats = document.querySelector('.pt-libtitle__stats')?.textContent ?? '';
    expect(stats.replace(/\s+/g, ' ')).toBe('4 papers · 1 reading now · 36 pages');
    expect(stats).not.toMatch(/topic/);
  });

  it('"need a look" opens the Table filtered to the papers that need one, and back (#197)', async () => {
    await renderLibrary();
    const alert = screen.getByRole('button', { name: '1 need a look' });
    fireEvent.click(alert);
    expect(alert.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
    const table = screen.getByRole('table', { name: 'Papers that need a look' });
    expect(tableIds(table)).toEqual(['ppr_4']);
    fireEvent.click(alert);
    expect(tableIds(screen.getByRole('table', { name: 'Papers' }))).toHaveLength(4);
  });

  it('Arrange by Year regroups the shelf; every view is live', async () => {
    // Thirteen papers, so the shelf has its labelled rows.
    // The nine added are corpus papers, dated 2015 here so the row counts are easy to read.
    const more = corpusRows(13)
      .slice(4)
      .map((paper) => ({ ...paper, year: 2015 }));
    api.list.mockResolvedValue([...ROWS(), ...more]);
    await renderLibrary();
    fireEvent.change(screen.getByRole('combobox', { name: 'Arrange by' }), {
      target: { value: 'year' },
    });
    const groups = screen
      .getAllByRole('group', { name: /papers?$/ })
      .map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual([
      '2015, 10 papers',
      '2017, 1 paper',
      '2022, 1 paper',
      'Year unknown, 1 paper',
    ]);
    // Every view is live since #198; nothing says "Coming in this release" any more.
    expect(screen.queryByText('Coming in this release')).toBeNull();
    for (const live of ['Shelf', 'Topics', 'Map', 'Table']) {
      expect(screen.getByRole('button', { name: live }).getAttribute('aria-disabled')).toBeNull();
    }
  });
});

describe('Arrange by on the shelf', () => {
  it('orders the spines by year, oldest first, unknown last', async () => {
    const shelf = await renderLibrary();
    fireEvent.change(screen.getByRole('combobox', { name: 'Arrange by' }), {
      target: { value: 'year' },
    });
    expect(spineOrder(shelf)).toEqual(['ppr_3', 'ppr_1', 'ppr_2', 'ppr_4']);
  });
});

describe('the header menus', () => {
  it('Aa holds the theme switch; the account menu holds the email and Sign out', async () => {
    await renderLibrary();
    const aa = screen.getByRole('button', { name: 'Reading settings' });
    fireEvent.click(aa);
    expect(aa.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Colour scheme' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Colour scheme' }), { key: 'Escape' });
    expect(aa.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(aa);

    const account = screen.getByRole('button', { name: 'Account: mrigesh@example.test' });
    expect(account.textContent).toBe('M');
    fireEvent.click(account);
    const panel = screen.getByRole('group', { name: 'Account: mrigesh@example.test' });
    expect(within(panel).getByText('mrigesh@example.test')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('a menu closes when focus leaves it, and stays open for a press on its own panel', async () => {
    await renderLibrary();
    const aa = screen.getByRole('button', { name: 'Reading settings' });
    const account = screen.getByRole('button', { name: /^Account/ });
    fireEvent.click(aa);
    const scheme = screen.getByRole('radiogroup', { name: 'Colour scheme' });
    const radio = within(scheme).getAllByRole('radio')[0] as HTMLElement;
    // Focus moving inside the panel keeps it.
    fireEvent.focusOut(aa, { relatedTarget: radio });
    expect(aa.getAttribute('aria-expanded')).toBe('true');
    // A press on the panel's background sends focus to the page (no relatedTarget): still open.
    fireEvent.pointerDown(scheme);
    fireEvent.focusOut(radio, { relatedTarget: null });
    expect(aa.getAttribute('aria-expanded')).toBe('true');
    // Tab past the panel: focus lands outside, and the menu closes.
    fireEvent.focusOut(radio, { relatedTarget: account });
    expect(aa.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radiogroup', { name: 'Colour scheme' })).toBeNull();
  });
});

describe('drop PDFs anywhere', () => {
  it('a PDF dropped on the window goes up through the same upload path', async () => {
    await renderLibrary();
    const dropped = row('dropped', { paper_id: 'ppr_NEW', processing: 'queued' });
    api.uploadWithProgress.mockResolvedValue({
      paper_id: 'ppr_NEW',
      job_id: 'j',
      created: true,
      paper: dropped,
    });
    // The server lists it from now on, as the real one does after a 202.
    api.list.mockResolvedValue([...ROWS(), dropped]);
    const file = new File(['%PDF-1.4 x'], 'dropped.pdf', { type: 'application/pdf' });
    const transfer = { types: ['Files'], files: [file] };
    const drag = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      return event;
    };
    act(() => {
      window.dispatchEvent(drag('dragenter'));
    });
    expect(document.querySelector('[data-drop-anywhere]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(drag('drop'));
    });
    expect(document.querySelector('[data-drop-anywhere]')).toBeNull();
    await waitFor(() => expect(api.uploadWithProgress).toHaveBeenCalledTimes(1));
    expect((api.uploadWithProgress.mock.calls[0] as [File])[0].name).toBe('dropped.pdf');
    expect(
      await screen.findByRole('button', { name: /^dropped, .*waiting to be read$/ }),
    ).toBeTruthy();
  });
});

/** Every focusable thing in `root` that the browser would put in the tab order. */
const tabbable = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>('a[href], button, input, select')).filter(
    (el) => el.getAttribute('tabindex') !== '-1' && el.closest('[aria-hidden="true"]') === null,
  );

describe('no count the page does not have (review S1)', () => {
  it('prints no stats while loading, and none beside the load error', async () => {
    let fail: (error: Error) => void = () => undefined;
    api.list.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LibraryView />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: 'Your library' });
    expect(screen.getByRole('status', { name: 'Loading your papers' })).toBeTruthy();
    expect(document.querySelector('.pt-libtitle__stats')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0 papers\b/);

    // useLibrary retries once while online, so the retry must fail too.
    api.list.mockRejectedValue(new Error('boom'));
    act(() => fail(new Error('boom')));
    await screen.findByText(/Your papers could not be loaded/, undefined, { timeout: 5000 });
    expect(document.querySelector('.pt-libtitle__stats')).toBeNull();
    expect(screen.queryByRole('button', { name: /need a look/ })).toBeNull();
  });
});

describe('focus never falls to the page (review S4)', () => {
  it('after "Got it" it is on the shelf', async () => {
    const shelf = await renderLibrary();
    const gotIt = screen.getByRole('button', { name: 'Got it' });
    gotIt.focus();
    fireEvent.click(gotIt);
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    expect(document.activeElement).toBe(within(shelf).getByRole('button', { name: /^Attention/ }));
  });
});

describe('"need a look" ends when nothing does (review S5)', () => {
  it('a later upload does not switch the filter back on', async () => {
    api.remove.mockResolvedValue(undefined);
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: '1 need a look' }));
    const table = screen.getByRole('table', { name: 'Papers that need a look' });
    expect(tableIds(table)).toEqual(['ppr_4']);
    fireEvent.click(within(table).getByRole('button', { name: 'Remove garbage' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Delete paper' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /need a look/ })).toBeNull());

    const fresh = row('fresh', { paper_id: 'ppr_NEW', processing: 'queued' });
    api.uploadWithProgress.mockResolvedValue({
      paper_id: 'ppr_NEW',
      job_id: 'j',
      created: true,
      paper: fresh,
    });
    api.list.mockResolvedValue([...ROWS().slice(0, 3), fresh]);
    const input = document.querySelector<HTMLInputElement>('[data-add-papers] input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['%PDF'], 'fresh.pdf', { type: 'application/pdf' })] },
    });
    await waitFor(() => expect(document.querySelector('[data-row-id="ppr_NEW"]')).not.toBeNull());
    // The title's alert (the table's chip of the same name follows it).
    const [alert] = screen.getAllByRole('button', { name: '1 need a look' });
    expect(alert?.getAttribute('aria-pressed')).toBe('false');
    expect(tableIds(screen.getByRole('table', { name: 'Papers' }))).toHaveLength(4);
  });
});

describe('only a file drag lights the page (review S6)', () => {
  it('dragging text shows no drop overlay', async () => {
    await renderLibrary();
    const event = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(document.querySelector('[data-drop-anywhere]')).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('44 px targets on a phone (review S7)', () => {
  it('every control in the header, title row and hints declares 44 px when the pointer is coarse', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer: coarse'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      await renderLibrary();
      const chrome = [
        document.querySelector('.pt-libhead'),
        document.querySelector('.pt-libtitle'),
        document.querySelector('.pt-libviews'),
        document.querySelector('.pt-hints'),
      ];
      const controls = chrome.flatMap((part) => (part === null ? [] : tabbable(part)));
      expect(controls.length).toBeGreaterThan(10);
      for (const control of controls) {
        const declared = `${control.className} min-h:${control.style.minHeight}`;
        expect(declared, control.outerHTML.slice(0, 100)).toMatch(/min-w-\[44px\]/);
        expect(declared, control.outerHTML.slice(0, 100)).toMatch(/min-h-\[44px\]|min-h:44px/);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
