/**
 * s5c-notebook-saving.spec — saving never stops silently (#208, review B1, S1, S2, S4, S5).
 *
 * - The two-tab sequence: another tab's edit makes this tab's PATCH a 409; the page then shows a
 *   bar that cannot be dismissed, counts every unsaved edit, and sends nothing more.
 * - Dismiss, then fail: a dismissed failure stays visible as a chip until the save succeeds, and
 *   the next failure brings the notice back. Try again re-sends every failed write.
 * - An item deleted elsewhere that held changes is saved again, words kept; a refused (422) note is
 *   said once, never retried.
 * - The DELETE carries the version; typing survives an unmount and a `pagehide`; the keyboard
 *   moves to the next item after a delete, never to `<body>`; the editor caps a note's length.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotebookView } from '@/features/notebook';

import { PAGE, PAPER, pageView, stubApi, wireItem } from './s5c-notebook-fixtures';

import type { Call } from './s5c-notebook-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/paper/x/notebook/y',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(): () => void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
  return unmount;
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET');
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const answer = (status: number, code: string): Response =>
  new Response(JSON.stringify({ detail: `the server said ${code}`, code, retryable: false }), {
    status,
  });
const NOTE_A = wireItem('ni_note0000a', 'text', 600, 600, 288, 72, 9, 'alpha');
const NOTE_B = wireItem('ni_note0000b', 'text', 600, 720, 288, 72, 9, 'beta');

describe('a conflict (409) after another tab’s edit', () => {
  it('shows a bar that cannot be dismissed, counts every unsaved edit, and sends nothing more', async () => {
    const calls = stubApi(pageView([NOTE_A]), (c) =>
      c.method === 'PATCH' ? answer(409, 'stale_version') : null,
    );
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: alpha' }), {
      key: 'ArrowLeft',
    });
    const bar = await screen.findByRole('alert');
    expect(bar.textContent).toContain('Not saved: this page changed somewhere else');
    expect(bar.textContent).toContain('(not saved here: 1 item)');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const editor = screen.getByRole('textbox', { name: 'Sticky note' });
    fireEvent.change(editor, { target: { value: 'written after the conflict' } });
    fireEvent.blur(editor);
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('(not saved here: 2 items)');
    expect(writes(calls)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});

describe('a failed save', () => {
  it('stays visible after Dismiss until it succeeds, and the next failure shows again', async () => {
    let failing = true;
    const calls = stubApi(pageView([NOTE_A]), (c) =>
      c.method === 'PATCH' && failing ? answer(503, 'agent_unavailable') : null,
    );
    mount();
    const face = await screen.findByRole('button', { name: 'Typed note: alpha' });
    fireEvent.keyDown(face, { key: 'ArrowLeft' });
    await screen.findByText(
      'Not saved yet: 1 edit could not be sent. They are still on this page.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('Not saved (1 edit)')).toBeTruthy();

    failing = false;
    fireEvent.keyDown(face, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
    expect(writes(calls).at(-1)?.body).toEqual({ version: 1, x: 584 });

    failing = true;
    fireEvent.keyDown(face, { key: 'ArrowLeft' });
    await screen.findByText(
      'Not saved yet: 1 edit could not be sent. They are still on this page.',
    );
  });

  it('Try again re-sends every failed write', async () => {
    let failing = true;
    const calls = stubApi(pageView([NOTE_A, NOTE_B]), (c) =>
      c.method === 'PATCH' && failing ? answer(503, 'agent_unavailable') : null,
    );
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: alpha' }), {
      key: 'ArrowLeft',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Typed note: beta' }), {
      key: 'ArrowRight',
    });
    await screen.findByText(/Not saved yet: 2 edits could not be sent/);
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
    const resent = writes(calls)
      .slice(2)
      .map((c) => c.path);
    expect(resent.sort()).toEqual([
      `/notebook/pages/${PAGE}/items/ni_note0000a`,
      `/notebook/pages/${PAGE}/items/ni_note0000b`,
    ]);
  });
});

describe('what cannot be saved', () => {
  it('saves again a note deleted elsewhere (404) that held changes: the words are kept', async () => {
    let gone = true;
    const calls = stubApi(pageView([NOTE_A]), (c) => {
      if (c.method !== 'PATCH' || !gone) return null;
      gone = false;
      return answer(404, 'not_found');
    });
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: alpha' }), {
      key: 'Enter',
    });
    const editor = screen.getByRole('textbox', { name: 'Typed note' });
    fireEvent.change(editor, { target: { value: 'alpha, with a paragraph I just wrote' } });
    fireEvent.blur(editor);
    await screen.findByText(
      'A note you changed had been deleted somewhere else. Your version is kept and saved again.',
    );
    expect(
      screen.getByRole('button', { name: 'Typed note: alpha, with a paragraph I just wrote' }),
    ).toBeTruthy();
    expect(writes(calls).map((c) => c.method)).toEqual(['PATCH', 'POST']);
    expect(writes(calls)[1]?.body).toMatchObject({
      item_id: 'ni_note0000a',
      body: 'alpha, with a paragraph I just wrote',
    });
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says once that a note was refused (422) and never offers to send it again', async () => {
    const calls = stubApi(pageView([NOTE_A]), (c) =>
      c.method === 'PATCH' ? answer(422, 'validation_failed') : null,
    );
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: alpha' }), {
      key: 'ArrowLeft',
    });
    await screen.findByText('A note could not be saved: the server said validation_failed');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(writes(calls)).toHaveLength(1);
  });

  it('caps a note at the API limit and shows the count near it', async () => {
    stubApi(pageView());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }));
    const editor = screen.getByRole('textbox', { name: 'Typed note' });
    expect(editor.getAttribute('maxlength')).toBe('100000');
    fireEvent.change(editor, { target: { value: 'x'.repeat(96_000) } });
    expect(screen.getByText('96,000 / 100,000 characters')).toBeTruthy();
    // Leave nothing to commit after the test (an emptied draft is discarded, not saved).
    fireEvent.change(editor, { target: { value: '' } });
    fireEvent.blur(editor);
  });
});

describe('deleting', () => {
  it('sends the version it last saw, and moves the keyboard to the next item, then back on undo', async () => {
    const calls = stubApi(pageView([NOTE_A, NOTE_B]));
    mount();
    const alpha = await screen.findByRole('button', { name: 'Typed note: alpha' });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'Delete' });
    await settle();
    expect(writes(calls)[0]).toMatchObject({
      method: 'DELETE',
      path: `/notebook/pages/${PAGE}/items/ni_note0000a?version=1`,
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Typed note: beta');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Typed note: alpha');
  });

  it('focuses the page itself when the last item goes', async () => {
    const view = pageView();
    stubApi({ ...view, items: [NOTE_A] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete typed note' }));
    await settle();
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('typing is never lost', () => {
  it('commits a note being typed when the page unmounts (Back, a route change)', async () => {
    const calls = stubApi(pageView());
    const unmount = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Typed note' }), {
      target: { value: 'half a thought' },
    });
    unmount();
    await settle();
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ body: 'half a thought' }),
      }),
    ]);
  });

  it('flushes on pagehide, with keepalive so the request outlives the page', async () => {
    stubApi(pageView([NOTE_A]));
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: alpha' }), {
      key: 'Enter',
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Typed note' }), {
      target: { value: 'alpha, and more' },
    });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fireEvent(window, new Event('pagehide'));
    await settle();
    const [url, init] = (fetchMock.mock.calls as [string, RequestInit][]).find(([u]) =>
      u.includes('/items/ni_note0000a'),
    ) ?? ['', {}];
    expect(url).toContain('/items/ni_note0000a');
    expect(init.method).toBe('PATCH');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ version: 1, body: 'alpha, and more' });
  });
});
