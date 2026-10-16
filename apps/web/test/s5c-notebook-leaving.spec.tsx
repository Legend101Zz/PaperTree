/**
 * s5c-notebook-leaving.spec — work is not lost or misreported at the edges (#208, second review):
 *
 * - Leaving: a hidden tab commits the open note and sends it with keepalive; on `pagehide` a write
 *   queued behind one in flight goes out at once with the version it will have; a note too long
 *   for any keepalive request makes the page warn before it closes, and only then.
 * - A page deleted elsewhere: a new note's create is a 404 → the bar says so and offers its words.
 * - A 422 after a network failure is said, and Try again stops offering it.
 * - "not saved here" is counted again as saves land; after a save the item is checked again.
 * - Undoing an add, or redoing a delete, moves the keyboard to the next item, never `<body>`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
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
  setVisibility('visible');
});

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** A request the test keeps in flight until it calls `release`. */
function held(): { promise: Promise<null>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<null>((resolve) => {
    release = () => resolve(null);
  });
  return { promise, release };
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET');
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const answer = (status: number, code: string): Response =>
  new Response(JSON.stringify({ detail: `the server said ${code}`, code, retryable: false }), {
    status,
  });
const NOTE_A = wireItem('ni_note0000a', 'text', 600, 600, 288, 72, 9, 'alpha');
const NOTE_B = wireItem('ni_note0000b', 'text', 600, 720, 288, 72, 9, 'beta');

async function typeInto(name: string, words: string): Promise<HTMLElement> {
  fireEvent.keyDown(await screen.findByRole('button', { name }), { key: 'Enter' });
  const editor = screen.getByRole('textbox', { name: 'Typed note' });
  fireEvent.change(editor, { target: { value: words } });
  return editor;
}

describe('leaving the page', () => {
  it('commits the open note when the tab is hidden, and sends it with keepalive', async () => {
    const calls = stubApi(pageView([NOTE_A]));
    mount();
    await typeInto('Typed note: alpha', 'alpha, typed before switching tabs');
    setVisibility('hidden');
    await settle();
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        body: { version: 1, body: 'alpha, typed before switching tabs' },
        keepalive: true,
      }),
    ]);
  });

  it('sends normally again once the tab is visible', async () => {
    const calls = stubApi(pageView([NOTE_A]));
    mount();
    const face = await screen.findByRole('button', { name: 'Typed note: alpha' });
    setVisibility('hidden');
    setVisibility('visible');
    fireEvent.keyDown(face, { key: 'ArrowLeft' });
    await settle();
    expect(writes(calls)[0]?.keepalive).toBe(false);
  });

  it('on pagehide sends a write queued behind one in flight, at the version it will have', async () => {
    const gate = held();
    const calls = stubApi(pageView([NOTE_A]), (c) =>
      c.method === 'PATCH' && c.body?.['x'] !== undefined ? gate.promise : null,
    );
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: alpha' }), {
      key: 'ArrowLeft',
    });
    await settle();
    await typeInto('Typed note: alpha', 'alpha, typed while the move was in flight');
    fireEvent(window, new Event('pagehide'));
    await settle();
    expect(writes(calls)).toEqual([
      expect.objectContaining({ body: { version: 1, x: 592 } }),
      expect.objectContaining({
        body: { version: 2, body: 'alpha, typed while the move was in flight' },
        keepalive: true,
      }),
    ]);
    gate.release();
  });

  it('warns before closing only while a note too long for keepalive is unsaved', async () => {
    stubApi(pageView([NOTE_A]));
    mount();
    const editor = await typeInto('Typed note: alpha', 'a short change');
    const close = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(close()).toBe(false);
    fireEvent.change(editor, { target: { value: 'x'.repeat(70_000) } });
    expect(close()).toBe(true);
    fireEvent.change(editor, { target: { value: 'short again' } });
    fireEvent.blur(editor);
    await settle();
    expect(close()).toBe(false);
  });
});

describe('what cannot be saved', () => {
  it('a new note on a page deleted elsewhere: the bar says so and offers the words', async () => {
    const copied = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: copied },
      configurable: true,
    });
    stubApi(pageView(), (c) => (c.method === 'POST' ? answer(404, 'not_found') : null));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }));
    const editor = screen.getByRole('textbox', { name: 'Typed note' });
    fireEvent.change(editor, { target: { value: 'my thought about §3.5' } });
    fireEvent.blur(editor);
    const bar = await screen.findByRole('alert');
    expect(bar.textContent).toContain('This page was deleted somewhere else');
    expect(screen.getByRole('button', { name: 'Typed note: my thought about §3.5' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }));
    await waitFor(() => expect(copied).toHaveBeenCalledWith('my thought about §3.5'));
    await screen.findByRole('button', { name: 'Copied' });
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id)).toEqual([]);
  });

  it('a 422 after a network failure is said once, and Try again stops offering it', async () => {
    let attempt = 0;
    const calls = stubApi(pageView([NOTE_A]), (c) => {
      if (c.method !== 'PATCH') return null;
      attempt += 1;
      return attempt === 1 ? answer(503, 'agent_unavailable') : answer(422, 'validation_failed');
    });
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: alpha' }), {
      key: 'ArrowLeft',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText('A note could not be saved: the server said validation_failed');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(writes(calls)).toHaveLength(2);
  });
});

describe('counting honestly', () => {
  it('recounts "not saved here" as saves land after a conflict', async () => {
    const gate = held();
    stubApi(pageView([NOTE_A, NOTE_B]), (c) => {
      if (c.path.endsWith('/ni_note0000a')) return answer(409, 'stale_version');
      if (c.path.endsWith('/ni_note0000b')) return gate.promise;
      return null;
    });
    mount();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Typed note: beta' }), {
      key: 'ArrowRight',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Typed note: alpha' }), {
      key: 'ArrowLeft',
    });
    const bar = await screen.findByRole('alert');
    await waitFor(() => expect(bar.textContent).toContain('(not saved here: 2 items)'));
    gate.release();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('(not saved here: 1 item)'),
    );
  });

  it('checks an item again after a save: a create that returned an older row is followed up', async () => {
    // A one-item server whose create finds an earlier attempt of the item and returns it as stored.
    let stored: Record<string, unknown> | null = null;
    const calls = stubApi(pageView(), (c) => {
      if (c.method === 'POST') {
        stored = { ...wireItem('x', 'text', 0, 0, 1, 1, 0, ''), ...c.body, body: 'older' };
      } else if (c.method === 'PATCH' && stored !== null) {
        const { version, ...fields } = c.body ?? {};
        stored = { ...stored, ...fields, version: Number(version) + 1 };
      } else return null;
      return new Response(JSON.stringify(stored), { status: c.method === 'POST' ? 201 : 200 });
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }));
    const editor = screen.getByRole('textbox', { name: 'Typed note' });
    fireEvent.change(editor, { target: { value: 'the words on screen' } });
    fireEvent.blur(editor);
    await settle();
    expect(writes(calls).map((c) => [c.method, c.body?.['body']])).toEqual([
      ['POST', 'the words on screen'],
      ['PATCH', 'the words on screen'],
    ]);
  });
});

describe('the keyboard after undo and redo', () => {
  it('undoing a new item moves focus to the next item; redoing a delete does too', async () => {
    stubApi(pageView([NOTE_A, NOTE_B]));
    mount();
    const alpha = await screen.findByRole('button', { name: 'Typed note: alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const editor = screen.getByRole('textbox', { name: 'Sticky note' });
    fireEvent.change(editor, { target: { value: 'a new sticky' } });
    fireEvent.blur(editor);
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Sticky note: a new sticky');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('[data-item-id]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Sticky note: a new sticky' })).toBeNull();

    alpha.focus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Typed note: alpha' }), {
      key: 'Delete',
    });
    await settle();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Typed note: alpha');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Typed note: beta');
  });
});
