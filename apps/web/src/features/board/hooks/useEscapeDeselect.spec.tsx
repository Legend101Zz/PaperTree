/**
 * Escape puts the selection away only when nothing else claimed the key: not when a level of the
 * board closed (defaultPrevented), not while typing in a field or inside a dialog, and not when
 * nothing is selected.
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

import { useEscapeDeselect } from './useEscapeDeselect';

afterEach(cleanup);

const press = (target: EventTarget, prevent = false): void => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  if (prevent) event.preventDefault();
  target.dispatchEvent(event);
};

describe('Escape clears the selection', () => {
  it('on the board, when something is selected', async () => {
    const deselect = vi.fn();
    renderHook(() => useEscapeDeselect(true, deselect));
    press(document.body);
    await settle();
    expect(deselect).toHaveBeenCalledTimes(1);
  });

  it('not when nothing is selected', () => {
    const deselect = vi.fn();
    renderHook(() => useEscapeDeselect(false, deselect));
    press(document.body);
    expect(deselect).not.toHaveBeenCalled();
  });

  it('not when another level of the board already took the key', async () => {
    const deselect = vi.fn();
    renderHook(() => useEscapeDeselect(true, deselect));
    press(document.body, true);
    await settle();
    expect(deselect).not.toHaveBeenCalled();
  });

  it('not from a text field or a dialog', () => {
    const deselect = vi.fn();
    renderHook(() => useEscapeDeselect(true, deselect));
    const input = document.createElement('input');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.append(inner);
    document.body.append(input, dialog);
    press(input);
    press(inner);
    expect(deselect).not.toHaveBeenCalled();
    input.remove();
    dialog.remove();
  });

  it('follows the latest selection state without re-registering', async () => {
    const deselect = vi.fn();
    const { rerender } = renderHook(({ on }) => useEscapeDeselect(on, deselect), {
      initialProps: { on: false },
    });
    press(document.body);
    rerender({ on: true });
    press(document.body);
    await settle();
    expect(deselect).toHaveBeenCalledTimes(1);
  });

  it('leaves a press to a path-focus handler registered AFTER it, whichever order they run in', async () => {
    const deselect = vi.fn();
    let focus: string | null = 'card-2';
    renderHook(() => useEscapeDeselect(true, deselect));
    // Registered later (as the board's Escape is after every re-render): it closes the focus first.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && focus !== null) {
        focus = null;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    press(document.body);
    await settle();
    window.removeEventListener('keydown', onKey);
    expect(focus).toBeNull();
    expect(deselect).not.toHaveBeenCalled();
  });
});
