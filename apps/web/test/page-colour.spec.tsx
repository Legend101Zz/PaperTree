/**
 * page-colour: the paper's page (Light, Sepia, Dark) and the reader's Aa menu (#345).
 *
 * The rules are pure (`model/page`): the page FOLLOWS the room unless Aa overrides it (owner
 * decision F), and the override is a localStorage key like the theme, not the API. The menu sets
 * `<html data-pt-page>`, the attribute the stylesheet's page tokens, the canvas filter and the
 * mats key on; that attribute is what these tests read.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReaderHeader, type ReaderHeaderProps } from '@/features/reader';
import {
  NO_FLASH_SCRIPT,
  PAGE_ATTRIBUTE,
  PAGE_STORAGE_KEY,
  parsePageChoice,
  resolvePage,
  resolveTheme,
  parseThemeChoice,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  usePage,
  useResolvedPage,
  type PageChoice,
} from '@/features/settings';

import { stubDesktop } from './s6-harness';

const HEADER: ReaderHeaderProps = {
  title: 'Attention Is All You Need',
  page: 1,
  pageCount: 15,
  mode: 'source',
  onModeChange: () => undefined,
  guidedAvailable: true,
  zoom: 1.25,
  zoomMode: { kind: 'scale', scale: 1.25 },
  onZoomChange: () => undefined,
  navigatorOpen: false,
  navigatorAvailable: true,
  onNavigatorToggle: () => undefined,
  highlightCount: 0,
  boardHref: null,
  explain: null,
};

const root = document.documentElement;
const page = (): string | null => root.getAttribute(PAGE_ATTRIBUTE);

/** Attribute observers fire after the writing task: let them (and the effects they trigger) settle. */
async function settle(): Promise<void> {
  // Twice: the room's observer fires, its effect writes the page, and the page's observer fires.
  for (let round = 0; round < 2; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  window.localStorage.clear();
  root.removeAttribute(THEME_ATTRIBUTE);
  root.removeAttribute(PAGE_ATTRIBUTE);
  stubDesktop(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the page rules', () => {
  it('reads an unknown or missing value as Auto', () => {
    expect(parsePageChoice(null)).toBe('auto');
    expect(parsePageChoice('mauve')).toBe('auto');
    for (const choice of ['auto', 'light', 'sepia', 'dark'] as const) {
      expect(parsePageChoice(choice)).toBe(choice);
    }
  });

  it('Auto follows the room: Daylight is a light page, Lamp-lit a dark one', () => {
    expect(resolvePage('auto', 'light')).toBe('light');
    expect(resolvePage('auto', 'dark')).toBe('dark');
  });

  it('an explicit page wins over the room, in both rooms', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const choice of ['light', 'sepia', 'dark'] as const) {
        expect(resolvePage(choice, theme)).toBe(choice);
      }
    }
  });

  it.each<[string | null, boolean]>([
    [null, false],
    [null, true],
    ['sepia', false],
    ['sepia', true],
    ['light', true],
    ['dark', false],
    ['auto', true],
    ['garbage', true],
  ])('the no-flash script agrees with resolvePage (stored %s, OS dark %s)', (stored, dark) => {
    vi.stubGlobal('matchMedia', () => ({ matches: dark }));
    if (stored !== null) window.localStorage.setItem(PAGE_STORAGE_KEY, stored);
    new Function(NO_FLASH_SCRIPT)();
    const theme = resolveTheme(parseThemeChoice(null), dark);
    expect(page()).toBe(resolvePage(parsePageChoice(stored), theme));
  });

  it('the no-flash script uses the stored room, not the OS, when the person chose one', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(NO_FLASH_SCRIPT)();
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(page()).toBe('dark');
  });

  it('the no-flash script still paints a page when storage throws', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    new Function(NO_FLASH_SCRIPT)();
    getItem.mockRestore();
    expect(page()).toBe('dark');
  });
});

function Harness(): JSX.Element {
  const state = usePage();
  const seen = useResolvedPage();
  return (
    <div>
      <output data-testid="choice">{state.choice}</output>
      <output data-testid="resolved">{state.resolved}</output>
      <output data-testid="seen">{seen}</output>
      {(['auto', 'sepia', 'dark'] as const).map((c: PageChoice) => (
        <button key={c} type="button" onClick={() => state.setChoice(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}

describe('usePage', () => {
  it('follows the app by default, in both rooms, and as the room changes', async () => {
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    render(<Harness />);
    await settle();
    expect(screen.getByTestId('choice').textContent).toBe('auto');
    expect(page()).toBe('light');
    act(() => root.setAttribute(THEME_ATTRIBUTE, 'dark'));
    await settle();
    expect(page()).toBe('dark');
    expect(screen.getByTestId('seen').textContent).toBe('dark');
    act(() => root.setAttribute(THEME_ATTRIBUTE, 'light'));
    await settle();
    expect(page()).toBe('light');
  });

  it('an override persists to localStorage, repaints, and survives a remount and a room change', async () => {
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    const first = render(<Harness />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'sepia' }));
    await settle();
    expect(window.localStorage.getItem(PAGE_STORAGE_KEY)).toBe('sepia');
    expect(page()).toBe('sepia');
    first.unmount();

    render(<Harness />);
    await settle();
    expect(screen.getByTestId('choice').textContent).toBe('sepia');
    act(() => root.setAttribute(THEME_ATTRIBUTE, 'dark'));
    await settle();
    expect(page()).toBe('sepia');
  });

  it('going back to Auto hands the page back to the room', async () => {
    root.setAttribute(THEME_ATTRIBUTE, 'dark');
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'sepia' }));
    await settle();
    expect(page()).toBe('sepia');
    fireEvent.click(screen.getByRole('button', { name: 'auto' }));
    await settle();
    expect(page()).toBe('dark');
  });

  it('never paints a light page over a stored dark one while mounting', async () => {
    // The no-flash script has painted `dark`; the hook must not write the `auto` default first.
    window.localStorage.setItem(PAGE_STORAGE_KEY, 'dark');
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    root.setAttribute(PAGE_ATTRIBUTE, 'dark');
    const setAttribute = vi.spyOn(root, 'setAttribute');
    render(<Harness />);
    await settle();
    const seen = setAttribute.mock.calls.filter(([n]) => n === PAGE_ATTRIBUTE).map(([, v]) => v);
    setAttribute.mockRestore();
    expect(seen).not.toContain('light');
    expect(page()).toBe('dark');
  });
});

describe('the reader Aa menu', () => {
  it('is a button on the bar that opens Page and Room', async () => {
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    render(<ReaderHeader {...HEADER} />);
    const aa = within(screen.getByRole('banner')).getByRole('button', { name: 'Reading settings' });
    expect(aa.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(aa);
    expect(aa.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('group', { name: 'Reading settings' });
    expect(
      within(within(panel).getByRole('radiogroup', { name: 'Page' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Auto', 'Light', 'Sepia', 'Dark']);
    expect(
      within(within(panel).getByRole('radiogroup', { name: 'Colour scheme' }))
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['System', 'Daylight', 'Lamp-lit']);
    // Auto is the default: the page follows the room.
    expect(within(panel).getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('Page: Dark sets the attribute the stylesheet keys on, and Sepia replaces it', async () => {
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    render(<ReaderHeader {...HEADER} />);
    await settle();
    expect(page()).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Reading settings' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await settle();
    expect(page()).toBe('dark');
    expect(window.localStorage.getItem(PAGE_STORAGE_KEY)).toBe('dark');
    // the room is untouched: a dark page in a daylight room
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: 'Sepia' }));
    await settle();
    expect(page()).toBe('sepia');
  });

  it('Room: Lamp-lit brings the dark page while the page is on Auto', async () => {
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    render(<ReaderHeader {...HEADER} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Reading settings' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Lamp-lit' }));
    await settle();
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(page()).toBe('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await settle();
    expect(page()).toBe('light');
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
  });

  it('Esc closes it, one level, and puts focus back on Aa', () => {
    render(<ReaderHeader {...HEADER} />);
    const aa = screen.getByRole('button', { name: 'Reading settings' });
    fireEvent.click(aa);
    const dark = screen.getByRole('radio', { name: 'Dark' });
    dark.focus();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    fireEvent.keyDown(dark, { key: 'Escape' });
    document.removeEventListener('keydown', outside);
    expect(screen.queryByRole('group', { name: 'Reading settings' })).toBeNull();
    expect(document.activeElement).toBe(aa);
    // stopped at the menu: it must not also clear the reader's selection or close a panel
    expect(outside).not.toHaveBeenCalled();
  });

  it('is reachable by keyboard: Aa is a tab stop and arrows move the Page choice', async () => {
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    render(<ReaderHeader {...HEADER} />);
    await settle();
    const aa = screen.getByRole('button', { name: 'Reading settings' });
    expect(aa.getAttribute('tabindex')).not.toBe('-1');
    fireEvent.click(aa);
    const auto = screen.getByRole('radio', { name: 'Auto' });
    auto.focus();
    fireEvent.keyDown(auto, { key: 'ArrowRight' });
    await settle();
    expect(page()).toBe('light');
    expect(window.localStorage.getItem(PAGE_STORAGE_KEY)).toBe('light');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Light' }), { key: 'End' });
    await settle();
    expect(page()).toBe('dark');
  });

  it('is in the phone menu too, without a second popover', async () => {
    stubDesktop(false);
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    render(<ReaderHeader {...HEADER} />);
    await settle();
    // the page colour is kept applied whether or not the menu is open
    expect(page()).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Reading options' }));
    expect(screen.queryByRole('button', { name: 'Reading settings' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Sepia' }));
    await settle();
    expect(page()).toBe('sepia');
  });
});
