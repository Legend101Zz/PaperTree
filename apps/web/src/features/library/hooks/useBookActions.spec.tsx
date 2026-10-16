/**
 * useBookActions (#195, #197): one guard for the card's and a Table row's Retry and Remove. A second
 * press while a request runs sends nothing, even two presses in the same frame, before React has
 * drawn the busy button.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBookActions } from './useBookActions';

describe('useBookActions', () => {
  it('two presses in one frame send one request; a press after it settles sends another', async () => {
    let settle: (value: unknown) => void = () => undefined;
    const onRetry = vi.fn(() => new Promise((resolve) => (settle = resolve)));
    const onDelete = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useBookActions('ppr_A', onRetry, onDelete));
    act(() => {
      result.current.retry();
      result.current.retry();
      result.current.remove();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);
    await act(async () => settle(undefined));
    expect(result.current.busy).toBe(false);
    act(() => result.current.retry());
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
