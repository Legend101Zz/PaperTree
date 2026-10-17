/**
 * The Table view's edges (#197, the S2f review): Retry in a row is one request however often it is
 * pressed, and a 409 "nothing to retry" is not an error; a row's "…" menu and the Filter close when
 * focus leaves them; the chips count what the search and the Filter leave; a poll re-draws only the
 * row whose paper changed; an empty table says what emptied it; a topic filter whose topic has left
 * clears itself; a row's menu is placed on the viewport, not inside the table's scroll region.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openedLabel } from '@/features/library/model/table';
import { ApiError } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';

import { openTable, renderLibrary, rowIds, rowOf, ROWS, row } from './library-table-cases';

// One router object, as Next's is: a new one per render would hand every row a new onRead.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
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

// `openedLabel` runs once per drawn row (its Last opened cell), so its calls count row renders.
vi.mock('@/features/library/model/table', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/library/model/table')>();
  return { ...actual, openedLabel: vi.fn(actual.openedLabel) };
});

const chipNames = () =>
  within(screen.getByRole('group', { name: 'Show papers' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem('papertree/library/shelf-hints', 'shown');
  api.list.mockResolvedValue(ROWS());
  useAuthStore.setState({
    user: { id: 'u', email: 'mrigesh@example.test' },
    isAuthenticated: true,
    isLoading: false,
    sessionUnverified: false,
    signedOutByUser: false,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Retry in a row', () => {
  it('a double press sends one request; both Retry buttons say busy until it settles', async () => {
    let settle: (value: unknown) => void = () => undefined;
    api.retry.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const table = await openTable();
    const failed = rowOf(table, 'ppr_4');
    const retry = within(failed).getByRole('button', { name: 'Retry reading garbage' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(api.retry).toHaveBeenCalledTimes(1);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(failed).getByRole('button', { name: /^More actions/ }));
    const menuRetry = within(within(table).getByRole('group', { name: 'garbage' })).getByRole(
      'button',
      { name: 'Retry' },
    );
    expect(menuRetry.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(menuRetry);
    expect(api.retry).toHaveBeenCalledTimes(1);
    await act(async () => settle({ job_id: 'j', generation: 2 }));
    expect(retry.getAttribute('aria-disabled')).toBeNull();
  });

  it('a 409 "nothing to retry" shows no error; the list is asked again', async () => {
    api.retry.mockRejectedValue(
      new ApiError(
        409,
        'not_failed',
        "the paper's latest parse has not failed; nothing to retry",
        false,
      ),
    );
    const table = await openTable();
    const asked = api.list.mock.calls.length;
    fireEvent.click(within(rowOf(table, 'ppr_4')).getByRole('button', { name: /^Retry/ }));
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(asked));
    expect(within(table).queryByRole('alert')).toBeNull();
    expect(table.textContent).not.toMatch(/nothing to retry/);
  });
});

describe('menus close when focus leaves them', () => {
  it('a row’s "…" menu: Tab past it onto the next row closes it', async () => {
    const table = await openTable();
    const more = within(rowOf(table, 'ppr_1')).getByRole('button', { name: /^More actions/ });
    fireEvent.click(more);
    const open = within(table).getByRole('link', { name: 'Open' });
    expect(document.activeElement).toBe(open);
    const next = within(rowOf(table, 'ppr_2')).getByRole('link', { name: /^FlashAttention/ });
    fireEvent.focusOut(open, { relatedTarget: next });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(within(table).queryByRole('group', { name: /^Attention/ })).toBeNull();
  });

  it('the Filter menu closes when focus moves to the table', async () => {
    const table = await openTable();
    const button = screen.getByRole('button', { name: 'Filter: topic, year, pages' });
    fireEvent.click(button);
    const topic = screen.getByRole('combobox', { name: 'Topic' });
    fireEvent.focusOut(topic, {
      relatedTarget: within(rowOf(table, 'ppr_1')).getByRole('link', { name: /^Attention/ }),
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a row’s menu is placed on the viewport, so a scrolling table cannot clip it', async () => {
    const table = await openTable();
    fireEvent.click(within(rowOf(table, 'ppr_4')).getByRole('button', { name: /^More actions/ }));
    expect(within(table).getByRole('group', { name: 'garbage' }).style.position).toBe('fixed');
  });
});

describe('the chips count what the search and the Filter leave', () => {
  it('a search: each chip’s number is the rows it shows', async () => {
    const table = await openTable();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'atten' } });
    expect(chipNames()).toEqual(['All2', 'Reading now1', 'Read0', 'Not started1']);
    fireEvent.click(screen.getByRole('button', { name: /^Not started/ }));
    expect(rowIds(table)).toEqual(['ppr_2']);
  });

  it('the Filter too; the title’s "need a look" still counts the whole library', async () => {
    await openTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filter: topic, year, pages' }));
    fireEvent.change(
      within(screen.getByRole('group', { name: 'Year' })).getByRole('spinbutton', {
        name: 'From',
      }),
      { target: { value: '2017' } },
    );
    expect(chipNames()).toEqual(['All2', 'Reading now1', 'Read0', 'Not started1']);
    expect(screen.getByRole('button', { name: '1 need a look' })).toBeTruthy();
  });
});

describe('a poll', () => {
  it('re-draws only the row whose paper changed', async () => {
    const client = await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Papers' });
    const draws = vi.mocked(openedLabel);
    draws.mockClear();
    // A fresh answer, as the network gives: new objects, one paper changed.
    api.list.mockResolvedValue(
      ROWS().map((r) => (r.paper_id === 'ppr_3' ? { ...r, highlight_count: 2 } : r)),
    );
    await act(() => client.refetchQueries({ queryKey: ['papers'] }));
    await waitFor(() => expect(rowOf(table, 'ppr_3').textContent).toContain('2'));
    expect(draws).toHaveBeenCalledTimes(1);
  });
});

describe('what an empty table says', () => {
  it('names the chip when only the chip emptied it, and the search when the search did', async () => {
    const table = await openTable();
    fireEvent.click(screen.getByRole('button', { name: /^Read\s?0/ }));
    expect(table.textContent).toContain('Nothing here is Read yet.');
    expect(table.textContent).not.toContain('Clear the search');
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } });
    expect(table.textContent).toContain('No papers match the search. Clear it to see them all.');
  });
});

describe('a topic filter whose topic has left the library', () => {
  it('clears itself: every row comes back and the Filter button says nothing is on', async () => {
    const client = await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.click(screen.getByRole('button', { name: 'Filter: topic, year, pages' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Topic' }), {
      target: { value: 'top_t' },
    });
    expect(rowIds(screen.getByRole('table', { name: 'Papers' }))).toEqual(['ppr_1', 'ppr_2']);
    // Both of its papers are gone (removed elsewhere); a new one has no topic.
    api.list.mockResolvedValue([
      ...ROWS().filter((r) => r.topic === null),
      row('ppr_5', 'Mask R-CNN', { year: 2017 }),
    ]);
    await act(() => client.refetchQueries({ queryKey: ['papers'] }));
    await waitFor(() =>
      expect(rowIds(screen.getByRole('table', { name: 'Papers' }))).toEqual([
        'ppr_3',
        'ppr_4',
        'ppr_5',
      ]),
    );
    expect(screen.getByRole('button', { name: 'Filter: topic, year, pages' })).toBeTruthy();
  });
});
