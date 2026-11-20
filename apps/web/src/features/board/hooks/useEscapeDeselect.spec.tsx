/**
 * Escape puts the selection away only when nothing else claimed the key: not when a level of the
 * board closed (defaultPrevented), not while typing in a field or inside a dialog, and not when
 * nothing is selected.
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEscapeDeselect } from './useEscapeDeselect';

afterEach(cleanup);

const press = (target: EventTarget, prevent = false): void => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  if (prevent) event.preventDefault();
  target.dispatchEvent(event);
};

describe('Escape clears the selection', () => {
  it('on the board, when something is selected', () => {
    const deselect = vi.fn();
    renderHook(() => useEscapeDeselect(true, deselect));
    press(document.body);
    expect(deselect).toHaveBeenCalledTimes(1);
  });

  it('not when nothing is selected', () => {
    const deselect = vi.fn();
    renderHook(() => useEscapeDeselect(false, deselect));
    press(document.body);
    expect(deselect).not.toHaveBeenCalled();
  });

  it('not when another level of the board already took the key', () => {
    const deselect = vi.fn();
    renderHook(() => useEscapeDeselect(true, deselect));
    press(document.body, true);
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

  it('follows the latest selection state without re-registering', () => {
    const deselect = vi.fn();
    const { rerender } = renderHook(({ on }) => useEscapeDeselect(on, deselect), {
      initialProps: { on: false },
    });
    press(document.body);
    rerender({ on: true });
    press(document.body);
    expect(deselect).toHaveBeenCalledTimes(1);
  });
});
