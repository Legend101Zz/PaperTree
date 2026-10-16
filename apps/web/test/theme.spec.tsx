/**
 * The colour-scheme choice (v0.2, #175): the pure rules, the no-flash script that repeats them
 * before any bundle loads, and the switch and hook that apply them to <html>.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NO_FLASH_SCRIPT,
  parseThemeChoice,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  ThemeSwitch,
  useTheme,
  type ThemeChoice,
} from '@/features/settings';

/** Makes `matchMedia('(prefers-color-scheme: dark)')` answer `dark`, with a working listener. */
function mockOs(dark: boolean): { flip: (next: boolean) => void } {
  let matches = dark;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
  return {
    flip: (next) => {
      matches = next;
      for (const fn of listeners) fn();
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('theme rules', () => {
  it('reads unknown or missing values as System', () => {
    expect(parseThemeChoice(null)).toBe('system');
    expect(parseThemeChoice('sepia')).toBe('system');
    expect(parseThemeChoice('dark')).toBe('dark');
  });

  it('follows the OS only for System', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it.each<[string | null, boolean]>([
    [null, true],
    [null, false],
    ['light', true],
    ['dark', false],
    ['system', true],
    ['garbage', false],
  ])('the no-flash script agrees with resolveTheme (stored %s, OS dark %s)', (stored, dark) => {
    mockOs(dark);
    if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    // The script is a string inlined into <head>; run it exactly as the browser would.
    new Function(NO_FLASH_SCRIPT)();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(
      resolveTheme(parseThemeChoice(stored), dark),
    );
  });
});

function Harness(): JSX.Element {
  const { choice, resolved, setChoice } = useTheme();
  return (
    <div>
      <ThemeSwitch value={choice} onChange={setChoice} />
      <output>{resolved}</output>
    </div>
  );
}

describe('ThemeSwitch + useTheme', () => {
  it('offers System, Daylight and Lamp-lit as one named group', () => {
    mockOs(false);
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Colour scheme' });
    expect(group).toBeTruthy();
    for (const name of ['System', 'Daylight', 'Lamp-lit']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
  });

  it('paints and stores an explicit choice', () => {
    mockOs(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'Lamp-lit' }));
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark' satisfies ThemeChoice);
    fireEvent.click(screen.getByRole('radio', { name: 'Daylight' }));
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light');
  });

  it('follows the OS while System is chosen, and stops when a scheme is picked', () => {
    const os = mockOs(false);
    render(<Harness />);
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light');
    act(() => os.flip(true));
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'Daylight' }));
    act(() => os.flip(true));
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light');
  });

  it('restores the stored choice after mount', () => {
    mockOs(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Lamp-lit' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});
