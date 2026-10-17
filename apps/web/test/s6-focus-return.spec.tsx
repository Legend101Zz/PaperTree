/**
 * s6-focus-return: closing the panel hands focus back to the reader header's Explain toggle (#203;
 * it replaced the floating "Ask AI" launcher), on the desktop drawer (Esc and the Close button) and
 * on the phone sheet. Measured before the first fix: after Esc, document.activeElement was <body>.
 * On the phone, Enter on the toggle opens the sheet with focus still on the toggle, so Esc there
 * closes it too (review S1).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Harness, stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER } from './s6-support';

beforeEach(() => {
  window.localStorage.setItem('papertree.session', 'test-token');
  installFetch({
    [`GET /papers/${PAPER}/summary`]: () => jsonResponse(200, { state: 'none', summary: null }),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('focus after the panel closes', () => {
  it('desktop: Esc inside the drawer lands on the Explain toggle, not <body>', async () => {
    stubDesktop(true);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    const drawer = await screen.findByRole('complementary', { name: 'Explain' });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull(),
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Explain' }));
  });

  it('desktop: the Close button does the same', async () => {
    stubDesktop(true);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close explain panel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Explain' })),
    );
  });

  it('phone: dismissing the sheet with Esc lands on the toggle', async () => {
    stubDesktop(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Explain' }));
  });

  it('phone: Esc on the toggle that opened the sheet closes it, and focus stays on the toggle', async () => {
    stubDesktop(false);
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Explain' });
    toggle.focus();
    fireEvent.click(toggle);
    await screen.findByRole('dialog');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    fireEvent.keyDown(toggle, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('phone: a second press of the toggle closes the sheet', async () => {
    stubDesktop(false);
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Explain' });
    fireEvent.click(toggle);
    await screen.findByRole('dialog');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(toggle);
  });

  it('the toggle is not focused on first render (focus only moves back after a close)', () => {
    stubDesktop(true);
    render(<Harness />);
    expect(document.activeElement).toBe(document.body);
  });
});
