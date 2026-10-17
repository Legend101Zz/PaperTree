/**
 * The library's Table view (#197, frame 01d), through the whole page: headers sort with aria-sort
 * (a second press reverses), the chips filter and count, the authors popover lists every name,
 * Retry and Remove appear only where they are valid (Remove confirmed in the row, focus kept),
 * "need a look" opens the Table filtered, switching views keeps the search and the shelf's focus,
 * "Show on the shelf" focuses the spine, Columns is remembered per viewer, Filter narrows by year,
 * and axe finds nothing at WCAG 2.2 AA (contrast and target size need a browser: see a11y.spec).
 */
import axe from 'axe-core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COLUMNS_KEY } from '@/features/library/hooks/useTableView';
import { useAuthStore } from '@/store/authStore';

import {
  header,
  openTable,
  renderLibrary,
  rowIds,
  rowOf,
  ROWS,
  VASWANI,
} from './library-table-cases';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  vi.restoreAllMocks();
});

describe('the Table view (#197)', () => {
  it('lists every paper with its cells, sorted by topic then title, the topic header marked', async () => {
    const table = await openTable();
    expect(rowIds(table)).toEqual(['ppr_1', 'ppr_2', 'ppr_3', 'ppr_4']);
    expect(header(table, 'Topic').getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByText('Sorted by topic, then title')).toBeTruthy();
    const attention = rowOf(table, 'ppr_1');
    expect(attention.textContent).toContain('arXiv cs.CL · accepted');
    expect(attention.textContent).toContain('Reading now');
    expect(attention.textContent).toContain('p. 4 of 15');
    expect(attention.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-16T10:00:00Z');
    // Nothing invented: no year, no pages, never opened, no topic.
    const garbage = rowOf(table, 'ppr_4').textContent ?? '';
    expect(garbage).toContain('Unshelved');
    expect(garbage).toContain('unknown');
    expect(garbage).toContain('never');
    expect(within(rowOf(table, 'ppr_1')).getByRole('link', { name: /^Attention/ })).toBeTruthy();
  });

  it('headers sort with aria-sort, and a second press reverses', async () => {
    const table = await openTable();
    fireEvent.click(within(header(table, 'Year')).getByRole('button'));
    expect(header(table, 'Year').getAttribute('aria-sort')).toBe('ascending');
    expect(header(table, 'Topic').getAttribute('aria-sort')).toBeNull();
    expect(rowIds(table)).toEqual(['ppr_3', 'ppr_1', 'ppr_2', 'ppr_4']);
    fireEvent.click(within(header(table, 'Year')).getByRole('button'));
    expect(header(table, 'Year').getAttribute('aria-sort')).toBe('descending');
    // The paper with no year stays last both ways.
    expect(rowIds(table)).toEqual(['ppr_2', 'ppr_1', 'ppr_3', 'ppr_4']);
  });

  it('the chips count from data and filter', async () => {
    const table = await openTable();
    const chips = screen.getByRole('group', { name: 'Show papers' });
    const names = within(chips)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['All4', 'Reading now1', 'Read0', 'Not started2', '1 need a look']);
    fireEvent.click(within(chips).getByRole('button', { name: /^Not started/ }));
    expect(
      within(chips)
        .getByRole('button', { name: /^Not started/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(rowIds(table)).toEqual(['ppr_2', 'ppr_3']);
  });

  it('the authors popover lists every author, and Esc closes it onto its button', async () => {
    const table = await openTable();
    const more = within(rowOf(table, 'ppr_1')).getByRole('button', {
      name: /^Ashish Vaswani et al/,
    });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    const list = within(table).getByRole('group', { name: 'Authors' });
    expect(list.textContent).toContain(VASWANI.join(', '));
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(within(table).queryByRole('group', { name: 'Authors' })).toBeNull();
    expect(document.activeElement).toBe(more);
    // One author is printed whole: nothing to open.
    expect(within(rowOf(table, 'ppr_2')).queryByRole('button', { name: /^Tri Dao/ })).toBeNull();
  });

  it('offers Retry and Remove only where they are valid', async () => {
    api.retry.mockResolvedValue({ job_id: 'j', generation: 2 });
    const table = await openTable();
    const failed = rowOf(table, 'ppr_4');
    expect(within(failed).getByText('Could not read')).toBeTruthy();
    expect(within(rowOf(table, 'ppr_3')).queryByRole('button', { name: /^Retry/ })).toBeNull();

    fireEvent.click(within(rowOf(table, 'ppr_3')).getByRole('button', { name: /^More actions/ }));
    const menu = within(table).getByRole('group', { name: /^Deep Residual/ });
    const items = [...menu.querySelectorAll('[data-row-menu-item]')].map((i) => i.textContent);
    expect(items).toEqual(['Open', 'Remove', 'Show on the shelf']);
    expect(document.activeElement?.textContent).toBe('Open');
    fireEvent.keyDown(menu, { key: 'Escape' });

    fireEvent.click(within(failed).getByRole('button', { name: /^More actions/ }));
    expect(within(table).getByRole('group', { name: 'garbage' }).textContent).toContain('Retry');
    fireEvent.keyDown(within(table).getByRole('group', { name: 'garbage' }), { key: 'Escape' });

    fireEvent.click(within(failed).getByRole('button', { name: 'Retry reading garbage' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('ppr_4'));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(failed).getByRole('link', { name: 'garbage' })),
    );
  });

  it('Remove is confirmed in the row, then focus goes to the next row', async () => {
    api.remove.mockResolvedValue(undefined);
    const table = await openTable();
    fireEvent.click(within(rowOf(table, 'ppr_2')).getByRole('button', { name: /^More actions/ }));
    fireEvent.click(within(table).getByRole('button', { name: 'Remove' }));
    const confirm = within(table).getByRole('group', { name: /^Confirm deleting FlashAttention/ });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete paper' }));
    await waitFor(() => expect(rowIds(table)).toEqual(['ppr_1', 'ppr_3', 'ppr_4']));
    expect(api.remove).toHaveBeenCalledWith('ppr_2');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(rowOf(table, 'ppr_3')).getByRole('link', { name: /^Deep Residual/ }),
      ),
    );
  });

  it('"need a look" opens the Table filtered, says why, and its chip clears it', async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: '1 need a look' }));
    const table = screen.getByRole('table', { name: 'Papers that need a look' });
    expect(rowIds(table)).toEqual(['ppr_4']);
    expect(screen.getByText('garbage could not be read.')).toBeTruthy();
    const chips = screen.getByRole('group', { name: 'Show papers' });
    // Frame 01d's second state: All and the pressed chip only.
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All4', '1 need a look']);
    fireEvent.click(within(chips).getByRole('button', { name: '1 need a look' }));
    expect(rowIds(screen.getByRole('table', { name: 'Papers' }))).toHaveLength(4);
  });

  it('switching views keeps the search and the shelf’s focus; the search filters the table', async () => {
    await renderLibrary();
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    const resnet = within(shelf).getByRole('button', { name: /^Deep Residual/ });
    resnet.focus();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'atten' } });
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(rowIds(screen.getByRole('table', { name: 'Papers' }))).toEqual(['ppr_1', 'ppr_2']);
    fireEvent.click(screen.getByRole('button', { name: 'Shelf' }));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('atten');
    expect(within(shelf).getByRole('button', { name: /^Deep Residual/ }).tabIndex).toBe(0);
  });

  it('"Show on the shelf" switches to the shelf with that book focused', async () => {
    const table = await openTable();
    fireEvent.click(within(rowOf(table, 'ppr_2')).getByRole('button', { name: /^More actions/ }));
    fireEvent.click(within(table).getByRole('button', { name: 'Show on the shelf' }));
    expect(screen.queryByRole('table')).toBeNull();
    const shelf = screen.getByRole('toolbar', { name: 'Shelf' });
    expect(document.activeElement).toBe(
      within(shelf).getByRole('button', { name: /^FlashAttention/ }),
    );
  });

  it('Columns hides a column for this viewer, and a storage that throws is not fatal', async () => {
    const table = await openTable();
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Year' }));
    expect(within(table).queryByRole('columnheader', { name: /^Year/ })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? '[]')).toEqual(['year']);
    cleanup();

    const again = await openTable();
    expect(within(again).queryByRole('columnheader', { name: /^Year/ })).toBeNull();
    cleanup();

    // Storage still holds ["year"]: a Year column here proves the read really threw.
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const blocked = await openTable();
    expect(within(blocked).getByRole('columnheader', { name: /^Year/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pages' }));
    expect(within(blocked).queryByRole('columnheader', { name: /^Pages/ })).toBeNull();
  });

  it('Filter narrows by a year range and says so on its button', async () => {
    const table = await openTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filter: topic, year, pages' }));
    const year = screen.getByRole('group', { name: 'Year' });
    fireEvent.change(within(year).getByRole('spinbutton', { name: 'From' }), {
      target: { value: '2017' },
    });
    expect(rowIds(table)).toEqual(['ppr_1', 'ppr_2']);
    expect(screen.getByRole('button', { name: 'Filter: from 2017' })).toBeTruthy();
  });

  it('has no axe violations at WCAG 2.2 AA, with a row menu open', async () => {
    const table = await openTable();
    fireEvent.click(within(rowOf(table, 'ppr_4')).getByRole('button', { name: /^More actions/ }));
    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`)).toEqual([]);
    expect(results.passes.map((p) => p.id)).toEqual(
      expect.arrayContaining(['button-name', 'th-has-data-cells']),
    );
  });
});
