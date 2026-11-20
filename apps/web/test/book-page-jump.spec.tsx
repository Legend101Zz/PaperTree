/**
 * The reader's half of the sheet's `p. 3 ›` and "from the start" links (v0.3 #337): the address
 * `?from=book&page=3` opens the reader at page 3 once the parse is loaded, once, and then takes its
 * own query off the address. A page that is not a number of at least 1, or an address that did not
 * come from the book, does nothing.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FOCUS_SETTLE_MS } from '@/components/canvas/useFocusFromCanvas';
import { bookReaderHref, pageFromQuery, usePageFromBook } from '@/features/book/hooks/useFromBook';

let query = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
}));

beforeEach(() => {
  vi.useFakeTimers();
  query = '';
  window.history.replaceState(null, '', '/paper/ppr_1/read');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the book’s reader links', () => {
  it('names a page, the abstract or the summary', () => {
    expect(bookReaderHref('ppr_1')).toBe('/paper/ppr_1/read');
    expect(bookReaderHref('ppr_1', 'abstract')).toBe('/paper/ppr_1/read?from=book&at=abstract');
    expect(bookReaderHref('ppr_1', 'summary')).toBe('/paper/ppr_1/read?from=book&open=summary');
    expect(bookReaderHref('ppr_1', { page: 3 })).toBe('/paper/ppr_1/read?from=book&page=3');
    expect(bookReaderHref('ppr 1/x', { page: 1 })).toBe('/paper/ppr%201%2Fx/read?from=book&page=1');
  });

  it('reads a page number back, or nothing', () => {
    expect(pageFromQuery('3')).toBe(3);
    expect(pageFromQuery('120')).toBe(120);
    for (const bad of [null, undefined, '', '0', '-2', '03', '3.5', 'abc', '1e3', '1000000']) {
      expect(pageFromQuery(bad), String(bad)).toBeNull();
    }
  });
});

describe('usePageFromBook', () => {
  it('jumps to the page (zero-based) once the parse is loaded, then takes its query off the address', () => {
    query = 'from=book&page=3&keep=1';
    window.history.replaceState(null, '', `/paper/ppr_1/read?${query}`);
    const jump = vi.fn();
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => usePageFromBook('ppr_1', ready, jump),
      { initialProps: { ready: false } },
    );
    vi.advanceTimersByTime(FOCUS_SETTLE_MS * 2);
    expect(jump).not.toHaveBeenCalled(); // the parse is not in yet
    rerender({ ready: true });
    expect(jump).not.toHaveBeenCalled(); // it waits for the reader to settle
    vi.advanceTimersByTime(FOCUS_SETTLE_MS);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump).toHaveBeenCalledWith(2);
    expect(window.location.search).toBe('?keep=1');
    rerender({ ready: true });
    vi.advanceTimersByTime(FOCUS_SETTLE_MS * 2);
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an address that did not come from the book, a bad page, or a sample', () => {
    const jump = vi.fn();
    for (const wrong of ['page=3', 'from=book', 'from=book&page=0', 'from=book&page=x']) {
      query = wrong;
      renderHook(() => usePageFromBook('ppr_1', true, jump));
    }
    query = 'from=book&page=3';
    renderHook(() => usePageFromBook(null, true, jump));
    vi.advanceTimersByTime(FOCUS_SETTLE_MS * 2);
    expect(jump).not.toHaveBeenCalled();
  });

  it('does not jump when the reader is left before it settles', () => {
    query = 'from=book&page=5';
    const jump = vi.fn();
    const { unmount } = renderHook(() => usePageFromBook('ppr_1', true, jump));
    unmount();
    vi.advanceTimersByTime(FOCUS_SETTLE_MS * 2);
    expect(jump).not.toHaveBeenCalled();
  });
});
