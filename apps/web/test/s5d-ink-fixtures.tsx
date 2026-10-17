/**
 * s5d-ink-fixtures — what the S5d ink specs share (#209): a page whose stroke routes answer as the
 * server does (or as a test says), strokes already on it, the mounted `NotebookView`, synthetic
 * pointer drags on the ink surface, and the open answer: an exchange measured taller than its box,
 * so `exchangeShift` pushes the page below it down.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { NotebookView } from '@/features/notebook';
import { strokeToWire } from '@/features/notebook/model/wire';

import { PAGE, PAPER, pageView, stubApi } from './s5c-notebook-fixtures';

import type { Call } from './s5c-notebook-fixtures';
import type { Stroke } from '@/features/notebook/model/stroke';

export const STROKES = `/notebook/pages/${PAGE}/strokes`;

/** The fixture's exchange: `ni_exchange01` at y 48, 320 tall, so its box ends at y 368. */
export const BOX_BOTTOM = 368;

/** Options for `stubInk`. */
export interface InkStub {
  /** Answer the next N stroke POSTs with a 500. */
  readonly failPosts?: number;
  /** Strokes already on the page (and on the server). */
  readonly strokes?: readonly Stroke[];
  /** Answers a stroke call first; null falls through to the server's usual answer. */
  readonly respond?: (call: Call) => Response | Promise<Response | null> | null;
}

/**
 * Stubs `fetch` with the S5c fixture page plus stroke routes that answer as the server does.
 *
 * @param options - Failures, seeded strokes, a custom answer.
 * @returns Every call made, in order.
 */
export function stubInk(options: InkStub = {}): Call[] {
  let fail = options.failPosts ?? 0;
  const view = pageView();
  const strokes = (options.strokes ?? []).map((s) => ({
    ...strokeToWire(s),
    page_id: PAGE,
    created_at: '',
  }));
  return stubApi({ ...view, strokes } as typeof view, async (call) => {
    if (!call.path.startsWith(STROKES)) return null;
    const own = await options.respond?.(call);
    if (own) return own;
    if (call.method === 'DELETE') return new Response(null, { status: 204 });
    if (fail > 0) {
      fail -= 1;
      return new Response(JSON.stringify({ detail: 'down', code: 'internal' }), { status: 500 });
    }
    const added = (call.body as unknown as unknown[]).length;
    return new Response(JSON.stringify({ added }), { status: 201 });
  });
}

/** Mounts the notebook page and waits for its tool bar. */
export async function mount(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotebookView paperId={PAPER} pageId={PAGE} />
    </QueryClientProvider>,
  );
  await screen.findByRole('toolbar', { name: 'Notebook tools' });
}

/** The ink surface (it exists only while a tool is in the hand). */
export function surface(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.pt-nb-surface');
  if (el === null) throw new Error('no ink surface: no tool in the hand');
  return el;
}

const at = (pointerId: number, pointerType: string, p: readonly [number, number]) => ({
  pointerId,
  pointerType,
  clientX: p[0],
  clientY: p[1],
});

/** One pointer, driven step by step (for two pointers at once: a pen and a palm). */
export function pointer(pointerType: string, pointerId: number) {
  return {
    down: (p: readonly [number, number]) =>
      fireEvent.pointerDown(surface(), {
        ...at(pointerId, pointerType, p),
        button: 0,
        pressure: 0.5,
      }),
    move: (p: readonly [number, number]) =>
      fireEvent.pointerMove(surface(), at(pointerId, pointerType, p)),
    up: (p: readonly [number, number]) =>
      fireEvent.pointerUp(surface(), at(pointerId, pointerType, p)),
    cancel: (p: readonly [number, number]) =>
      fireEvent.pointerCancel(surface(), at(pointerId, pointerType, p)),
  };
}

/** A drag on the ink surface through the points, in screen px (page units here: scale 1). */
export function drag(points: [number, number][], pointerType = 'mouse', pointerId = 1): void {
  const hand = pointer(pointerType, pointerId);
  const [first, ...rest] = points;
  hand.down(first!);
  for (const p of rest) hand.move(p);
  hand.up(points.at(-1)!);
}

export const posts = (calls: Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === STROKES);
export const deletes = (calls: Call[]) =>
  calls.filter((c) => c.method === 'DELETE' && c.path.startsWith(`${STROKES}/`));
export const sent = (call: Call) =>
  call.body as unknown as { stroke_id: string; tool: string; colour: string; points_b64: string }[];

/** Lets the fetch stubs answer and React render. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

/**
 * Opens the answer: the exchange measures `height` page units, so everything below its box
 * (`BOX_BOTTOM`) is shown `height - 320` lower. Call before `mount`; undone by `vi.restoreAllMocks`
 * and `vi.unstubAllGlobals`.
 *
 * @param height - The open exchange's measured height.
 */
export function openAnswer(height: number): void {
  const isExchange = (el: Element): boolean =>
    el instanceof HTMLElement && el.dataset['itemId'] === 'ni_exchange01';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly cb: ResizeObserverCallback) {}
      observe(el: Element): void {
        // Only the exchange is measured; after the commit, as a real observer reports.
        if (!isExchange(el)) return;
        const entry = { target: el, contentRect: { height } } as unknown as ResizeObserverEntry;
        queueMicrotask(() => this.cb([entry], this as unknown as ResizeObserver));
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isExchange(this) ? height : 0;
  });
}

/** Dispatches a cancelable `beforeunload`; true when the page asked to warn. */
export function closeWarns(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Sets `document.visibilityState` and says so. */
export function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}
