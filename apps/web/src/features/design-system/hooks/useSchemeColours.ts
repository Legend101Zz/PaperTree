/**
 * useSchemeColours: resolves colour tokens in BOTH schemes from the live stylesheet, so the board
 * can show daylight and lamp-lit side by side while only one is painted. It flips
 * `data-pt-theme` on <html> inside one synchronous effect, reads each token through a probe
 * element's computed `color`, and restores the attribute before the browser paints.
 */
'use client';

import { useEffect, useState } from 'react';

import { THEME_ATTRIBUTE } from '@/features/settings';

import { parseRgb, type Rgba } from '../model/contrast';

/** Scheme names, as `data-pt-theme` spells them. */
export type Scheme = 'light' | 'dark';

/** Colours by scheme, then by token name. Empty until the effect has run. */
export type SchemeColours = Readonly<Record<Scheme, Readonly<Record<string, Rgba>>>>;

const EMPTY: SchemeColours = { light: {}, dark: {} };

/**
 * Resolve tokens in both schemes.
 *
 * @param tokens Custom-property names such as `--pt-ink`. Pass a stable array.
 * @returns Parsed colours per scheme; empty on the server and on first render.
 * @example
 * const colours = useSchemeColours(ROLE_TOKENS);
 * const ink = colours.dark['--pt-ink'];
 */
export function useSchemeColours(tokens: readonly string[]): SchemeColours {
  const [colours, setColours] = useState<SchemeColours>(EMPTY);
  useEffect(() => {
    const root = document.documentElement;
    const original = root.getAttribute(THEME_ATTRIBUTE);
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.display = 'none';
    root.appendChild(probe);
    const read = (scheme: Scheme): Record<string, Rgba> => {
      root.setAttribute(THEME_ATTRIBUTE, scheme);
      const out: Record<string, Rgba> = {};
      for (const token of tokens) {
        probe.style.color = `var(${token})`;
        const parsed = parseRgb(getComputedStyle(probe).color);
        if (parsed !== null) out[token] = parsed;
      }
      return out;
    };
    try {
      setColours({ light: read('light'), dark: read('dark') });
    } finally {
      if (original === null) root.removeAttribute(THEME_ATTRIBUTE);
      else root.setAttribute(THEME_ATTRIBUTE, original);
      probe.remove();
    }
  }, [tokens]);
  return colours;
}

/**
 * Read custom properties as text (lengths, durations, curves) from the painted scheme.
 *
 * @param tokens Custom-property names. Pass a stable array.
 * @returns Name to trimmed value; empty until mounted. Re-reads when `<html>` attributes change,
 *   so the reduced-motion durations and the theme follow the page.
 */
export function useTokenText(tokens: readonly string[]): Readonly<Record<string, string>> {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    const root = document.documentElement;
    const read = (): void => {
      const style = getComputedStyle(root);
      setValues(Object.fromEntries(tokens.map((t) => [t, style.getPropertyValue(t).trim()])));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true });
    return () => {
      observer.disconnect();
    };
  }, [tokens]);
  return values;
}
