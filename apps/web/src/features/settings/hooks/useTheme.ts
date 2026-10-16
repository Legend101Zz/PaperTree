/**
 * useTheme: the colour-scheme choice, persisted per browser and applied to <html>.
 *
 * The no-flash script in the root layout has already set `data-pt-theme` before this runs, so the
 * hook only has to keep it right afterwards: when the choice changes, and, for `system`, when the
 * OS switches between light and dark while the app is open.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  parseThemeChoice,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeChoice,
} from '../model/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readChoice(): ThemeChoice {
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can throw (private mode, blocked site data): fall back to following the OS.
    return 'system';
  }
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** What `useTheme` returns. */
export interface ThemeState {
  /** The person's choice. */
  readonly choice: ThemeChoice;
  /** The scheme being painted. */
  readonly resolved: ResolvedTheme;
  /** Stores a new choice and repaints. */
  readonly setChoice: (next: ThemeChoice) => void;
}

/**
 * The colour scheme, kept in sync with localStorage, the OS and `<html data-pt-theme>`.
 *
 * @returns The current choice, what it resolves to, and a setter.
 * @example
 * const { choice, setChoice } = useTheme();
 * <ThemeSwitch value={choice} onChange={setChoice} />
 */
export function useTheme(): ThemeState {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  // Read after mount, never during render: the server has no storage, and reading it in render
  // would make the first client render disagree with the server's (a hydration warning).
  useEffect(() => setChoiceState(readChoice()), []);

  useEffect(() => {
    const apply = (): void => {
      const next = resolveTheme(choice, prefersDark());
      document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
      setResolved(next);
    };
    apply();
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_QUERY);
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice): void => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not persisted (storage unavailable); the choice still applies for this page view.
    }
    setChoiceState(next);
  }, []);

  return { choice, resolved, setChoice };
}
