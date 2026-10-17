/**
 * The phone library at 390 px (#199, frame 08a): the stacked order (search, title and stats, the
 * view tabs, Reading now, the flat stacks), Reading now on a short library too, the flat books with
 * their names, one tab stop and ↑/↓, the card as a modal bottom sheet with Put it back, the tabs,
 * the Map's list first, no key hint on touch, and axe; then crossing 900 px with a card open or with
 * focus in the Map's list (review SF1, SF4); and S3's book on a phone: Enter, Space and a tap open
 * the sheet (no pull-out), whose "Open the book" opens the spread. The width comes from a `matchMedia` stub that answers
 * the 900 px phone query and can change; pixel sizes are read from the stylesheets, which jsdom does
 * not lay out. Titles are the corpus papers' own (`library-corpus.ts`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '@/features/library';
import { PHONE_MAX_WIDTH } from '@/features/library/model/phone';
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
const auth = vi.hoisted(() => ({ me: vi.fn() }));
vi.mock('@/lib/api/papers', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api/papers')>();
  return { ...real, papersApi, authApi: { ...real.authApi, ...auth } };
});
// The opened book's reads (S3, #200): no figures, no abstract, no summary for these rows.
const bookApi = vi.hoisted(() => ({
  figures: vi.fn(),
  abstract: vi.fn(),
  setPlate: vi.fn(),
  clearPlate: vi.fn(),
}));
vi.mock('@/features/book/api/bookApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/book/api/bookApi')>()),
  bookApi,
}));
const summaryApi = vi.hoisted(() => ({ get: vi.fn(), generate: vi.fn() }));
vi.mock('@/lib/api/summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/summary')>()),
  summaryApi,
}));
vi.mock('@/lib/api/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/topics')>()),
  topicsApi,
}));

const css = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/features/library/components', name), 'utf8');
const PHONE_CSS = css('phone.css');

/** The width the `matchMedia` stub answers for; `resizeTo` changes it and tells the listeners. */
let wide = false;
const listeners = new Set<() => void>();
function resizeTo(width: 'phone' | 'desktop'): void {
  wide = width === 'desktop';
  act(() => {
    for (const listener of listeners) listener();
  });
}

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
  auth.me.mockResolvedValue({
    user_id: 'usr_1',
    email: 'mrigesh@example.test',
    display_name: null,
  });
  bookApi.figures.mockResolvedValue([]);
  bookApi.abstract.mockResolvedValue({ text: null, page_index: null, anchor: null });
  summaryApi.get.mockResolvedValue({ state: 'none', summary: null });
  // The book's motion is WAAPI; here every animation has already finished.
  (Element.prototype as unknown as { animate: unknown }).animate = () => ({
    finished: Promise.resolve(),
    cancel: () => undefined,
  });
  window.localStorage.clear();
  // A 390 px phone: the 900 px phone query (and the touch query, which includes it) match.
  wide = false;
  listeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return !wide && query.includes('max-width: 900px');
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
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
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
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

  it('opens a book as a modal bottom sheet: Read focused, the rest inert, Tab kept inside', async () => {
    await renderPhone();
    const resnet = within(shelf()).getByRole('button', { name: /^Deep Residual/ });
    fireEvent.click(resnet);
    const sheet = screen.getByRole('dialog', { name: /^Deep Residual/ });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.classList).toContain('pt-catalogue--sheet');
    expect(sheet.style.marginInlineStart).toBe('');
    expect(sheet.querySelector('.pt-catalogue__pointer')).toBeNull();
    expect(resnet.getAttribute('aria-expanded')).toBe('true');
    const read = within(sheet).getByRole('button', { name: /^Read/ });
    expect(document.activeElement).toBe(read);
    // No book can take focus behind the sheet (review SF2): the stacks, the header and the rest
    // of the page are inert; the sheet and its scrim are not.
    for (const behind of [
      shelf(),
      screen.getByRole('searchbox'),
      screen.getByRole('heading', { level: 1 }),
    ]) {
      expect(behind.closest('[inert]')).not.toBeNull();
    }
    expect(sheet.closest('[inert]')).toBeNull();
    expect(document.querySelector('.pt-catalogue__scrim')?.closest('[inert]')).toBeNull();
    // The arrows are not the shelf's in here, and Tab wraps at both ends.
    fireEvent.keyDown(read, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(read);
    const back = within(sheet).getByRole('button', { name: 'Put it back' });
    expect(back.style.minHeight).toBe('44px');
    back.focus();
    fireEvent.keyDown(back, { key: 'Tab' });
    expect(document.activeElement).toBe(read);
    fireEvent.keyDown(read, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(back);
  });

  it('puts the book back by Put it back, Esc or the scrim, lifting the inert first', async () => {
    await renderPhone();
    const resnet = within(shelf()).getByRole('button', { name: /^Deep Residual/ });
    const closers: ((sheet: HTMLElement) => void)[] = [
      (sheet) => fireEvent.click(within(sheet).getByRole('button', { name: 'Put it back' })),
      (sheet) =>
        fireEvent.keyDown(within(sheet).getByRole('button', { name: /^Read/ }), { key: 'Escape' }),
      () => fireEvent.pointerUp(document.querySelector('.pt-catalogue__scrim')!),
    ];
    for (const close of closers) {
      fireEvent.click(resnet);
      close(screen.getByRole('dialog'));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.querySelector('[inert]')).toBeNull();
      expect(document.activeElement).toBe(resnet);
    }
  });

  it('after a Delete from the sheet, focus goes to the next book, out of the inert', async () => {
    papersApi.remove.mockResolvedValue(undefined);
    await renderPhone();
    fireEvent.click(within(shelf()).getByRole('button', { name: /^Deep Residual/ }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /^Delete/ }));
    papersApi.list.mockResolvedValue(phoneLibrary().filter((row) => row.paper_id !== 'ppr_c3'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete paper' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^You Only Look Once/),
    );
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('lets "/" type into the search on a phone, and still focuses it from the page', async () => {
    await renderPhone();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false);
    expect(document.activeElement).toBe(search);
    // Typing "/" in the field (a URL fragment, "and/or") is the person's, not the shortcut's.
    expect(fireEvent.keyDown(search, { key: '/' })).toBe(true);
  });

  it('switches views from the tabs; the Map opens its list, which phone.css puts first', async () => {
    await renderPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    const map = await screen.findByRole('region', { name: 'Plan of the reading room' });
    const list = await within(map).findByText('The plan as a list');
    expect(list.closest('details')?.open).toBe(true);
    // One element at every width; the phone moves the plan after it (a flex order, no remount).
    expect(PHONE_CSS).toMatch(/\.pt-map \.pt-map__host \{\s*order: 1;/);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect((await screen.findByRole('table', { name: 'Papers' })).tagName).toBe('TABLE');
  });

  it('opens the sheet on Enter, Space or a tap, never the pull-out; "Open the book" opens the spread', async () => {
    await renderPhone();
    const resnet = within(shelf()).getByRole('button', { name: /^Deep Residual/ });
    resnet.focus();
    // Not cancelled, so the browser turns each into the click that takes the book down (#199).
    expect(fireEvent.keyDown(resnet, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(resnet, { key: ' ' })).toBe(true);
    expect(resnet.getAttribute('data-pulled')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(resnet);
    const sheet = screen.getByRole('dialog', { name: /^Deep Residual/ });
    const open = within(sheet).getByRole('button', { name: /^Open the book/ });
    expect(open.style.minHeight).toBe('44px');
    fireEvent.click(open);
    // The sheet goes first: one modal at a time, and the spread is the one now.
    expect(sheet.isConnected).toBe(false);
    const spread = await screen.findByRole('dialog', { name: /^Deep Residual/ });
    expect(spread.closest('[inert]')).toBeNull();
    expect(shelf().closest('[inert]')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? spread, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(resnet));
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('says Enter takes a book down on the stacks, with no Space line (no pull-out there)', async () => {
    await renderPhone();
    const hints = document.querySelector<HTMLElement>('.pt-hints')!;
    expect(hints.textContent).toContain('↑↓ along the shelf');
    expect(hints.textContent).toContain('Enter take it down');
    expect(hints.textContent).not.toContain('Space');
    expect(hints.textContent).not.toContain('take it out');
  });

  it('draws × to clear the search on a phone, never the "Esc" key (review SF5)', async () => {
    await renderPhone();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'atten' } });
    const clear = screen.getByRole('button', { name: 'Clear the search' });
    expect(clear.querySelector('kbd')).toBeNull();
    expect(clear.querySelector('svg')).not.toBeNull();
    expect(document.querySelectorAll('.pt-search kbd')).toHaveLength(0);
  });

  it('keeps every phone rule on the 900 px breakpoint, and the 44 px Map and Topics rules there', () => {
    const widths = [...PHONE_CSS.matchAll(/max-width: (\d+)px/g)].map((m) => Number(m[1]));
    // 560 px is the one narrower step: the tabs drop their icons (S2e's Add papers label too).
    expect(new Set(widths)).toEqual(new Set([PHONE_MAX_WIDTH, 560]));
    // Review SF3: 44 px across the whole phone range and on any touch screen, not only under 720.
    const touch = `@media (max-width: ${String(PHONE_MAX_WIDTH)}px), (pointer: coarse) {`;
    expect(css('map.css').split(touch)[1]).toMatch(
      /^\s*\.pt-map__list summary \{\s*min-block-size: 44px;/,
    );
    expect(css('topics.css').split(touch)[1]).toMatch(
      /^\s*\.pt-topicmenu \.pt-hmenu__button \{\s*inline-size: 44px;\s*block-size: 44px;/,
    );
  });

  it('re-points an open card at its book after crossing 900 px both ways (review SF1)', async () => {
    // jsdom lays nothing out: covers stand 100 px apart from x = 200, a flat book starts at 16.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const id = this.getAttribute('data-paper-id');
      const left = this.classList.contains('pt-cover')
        ? 200 + 100 * Number(id?.replace('ppr_c', ''))
        : this.classList.contains('pt-flatbook')
          ? 16
          : 0;
      const width = this.classList.contains('pt-shelfband__band') ? 1000 : 60;
      return {
        left,
        width,
        top: 0,
        height: 44,
        right: left + width,
        bottom: 44,
        x: left,
        y: 0,
      } as DOMRect;
    });
    wide = true;
    await renderPhone();
    fireEvent.click(document.querySelector<HTMLElement>('button[data-paper-id="ppr_c3"]')!);
    const card = () => document.querySelector<HTMLElement>('[data-card-paper-id="ppr_c3"]')!;
    // The cover's centre is 530: the card stands 42 px left of it (placeCard).
    expect(card().style.marginInlineStart).toBe('488px');
    resizeTo('phone');
    expect(card().classList).toContain('pt-catalogue--sheet');
    // The window's resize arrives while the flat books are drawn, as a real resize does.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    resizeTo('desktop');
    expect(card().classList).not.toContain('pt-catalogue--sheet');
    expect(card().style.marginInlineStart).toBe('488px');
  });

  it('keeps focus and the open list in the Map when crossing 900 px (review SF4)', async () => {
    wide = true;
    await renderPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    const map = await screen.findByRole('region', { name: 'Plan of the reading room' });
    const details = (await within(map).findByText('The plan as a list')).closest('details')!;
    expect(details.open).toBe(false);
    details.open = true;
    const link = within(details).getByRole('link', { name: 'Attention Is All You Need' });
    link.focus();
    resizeTo('phone');
    expect(document.activeElement).toBe(link);
    expect(link.isConnected && details.open).toBe(true);
    resizeTo('desktop');
    expect(document.activeElement).toBe(link);
    // The person opened it; the width does not close it.
    expect(details.open).toBe(true);
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
