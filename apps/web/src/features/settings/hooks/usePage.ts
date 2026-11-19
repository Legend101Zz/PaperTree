/**
 * usePage: the paper's page colour, persisted per browser and applied to <html data-pt-page>.
 *
 * The no-flash script has already set the attribute before this runs, so the hook keeps it right
 * afterwards: when the choice changes and, for `auto`, when the room changes (Lamp-lit gives a dark
 * page). The room is read from `<html data-pt-theme>`, which `useTheme` and the no-flash script
 * write, rather than from a second `useTheme`: the attribute is the one source of truth, and a
 * hook that guessed `light` before its own storage read would flash a white page over a dark room.
 */
'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { PAGE_ATTRIBUTE, PAGE_STORAGE_KEY, parsePageChoice, resolvePage } from '../model/page';
import { THEME_ATTRIBUTE } from '../model/theme';

import type { PageChoice, ResolvedPage } from '../model/page';
import type { ResolvedTheme } from '../model/theme';

/**
 * One <html> attribute as an external store, for components that only READ the page or room.
 *
 * @param name - The attribute to watch.
 * @returns `subscribe` and `read` for `useSyncExternalStore`.
 */
function attributeStore(name: string): {
  subscribe: (notify: () => void) => () => void;
  read: () => string | null;
} {
  return {
    subscribe(notify) {
      if (typeof MutationObserver === 'undefined') return () => undefined;
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: [name] });
      return () => observer.disconnect();
    },
    read: () => document.documentElement.getAttribute(name),
  };
}

const PAGE_STORE = attributeStore(PAGE_ATTRIBUTE);
const THEME_STORE = attributeStore(THEME_ATTRIBUTE);

/**
 * The page being painted, read from <html>. Re-renders when it changes. `light` on the server and
 * before the attribute exists.
 *
 * @returns The resolved page.
 */
export function useResolvedPage(): ResolvedPage {
  const value = useSyncExternalStore(PAGE_STORE.subscribe, PAGE_STORE.read, () => null);
  return value === 'sepia' || value === 'dark' ? value : 'light';
}

/** The room being painted, read from <html>; `light` before the attribute exists. */
function useAppliedTheme(): ResolvedTheme {
  const value = useSyncExternalStore(THEME_STORE.subscribe, THEME_STORE.read, () => null);
  return value === 'dark' ? 'dark' : 'light';
}

function readChoice(): PageChoice {
  try {
    return parsePageChoice(window.localStorage.getItem(PAGE_STORAGE_KEY));
  } catch {
    // Storage can throw (private mode, blocked site data): follow the room.
    return 'auto';
  }
}

/** What `usePage` returns. */
export interface PageState {
  /** The person's choice. */
  readonly choice: PageChoice;
  /** The page being painted. */
  readonly resolved: ResolvedPage;
  /** Stores a new choice and repaints. */
  readonly setChoice: (next: PageChoice) => void;
}

/**
 * The page colour, kept in sync with localStorage, the room and `<html data-pt-page>`.
 * Mount it once, high enough that it outlives the Aa menu (the phone's menu unmounts when closed).
 *
 * @returns The current choice, what it resolves to, and a setter.
 * @example
 * const { choice, setChoice } = usePage();
 * <PageSwitch value={choice} onChange={setChoice} />
 */
export function usePage(): PageState {
  // null until the stored choice is read, after mount: the server has no storage, and writing
  // the `auto` default first would repaint a stored Sepia as a white page for a frame.
  const [stored, setStored] = useState<PageChoice | null>(null);
  const theme = useAppliedTheme();
  const choice = stored ?? 'auto';
  const resolved = resolvePage(choice, theme);

  useEffect(() => setStored(readChoice()), []);

  useEffect(() => {
    if (stored === null) return;
    document.documentElement.setAttribute(PAGE_ATTRIBUTE, resolvePage(stored, theme));
  }, [stored, theme]);

  const setChoice = useCallback((next: PageChoice): void => {
    try {
      window.localStorage.setItem(PAGE_STORAGE_KEY, next);
    } catch {
      // Not persisted (storage unavailable); the choice still applies for this page view.
    }
    setStored(next);
  }, []);

  return { choice, resolved, setChoice };
}
