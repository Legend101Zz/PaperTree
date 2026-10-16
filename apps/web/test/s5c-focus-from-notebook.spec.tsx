/**
 * s5c-focus-from-notebook.spec — the reader's half of the notebook's "Open source" and "Back to the
 * paper" (#208): `?nb=<page>&item=<item>` reads the page back and calls `focusAnchor` with the
 * item's STORED Anchor (a quote's own, an exchange's origin), once, and only for this paper.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFocusFromNotebook } from '@/features/notebook/hooks/useFocusFromNotebook';

import { CITATIONS, ORIGIN, PAGE, PAPER, pageView, stubApi } from './s5c-notebook-fixtures';

const params = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params.value }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function aim(item: string): void {
  params.value = new URLSearchParams({ nb: PAGE, item });
}

describe('useFocusFromNotebook', () => {
  it('flashes a quote card’s stored Anchor once the parse is ready, and only once', async () => {
    const calls = stubApi(pageView());
    aim('ni_quote0002');
    const focus = vi.fn();
    const { rerender } = renderHook(({ ready }) => useFocusFromNotebook(PAPER, ready, focus), {
      initialProps: { ready: false },
    });
    expect(calls).toHaveLength(0);
    rerender({ ready: true });
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(focus.mock.calls[0]?.[0]).toEqual(CITATIONS[1]?.anchor);
    rerender({ ready: true });
    expect(calls.filter((c) => c.path === `/notebook/pages/${PAGE}`)).toHaveLength(1);
  });

  it('flashes the question’s origin for the exchange (Back to the paper)', async () => {
    stubApi(pageView());
    aim('ni_exchange01');
    const focus = vi.fn();
    renderHook(() => useFocusFromNotebook(PAPER, true, focus));
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(focus.mock.calls[0]?.[0]).toEqual(ORIGIN);
  });

  it('does nothing for another paper or an item that is gone', async () => {
    stubApi(pageView());
    const focus = vi.fn();
    aim('ni_quote0002');
    renderHook(() => useFocusFromNotebook('ppr_OTHER', true, focus));
    aim('ni_gone');
    renderHook(() => useFocusFromNotebook(PAPER, true, focus));
    await new Promise((r) => setTimeout(r, 700));
    expect(focus).not.toHaveBeenCalled();
  });
});
