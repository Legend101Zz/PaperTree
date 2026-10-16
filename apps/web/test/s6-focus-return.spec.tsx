/**
 * s6-focus-return: closing the panel hands focus back to the "Ask AI" launcher, on the desktop
 * drawer (Esc and the Close button) and on the phone sheet. Measured before the fix: after Esc,
 * document.activeElement was <body>.
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
  it('desktop: Esc inside the drawer lands on the Ask AI launcher, not <body>', async () => {
    stubDesktop(true);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    const drawer = await screen.findByRole('complementary', { name: 'Explain' });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull(),
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask AI' }));
  });

  it('desktop: the Close button does the same', async () => {
    stubDesktop(true);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close explain panel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask AI' })),
    );
  });

  it('phone: dismissing the sheet with Esc lands on the launcher', async () => {
    stubDesktop(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask AI' }));
  });

  it('the launcher is not focused on first render (focus only moves back after a close)', () => {
    stubDesktop(true);
    render(<Harness />);
    expect(document.activeElement).toBe(document.body);
  });
});
