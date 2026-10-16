/** Behaviour of the v0.2 Toast with Undo (#189). */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toast } from '../src/index.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('is a polite live region and calls onUndo', () => {
    const onUndo = vi.fn();
    render(<Toast message="Highlight removed" onUndo={onUndo} onDismiss={() => undefined} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // Mounted empty, filled on a later tick, so assistive tech announces it.
    expect(region.textContent).toBe('');
    act(() => vi.advanceTimersByTime(60));
    expect(screen.getByRole('status').textContent).toBe('Highlight removed');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('offers no Undo without a handler, and Dismiss calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved" onDismiss={onDismiss} />);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after its duration', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved" onDismiss={onDismiss} duration={3000} />);
    act(() => vi.advanceTimersByTime(2999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('holds while hovered or focused, then counts again', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved" onDismiss={onDismiss} duration={1000} />);
    const region = screen.getByRole('status').parentElement!;
    fireEvent.pointerEnter(region);
    act(() => vi.advanceTimersByTime(5000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerLeave(region);
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => vi.advanceTimersByTime(5000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays above the bottom inset it is given', () => {
    render(<Toast message="Saved" onDismiss={() => undefined} bottomInset={88} />);
    expect(screen.getByRole('status').parentElement!.style.insetBlockEnd).toBe('100px');
  });

  it('draws Undo and Dismiss as bordered secondary buttons, not bare text', () => {
    render(
      <Toast message="Highlight removed" onUndo={() => undefined} onDismiss={() => undefined} />,
    );
    for (const name of ['Undo', 'Dismiss']) {
      const button = screen.getByRole('button', { name });
      expect(button.classList.contains('pt-button--secondary')).toBe(true);
    }
  });
});
