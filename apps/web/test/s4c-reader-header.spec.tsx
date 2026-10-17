/**
 * s4c-reader-header: the reader's header (#203, frame 04) by role and name: Library, Contents, the
 * title, "p. 2 of 15", Source · Guided · Split, zoom, Board and the Explain toggle with
 * `aria-pressed`; and the explain panel, mounted with that toggle, draws no "Ask AI" launcher of
 * its own and hands focus back to the toggle when it closes.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExplainPanel, useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import {
  counterPage,
  pageCounterLabel,
  ReaderHeader,
  type ReaderHeaderProps,
} from '@/features/reader';

import { TestQueryProvider } from './query-client';
import { stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER } from './s6-support';

const BASE: ReaderHeaderProps = {
  title: 'Attention Is All You Need',
  page: 1,
  pageCount: 15,
  mode: 'source',
  onModeChange: () => undefined,
  guidedAvailable: true,
  zoom: 1.25,
  zoomMode: { kind: 'scale', scale: 1.25 },
  onZoomChange: () => undefined,
  navigatorOpen: false,
  navigatorAvailable: true,
  onNavigatorToggle: () => undefined,
  highlightCount: 0,
  boardHref: `/paper/${PAPER}/board`,
  explain: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the page counter', () => {
  it('names the page at the top of the view, 1-based, out of the page count', () => {
    expect(pageCounterLabel(1, 15)).toBe('p. 2 of 15');
    expect(pageCounterLabel(0, 15)).toBe('p. 1 of 15');
  });

  it('drops "of N" while the count is unknown, and says nothing without a page', () => {
    expect(pageCounterLabel(3, null)).toBe('p. 4');
    expect(pageCounterLabel(null, 15)).toBeNull();
    expect(pageCounterLabel(-1, 15)).toBeNull();
  });

  it('never claims a page past the last one (a saved place on a shorter re-upload)', () => {
    expect(pageCounterLabel(17, 15)).toBe('p. 15 of 15');
  });

  it('Source and Split name the most visible page; Guided (or no page list yet) its own page', () => {
    expect(counterPage('source', 3, 1)).toBe(3);
    expect(counterPage('split', 3, 1)).toBe(3);
    expect(counterPage('guided', 3, 1)).toBe(1);
    expect(counterPage('source', -1, 1)).toBe(1);
    expect(counterPage('source', -1, null)).toBeNull();
  });
});

describe('the reader header', () => {
  it('has every control of frame 04, by role and name', () => {
    render(<ReaderHeader {...BASE} />);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Library' }).getAttribute('href')).toBe(
      '/dashboard',
    );
    const contents = within(header).getByRole('button', { name: 'Contents' });
    expect(contents.getAttribute('aria-expanded')).toBe('false');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe(
      'Attention Is All You Need',
    );
    expect(within(header).getByText('p. 2 of 15')).toBeTruthy();
    const modes = within(header).getByRole('radiogroup', { name: 'Reading mode' });
    expect(
      within(modes)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Source', 'Guided', 'Split']);
    expect(within(header).getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(within(header).getByLabelText('Zoom level')).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    // "Fit width" is one of the select's options, not a separate button (frame 04).
    expect(within(header).queryByRole('button', { name: 'Fit width' })).toBeNull();
    expect(within(header).getByRole('option', { name: 'Fit width' })).toBeTruthy();
    expect(within(header).getByRole('link', { name: 'Board' }).getAttribute('href')).toBe(
      `/paper/${PAPER}/board`,
    );
  });

  it('Contents names its highlight count after the visible label, and says when it is open', () => {
    const toggle = vi.fn();
    render(<ReaderHeader {...BASE} highlightCount={2} navigatorOpen onNavigatorToggle={toggle} />);
    const contents = screen.getByRole('button', { name: 'Contents, 2 highlights' });
    expect(contents.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(contents);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('Explain is a toggle: aria-pressed follows the panel, a press asks for the other state', () => {
    const onToggle = vi.fn();
    const ref = { current: null };
    const { rerender } = render(
      <ReaderHeader {...BASE} explain={{ open: false, onToggle, ref }} />,
    );
    const explain = screen.getByRole('button', { name: 'Explain' });
    expect(explain.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(explain);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    rerender(<ReaderHeader {...BASE} explain={{ open: true, onToggle, ref }} />);
    expect(screen.getByRole('button', { name: 'Explain' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Explain' }));
  });

  it('a sample paper has no Board and no Explain; Guided hides the zoom', () => {
    render(<ReaderHeader {...BASE} boardHref={null} explain={null} mode="guided" />);
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
    expect(screen.queryByLabelText('Zoom level')).toBeNull();
  });
});

function WithToggle(): ReactNode {
  const explain = useExplainActions({ paperId: PAPER });
  const ref = useRef<HTMLButtonElement>(null);
  const { openExplain, openPanel, closeExplain } = explain;
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain,
      sendToCanvas: async () => undefined,
      focusAnchor: () => undefined,
    }),
    [openExplain],
  );
  return (
    <ReaderActionsProvider value={actions}>
      <ReaderHeader
        {...BASE}
        explain={{
          open: explain.state.open,
          ref,
          onToggle: (next) => (next ? openPanel() : closeExplain()),
        }}
      />
      <ExplainPanel controller={explain} toggleRef={ref} />
    </ReaderActionsProvider>
  );
}

describe('the explain panel under the header toggle', () => {
  beforeEach(() => {
    window.localStorage.setItem('papertree.session', 'test-token');
    installFetch({
      [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, []),
      [`GET /papers/${PAPER}/summary`]: () => jsonResponse(200, { state: 'none', summary: null }),
    });
  });

  it('draws no "Ask AI" launcher; the toggle opens the drawer, and Esc hands focus back to it', async () => {
    stubDesktop(true);
    render(
      <TestQueryProvider>
        <WithToggle />
      </TestQueryProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Explain' });
    fireEvent.click(toggle);
    const drawer = await screen.findByRole('complementary', { name: 'Explain' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull(),
    );
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});
