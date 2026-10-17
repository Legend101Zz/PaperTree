'use client';

/**
 * The header's "p. 2 of 15" (#203). Its own component so that only it re-renders when the page
 * filling the view changes, not the whole reader under the header (review N1).
 */
import { useVisiblePages } from '@/components/reader/VirtualPageList';

import { counterPage, pageCounterLabel } from '../model/pageCounter';

import type { ReactNode } from 'react';

/** Props for `PageCounter`. */
export interface PageCounterProps {
  readonly mode: 'source' | 'guided' | 'split';
  /** Guided's top page, or the saved one (0-based). */
  readonly page: number | null;
  readonly pageCount: number | null;
}

/**
 * The page counter, in Courier numbers.
 *
 * @param props - The mode, Guided's page and the page count.
 * @returns The counter, or nothing before there is a page to name.
 */
export function PageCounter({ mode, page, pageCount }: PageCounterProps): ReactNode {
  const visible = useVisiblePages();
  const label = pageCounterLabel(counterPage(mode, visible.current, page), pageCount);
  return label === null ? null : <span className="pt-reader__page">{label}</span>;
}
