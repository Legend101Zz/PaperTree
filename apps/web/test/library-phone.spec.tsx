/**
 * The phone library at 390 px (#199, frame 08a): the stacked order (search, title and stats, the
 * view tabs, Reading now, the flat stacks), Reading now on a short library too, the flat books with
 * their names, one tab stop and ↑/↓, the card as a bottom sheet with Put it back, the tabs, the Map's
 * list first, and axe. The width comes from a `matchMedia` stub that answers the 900 px phone query;
 * pixel sizes are read from `phone.css` itself, which jsdom does not lay out. Titles are the corpus
 * papers' own (`library-corpus.ts`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '@/features/library';
import type { LibraryPaper } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';

import { corpusRows, readingAt } from './library-corpus';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));
const papersApi = vi.hoisted(() => ({
  list: vi.fn(),
  links: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  uploadWithProgress: vi.fn(),
  putReadingState: vi.fn(),
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

const PHONE_CSS = readFileSync(
  resolve(process.cwd(), 'src/features/library/components/phone.css'),
  'utf8',
);

const on = (id: string, name: string, cloth: 'transformers' | 'vision') => ({
  topic_id: id,
  name,
  cloth,
  source: 'manual' as const,
  source_detail: null,
});
const T = on('top_t', 'Transformers & attention', 'transformers');
const V = on('top_v', 'Vision & detection', 'vision');

/** Six corpus papers on two topics and Unshelved; two in progress, one being read, one failed. */
function phoneLibrary(): LibraryPaper[] {
  const [att, flash, ddpm, resnet, yolo, mask] = corpusRows(6) as [
    LibraryPaper,
    LibraryPaper,
    LibraryPaper,
    LibraryPaper,
    LibraryPaper,
    LibraryPaper,
  ];
  return [
    { ...att, topic: T, reading: readingAt(3, 15, '2026-10-14T09:00:00Z') },
    { ...flash, topic: T, processing: 'reading' },
    { ...ddpm, reading: readingAt(8, 25, '2026-10-15T09:00:00Z') },
    { ...resnet, topic: V },
    { ...yolo, topic: V },
    { ...mask, topic: V, processing: 'failed', page_count: null },
  ];
}

async function renderPhone(rows: LibraryPaper[] = phoneLibrary()) {
  papersApi.list.mockResolvedValue(rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByRole('status', { name: 'Loading your papers' })).toBeNull(),
  );
  return view;
}

const shelf = () => screen.getByRole('toolbar', { name: 'Shelf' });
const books = () =>
  within(shelf())
    .getAllByRole('button')
    .filter((b) => b.dataset['paperId'] !== undefined);
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const at = PHONE_CSS.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`${selector} is not in phone.css`);
  return PHONE_CSS.slice(at, PHONE_CSS.indexOf('}', at));
}

beforeEach(() => {
  for (const fn of [...Object.values(papersApi), ...Object.values(topicsApi)]) fn.mockReset();
  push.mockReset();
  papersApi.links.mockResolvedValue({ links: [] });
  topicsApi.list.mockResolvedValue([]);
  window.localStorage.clear();
  // A 390 px phone: the 900 px phone query (and the touch query, which includes it) match.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 900px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
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
  vi.unstubAllGlobals();
});

describe('the phone library at 390', () => {
  it('stacks search, the title and stats, the tabs, Reading now, then the flat stacks', async () => {
    await renderPhone();
    const order = [
      screen.getByRole('searchbox', { name: 'Search the library' }),
      screen.getByRole('heading', { level: 1, name: 'Your library' }),
      screen.getByRole('group', { name: 'View' }),
      screen.getByRole('region', { name: 'Reading now' }),
      shelf(),
    ];
    for (let i = 1; i < order.length; i += 1) expect(before(order[i - 1]!, order[i]!)).toBe(true);
    expect(shelf().getAttribute('aria-orientation')).toBe('vertical');
    expect(document.querySelectorAll('.pt-spine, .pt-cover')).toHaveLength(0);
    // The four views across the screen, each a 44 px touch target.
    const tabs = within(screen.getByRole('group', { name: 'View' })).getAllByRole('button');
    expect(tabs.map((t) => t.textContent)).toEqual(['Shelf', 'Topics', 'Map', 'Table']);
    for (const tab of tabs) expect(tab.style.minHeight).toBe('44px');
  });

  it('shows Reading now even for a short library, and Continue opens the reader there', async () => {
    await renderPhone();
    const strip = screen.getByRole('region', { name: 'Reading now' });
    const rows = within(strip).getAllByRole('listitem');
    // Six papers would stand face-out on a desktop, with no strip; flat books carry no Continue.
    expect(rows.map((r) => r.dataset['readingPaperId'])).toEqual(['ppr_c2', 'ppr_c0']);
    expect(rows[1]?.textContent).toContain('p. 4 of 15');
    const go = within(strip).getByRole('button', {
      name: 'Continue reading Attention Is All You Need',
    });
    expect(go.style.minHeight).toBe('44px');
    fireEvent.click(go);
    expect(push).toHaveBeenCalledWith('/paper/ppr_c0/read');
    expect(JSON.parse(window.localStorage.getItem('papertree/reader/ppr_c0') ?? '')).toMatchObject({
      page: 3,
    });
  });

  it('lays the books flat, a stack per topic under its holder, each named like its spine', async () => {
    await renderPhone();
    const stacks = within(shelf()).getAllByRole('group');
    expect(stacks.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Transformers & attention, 2 papers',
      'Vision & detection, 3 papers',
      'Unshelved, 1 paper',
    ]);
    const att = within(stacks[0]!).getByRole('button', { name: /^Attention Is All You Need/ });
    expect(att.getAttribute('aria-label')).toBe(
      'Attention Is All You Need, Vaswani and Shazeer, 2017, reading now, p. 4 of 15',
    );
    expect(att.textContent).toBe('Attention Is All You Need2017');
    expect(att.querySelector('.pt-flatbook__ribbon')).not.toBeNull();
    expect(att.style.getPropertyValue('--pt-flat-short')).toBe('67px');
    const flash = within(stacks[0]!).getByRole('button', { name: /being read$/ });
    expect(flash.classList).toContain('pt-flatbook--kraft');
    expect(flash.textContent).toBe('FlashAttentionbeing read');
    const mask = within(stacks[1]!).getByRole('button', { name: /could not read$/ });
    expect(mask.classList).toContain('pt-flatbook--torn');
    // Every book is a 44 px target, however short its title (DESIGN.md §10).
    expect(rule('.pt-flatbook')).toContain('min-block-size: 44px');
    expect(rule('.pt-flatbook__inner')).toContain('min-block-size: 44px');
  });

  it('keeps the gilt inside the spine light budget, which library-gilt.spec.ts holds to 4.5:1', () => {
    const shading = rule('.pt-flatbook');
    expect(shading).toContain('rgb(255 255 255 / var(--pt-spine-sheen-peak))');
    expect(shading).toContain('rgb(255 255 255 / var(--pt-spine-weave-light))');
    expect(shading).not.toMatch(/rgb\(255 255 255 \/ \d/);
  });

  it('is one tab stop: ↓ and ↑ walk down the stacks and into the next, End jumps', async () => {
    await renderPhone();
    const all = books();
    expect(all.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    all[0]!.focus();
    fireEvent.keyDown(all[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(all[1]!, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Deep Residual/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(all[1]!, { key: 'End' });
    expect(document.activeElement).toBe(all[all.length - 1]);
    expect(books().filter((b) => b.tabIndex === 0)).toEqual([all[all.length - 1]]);
  });

  it('opens a book as a bottom sheet with Read focused; Put it back returns to the book', async () => {
    await renderPhone();
    const resnet = within(shelf()).getByRole('button', { name: /^Deep Residual/ });
    fireEvent.click(resnet);
    const sheet = document.querySelector<HTMLElement>('[data-card-paper-id="ppr_c3"]')!;
    expect(sheet.classList).toContain('pt-catalogue--sheet');
    expect(sheet.style.marginInlineStart).toBe('');
    expect(sheet.querySelector('.pt-catalogue__pointer')).toBeNull();
    expect(resnet.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: /^Read/ }));
    const back = within(sheet).getByRole('button', { name: 'Put it back' });
    expect(back.style.minHeight).toBe('44px');
    fireEvent.click(back);
    expect(document.querySelector('[data-card-paper-id]')).toBeNull();
    expect(document.activeElement).toBe(resnet);
    // Esc puts it back too, for a keyboard at phone width.
    fireEvent.click(resnet);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.querySelector('[data-card-paper-id]')).toBeNull();
  });

  it('lets "/" type into the search on a phone, and still focuses it from the page', async () => {
    await renderPhone();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false);
    expect(document.activeElement).toBe(search);
    // Typing "/" in the field (a URL fragment, "and/or") is the person's, not the shortcut's.
    expect(fireEvent.keyDown(search, { key: '/' })).toBe(true);
  });

  it('switches views from the tabs; the Map puts its list first, open', async () => {
    topicsApi.list.mockResolvedValue([]);
    await renderPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    const map = await screen.findByRole('region', { name: 'Plan of the reading room' });
    const list = await within(map).findByText('The plan as a list');
    const details = list.closest('details')!;
    expect(details.open).toBe(true);
    const host = map.querySelector('.pt-map__host')!;
    expect(before(details, host)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect((await screen.findByRole('table', { name: 'Papers' })).tagName).toBe('TABLE');
  });

  it('has no axe violations with a book taken down', async () => {
    const { container } = await renderPhone();
    fireEvent.click(within(shelf()).getByRole('button', { name: /^Deep Residual/ }));
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
