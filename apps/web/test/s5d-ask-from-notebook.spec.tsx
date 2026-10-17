/**
 * s5d-ask-from-notebook.spec — the reader's half of the notebook's "Ask about this" (#209, review
 * should-fix 6 and 7), on the real explain controller and panel (S4d): the words handed over in
 * this tab's storage open a NEW ask whose question box holds them as the controller's draft, with
 * the keyboard at their end and a note saying why; the hand-off is taken once, so a cleared box
 * stays cleared when the panel is closed and reopened, and a reload asks nothing.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useMemo, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import { AskFromNotebook } from '@/features/notebook/components/AskFromNotebook';
import { NOTEBOOK_ASK_NOTE } from '@/features/notebook/hooks/useAskFromNotebook';
import { askDraft } from '@/features/notebook/model/askHandoff';

import { HeaderAndPanel } from './explain-toggle';
import { TestQueryProvider } from './query-client';

let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/paper/ppr_ask/read',
  useSearchParams: () => search,
}));

/** Opens "the reader" at this query: the address bar and `useSearchParams` agree. */
function at(query: Record<string, string>): void {
  search = new URLSearchParams(query);
  const q = search.toString();
  window.history.replaceState(null, '', `/paper/ppr_ask/read${q === '' ? '' : `?${q}`}`);
}
const address = () => `${window.location.pathname}${window.location.search}`;

const PAPER = 'ppr_ask';
const WORDS = 'without recurrence, how does it know word order?';

beforeEach(() => {
  window.sessionStorage.clear();
  // The panel reads the paper's threads when it opens: there are none.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The reader's explain mount, as `ReaderWorkspace` wires it. */
function Reader(): ReactNode {
  const explain = useExplainActions({ paperId: PAPER });
  const { openExplain } = explain;
  const actions = useMemo<ReaderActions>(
    () => ({ openExplain, sendToCanvas: async () => undefined, focusAnchor: () => undefined }),
    [openExplain],
  );
  return (
    <TestQueryProvider>
      <ReaderActionsProvider value={actions}>
        <HeaderAndPanel explain={explain} />
        <AskFromNotebook paperId={PAPER} controller={explain} />
      </ReaderActionsProvider>
    </TestQueryProvider>
  );
}

const box = () =>
  screen.getByRole('textbox', { name: 'Ask a question about this paper' }) as HTMLTextAreaElement;
const toggle = () => screen.getByRole('button', { name: /^Explain/ });

describe('Ask about this, arriving in the reader', () => {
  it('opens a new ask holding the words, with the keyboard at their end and the note', async () => {
    window.sessionStorage.setItem('papertree.notebook-ask.ak_1', WORDS);
    at({ ask: 'ak_1', nb: 'np_1' });
    render(<Reader />);
    await waitFor(() => expect(box().value).toBe(askDraft(WORDS)));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(box().selectionStart).toBe(box().value.length);
    expect(await screen.findByText(NOTEBOOK_ASK_NOTE)).not.toBeNull();
    expect(address()).toBe('/paper/ppr_ask/read?nb=np_1');
    expect(window.sessionStorage.getItem('papertree.notebook-ask.ak_1')).toBeNull();
  });

  it('takes the words once: a cleared box stays cleared when the panel is closed and reopened', async () => {
    window.sessionStorage.setItem('papertree.notebook-ask.ak_2', WORDS);
    at({ ask: 'ak_2' });
    const { rerender } = render(<Reader />);
    await waitFor(() => expect(box().value).toBe(askDraft(WORDS)));
    fireEvent.change(box(), { target: { value: '' } });
    fireEvent.click(toggle()); // close
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    rerender(<Reader />); // the same URL again, before the replace lands
    fireEvent.click(toggle()); // reopen
    await waitFor(() => expect(box().value).toBe(''));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(box().value).toBe('');
  });

  it('a reload, whose hand-off was taken already, asks nothing and opens nothing', async () => {
    at({ ask: 'ak_gone' });
    render(<Reader />);
    await waitFor(() => expect(address()).toBe('/paper/ppr_ask/read'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(NOTEBOOK_ASK_NOTE)).toBeNull();
  });

  it('with storage blocked the words come in the URL, and still start one ask only', async () => {
    at({ ask_text: WORDS });
    const controller = { startFresh: vi.fn(), setDraft: vi.fn() };
    render(
      <StrictMode>
        <AskFromNotebook paperId={PAPER} controller={controller} />
      </StrictMode>,
    );
    await screen.findByText(NOTEBOOK_ASK_NOTE);
    expect(controller.startFresh).toHaveBeenCalledTimes(1);
    expect(controller.setDraft).toHaveBeenCalledWith(askDraft(WORDS));
  });

  it('a reader not opened from the notebook does nothing at all', async () => {
    at({ nb: 'np_1' });
    render(<Reader />);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(address()).toBe('/paper/ppr_ask/read?nb=np_1');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
