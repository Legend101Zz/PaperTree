/**
 * s5d-notebook-ink-saving.spec — the ink's saver at its edges (#209, review should-fix 2–4): a page
 * deleted elsewhere stops saving and says so; a refused stroke is said once and never sent again;
 * undoing a stroke whose save failed clears the failure, and DELETEs it when its POST may have
 * landed; a hidden tab sends with keepalive inside the shared budget; on `pagehide` every owed
 * stroke goes out at once, with keepalive for what a long note leaves of the budget; `beforeunload`
 * warns when the note and the ink together cannot go, and for one stroke too long for keepalive.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeStroke } from '@/features/notebook';
import { keepaliveLeft } from '@/features/notebook/api/keepalive';
import { KEEPALIVE_CAP } from '@/features/notebook/model/leave';
import { bytesFromBase64 } from '@/features/notebook/model/wire';

import {
  STROKES,
  closeWarns,
  deletes,
  drag,
  mount,
  posts,
  sent,
  setVisibility,
  settle,
  stubInk,
} from './s5d-ink-fixtures';

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
  window.dispatchEvent(new Event('pageshow'));
});

const answer = (status: number, detail = `the server said ${String(status)}`): Response =>
  new Response(JSON.stringify({ detail, code: 'x', retryable: false }), { status });
/** Where each stroke of a call starts, by x: how the stubs and the checks tell strokes apart. */
const xs = (call: Call): number[] =>
  sent(call).map((s) => decodeStroke(bytesFromBase64(s.points_b64)).points[0]![0]);
const ids = (calls: Call[]): string[] => calls.flatMap((c) => sent(c).map((s) => s.stroke_id));
const bytes = (call: Call): number => new TextEncoder().encode(JSON.stringify(call.body)).length;
/** A short stroke starting at x. */
const line = (x: number, y = 300) =>
  drag([
    [x, y],
    [x + 20, y + 10],
  ]);
/** A request the test keeps in flight until it calls `release`. */
function held(): { promise: Promise<null>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<null>((r) => (release = () => r(null)));
  return { promise, release };
}

async function withPen(stub: Parameters<typeof stubInk>[0] = {}): Promise<Call[]> {
  const calls = stubInk(stub);
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
  return calls;
}

describe('answers that stop or refuse', () => {
  it('a POST answered 404 says the page was deleted elsewhere, and nothing more is sent', async () => {
    const calls = await withPen({
      respond: (c) => (c.method === 'POST' ? answer(404, 'no such page') : null),
    });
    line(100);
    await screen.findByText(/This page was deleted somewhere else/);
    line(200);
    line(300, 400);
    await settle();
    expect(posts(calls)).toHaveLength(1);
  });

  it('a refused stroke is said once, the rest of its batch is kept, and it is never resent', async () => {
    const first = held();
    let n = 0;
    const calls = await withPen({
      respond: async (c) => {
        if (c.method !== 'POST') return null;
        n += 1;
        if (n === 1) return first.promise; // in flight while two more strokes are drawn
        return xs(c).includes(666) ? answer(422, 'stroke points out of range') : null;
      },
    });
    line(100);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    line(666);
    line(300);
    first.release();
    // The next batch is [666, 300]; refused, it is sent again one by one.
    await waitFor(() => expect(posts(calls)).toHaveLength(4));
    expect(posts(calls).map(xs)).toEqual([[100], [666, 300], [666], [300]]);
    await screen.findByText('A stroke could not be saved: stroke points out of range');
    line(400);
    await waitFor(() => expect(posts(calls)).toHaveLength(5));
    expect(xs(posts(calls)[4]!)).toEqual([400]);
    expect(screen.getAllByText(/A stroke could not be saved/)).toHaveLength(1);
  });
});

describe('undoing a stroke whose save failed', () => {
  it('a POST with no good answer (500) may have landed: undo DELETEs it and clears the notice', async () => {
    const calls = await withPen({ failPosts: 1 });
    line(100);
    await screen.findByText(/Not saved yet: 1 edit could not be sent/);
    const id = ids(posts(calls))[0]!;
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(deletes(calls).map((c) => c.path)).toEqual([`${STROKES}/${id}`]));
    await waitFor(() => expect(screen.queryByText(/Not saved yet/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a POST the server answered 400 did not land: undo sends nothing and clears the notice', async () => {
    const calls = await withPen({
      respond: (c) => (c.method === 'POST' ? answer(400) : null),
    });
    line(100);
    await screen.findByText(/Not saved yet: 1 edit could not be sent/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByText(/Not saved yet/)).toBeNull());
    await settle();
    expect(deletes(calls)).toHaveLength(0);
  });
});

describe('leaving the page', () => {
  it('a hidden tab sends owed ink with keepalive, reserved from the shared budget', async () => {
    const second = held();
    let n = 0;
    const calls = await withPen({
      respond: async (c) => {
        if (c.method !== 'POST') return null;
        n += 1;
        if (n === 1) return answer(500);
        await second.promise;
        return null;
      },
    });
    line(100);
    await screen.findByText(/Not saved yet/);
    setVisibility('hidden');
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    const resent = posts(calls)[1]!;
    expect(resent.keepalive).toBe(true);
    expect(keepaliveLeft()).toBe(KEEPALIVE_CAP - bytes(resent)); // held while it is in flight
    second.release();
    await waitFor(() => expect(keepaliveLeft()).toBe(KEEPALIVE_CAP));
  });

  it('on pagehide every owed stroke goes at once, keepalive for what a long note leaves', async () => {
    const calls = await withPen({ failPosts: 1000 });
    for (let i = 0; i < 12; i += 1) line(100 + i * 40);
    await waitFor(() => expect(sent(posts(calls).at(-1)!)).toHaveLength(12));
    await settle();
    const owed = ids([posts(calls).at(-1)!]);
    // A note being typed that takes nearly the whole keepalive budget.
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const editor = await screen.findByRole('textbox', { name: 'Typed note' });
    fireEvent.change(editor, { target: { value: 'x'.repeat(60_000) } });
    expect(closeWarns()).toBe(true); // the note and the ink together are more than keepalive takes

    const before = calls.length;
    window.dispatchEvent(new Event('pagehide'));
    // No await: what is not started inside pagehide never goes on a real unload.
    const leaving = calls.slice(before).filter((c) => c.method === 'POST');
    const ink = leaving.filter((c) => c.path === STROKES);
    expect(ids(ink).sort()).toEqual([...owed].sort()); // every owed stroke, each once
    const kept = leaving.filter((c) => c.keepalive);
    expect(kept.some((c) => c.path !== STROKES)).toBe(true); // the note went first, with keepalive
    expect(kept.filter((c) => c.path === STROKES).length).toBeGreaterThan(0);
    expect(ink.some((c) => !c.keepalive)).toBe(true); // the rest: best effort, warned about
    expect(kept.reduce((total, c) => total + bytes(c), 0)).toBeLessThanOrEqual(KEEPALIVE_CAP);
  });

  it('does not warn for a little owed ink, and warns for one stroke too long for keepalive', async () => {
    let failing = true;
    const calls = await withPen({
      respond: (c) => (c.method === 'POST' && failing ? answer(500) : null),
    });
    line(100);
    await screen.findByText(/Not saved yet/);
    expect(closeWarns()).toBe(false);
    // 9,000 points that jump across the page: about 70 KB on the wire, past the 60 KB budget.
    drag(
      Array.from({ length: 9000 }, (_, i): [number, number] =>
        i % 2 === 0 ? [20, 100 + (i % 7)] : [920, 1300 - (i % 5)],
      ),
    );
    await waitFor(() => expect(sent(posts(calls).at(-1)!)).toHaveLength(2));
    expect(closeWarns()).toBe(true);
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Not saved/)).toBeNull());
    expect(closeWarns()).toBe(false);
  });
});
