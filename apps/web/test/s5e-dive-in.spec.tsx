/**
 * s5e-dive-in.spec — Dive in from the explain panel as a person uses it (#210): the button on the
 * answer's footer calls S5a's Dive-in route ONCE however often it is pressed while that is under
 * way, and navigates to the page; a second Dive in on the same answer sends the same derived page
 * id, so the idempotent route answers with the page already there and the same page opens; a
 * refusal is said and nothing navigates; the cards lift for --pt-dur-quick before the route
 * changes. Back to the paper then reopens the explain panel on the dived thread.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOLDEN, goldenMessages } from './fixtures/attention-thread';
import { installFetch, jsonResponse } from './s6-support';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import { Exchange } from '@/features/explain/components/Exchange';
import { buildExchanges, type Exchange as ExchangeModel } from '@/features/explain/model/exchange';
import { diveHandoff, useDiveIn } from '@/features/notebook/hooks/useDiveIn';
import { useThreadFromNotebook } from '@/features/notebook/hooks/useThreadFromNotebook';
import { readerHref } from '@/features/notebook/model/links';
import type { Thread } from '@/lib/api/types';

import type { ReactNode } from 'react';

const push = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  usePathname: () => '/paper/x/read',
  useSearchParams: () => search,
}));

/** What the app router gives `useDiveIn` (it reads the router's context). */
const ROUTER = {
  push,
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

const PAPER = 'ppr_G9AYN750E5MG1NRBMGSQJ4N5JM';
const ANSWER = 'msg_01M508X9PCVH6CHJJDJEGDTC7V';
const PAGE = 'np_01M508X9PCVH6CHJJDJEGDTC7V';
const CREATE = `POST /papers/${PAPER}/notebook/pages`;

beforeEach(() => {
  push.mockReset();
  search = new URLSearchParams();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function provider(children: ReactNode): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <AppRouterContext.Provider value={ROUTER}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AppRouterContext.Provider>
  );
}

/** The golden thread's first exchange, as the panel shows it, with Dive in wired to the hook. */
function Panel(): ReactNode {
  const { diveIn } = useDiveIn(PAPER);
  const [exchange] = buildExchanges(goldenMessages(), null);
  return (
    <Exchange
      exchange={exchange as ExchangeModel<ViewMessage>}
      initial="M"
      onShow={() => undefined}
      onRetry={() => undefined}
      onStop={() => undefined}
      onSendToCanvas={async () => undefined}
      {...(diveIn === null ? {} : { onDiveIn: diveIn })}
    />
  );
}

/** The route as S5a answers: 201 with the page, the same page for an id it already holds. */
function stubCreate(status = 201): ReturnType<typeof installFetch> {
  return installFetch({
    [CREATE]: (call) => {
      const body = call.body as { page_id: string };
      return status === 201
        ? jsonResponse(201, { page: { page_id: body.page_id, paper_id: PAPER }, items: [] })
        : jsonResponse(status, { detail: 'down', code: 'internal', retryable: true });
    },
  });
}

describe('Dive in', () => {
  it('sits first on the answer’s footer, before Send to board', () => {
    stubCreate();
    render(provider(<Panel />));
    const actions = document.querySelector('.pt-exchange__actions');
    const names = [...(actions?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    expect(names).toEqual(['Dive in', 'Send to board']);
  });

  it('calls the Dive-in route once, however often it is pressed, then opens the page', async () => {
    const { calls } = stubCreate();
    render(provider(<Panel />));
    const button = screen.getByRole('button', { name: 'Dive in' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(
      screen.getByRole('button', { name: 'Opening the page…' }).getAttribute('aria-disabled'),
    ).toBe('true');
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const creates = calls.filter((c) => `${c.method} ${c.path}` === CREATE);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body).toEqual({ page_id: PAGE, from_message_id: ANSWER });
    expect(push).toHaveBeenCalledWith(`/paper/${PAPER}/notebook/${PAGE}`);
  });

  it('joins a Dive in already under way instead of sending another', async () => {
    const { calls } = stubCreate();
    const { result } = renderHook(() => useDiveIn(PAPER), {
      wrapper: ({ children }) => provider(children),
    });
    const dive = result.current.diveIn!;
    const a = dive(ANSWER, null);
    const b = dive(ANSWER, null);
    expect(b).toBe(a);
    await act(() => a);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('is not offered where there is no notebook: a sample paper, or no app router', () => {
    stubCreate();
    const sample = renderHook(() => useDiveIn(null), {
      wrapper: ({ children }) => provider(children),
    });
    expect(sample.result.current.diveIn).toBeNull();
    const bare = renderHook(() => useDiveIn(PAPER));
    expect(bare.result.current.diveIn).toBeNull();
    render(
      <Exchange
        exchange={buildExchanges(goldenMessages(), null)[0] as ExchangeModel<ViewMessage>}
        initial="M"
        onShow={() => undefined}
        onRetry={() => undefined}
        onStop={() => undefined}
        onSendToCanvas={async () => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Dive in' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send to board' })).toBeTruthy();
  });

  it('opens the page already made on a second Dive in: the same id, so no second page', async () => {
    const { calls } = stubCreate();
    const first = render(provider(<Panel />));
    fireEvent.click(screen.getByRole('button', { name: 'Dive in' }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    first.unmount(); // the reader left; Back to the paper mounts the panel again
    render(provider(<Panel />));
    fireEvent.click(screen.getByRole('button', { name: 'Dive in' }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    const ids = calls
      .filter((c) => c.method === 'POST')
      .map((c) => (c.body as { page_id: string }).page_id);
    expect(ids).toEqual([PAGE, PAGE]);
    expect(push.mock.calls).toEqual([
      [`/paper/${PAPER}/notebook/${PAGE}`],
      [`/paper/${PAPER}/notebook/${PAGE}`],
    ]);
  });

  it('says when the page could not be made, navigates nowhere, and can be tried again', async () => {
    stubCreate(500);
    render(provider(<Panel />));
    fireEvent.click(screen.getByRole('button', { name: 'Dive in' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t open a notebook page for this answer. Try again.',
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Dive in' }).hasAttribute('aria-disabled')).toBe(
      false,
    );
    expect(document.querySelector('.pt-exchange')?.hasAttribute('data-dive')).toBe(false);
  });

  it('lifts the exchange for --pt-dur-quick before the route changes, and hands its cards on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubCreate();
    render(provider(<Panel />));
    fireEvent.click(screen.getByRole('button', { name: 'Dive in' }));
    expect(document.querySelector('.pt-exchange')?.getAttribute('data-dive')).toBe('lift');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });
    expect(push).not.toHaveBeenCalled(); // still lifting: 120 ms by the token's fallback
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(push).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    const hand = diveHandoff.take(PAGE, Date.now());
    expect(hand?.cards.map((c) => c.key)).toEqual([
      'call',
      'ai',
      'passage-1',
      'passage-2',
      'passage-3',
      'passage-4',
    ]);
  });
});

describe('Back to the paper', () => {
  it('names the dived thread in the reader’s link', () => {
    expect(
      readerHref(PAPER, { pageId: PAGE, itemId: 'ni_1' }, 'thr_01M508X9PC9K9HKHSVB2J9W1A1'),
    ).toBe(`/paper/${PAPER}/read?nb=${PAGE}&item=ni_1&thread=thr_01M508X9PC9K9HKHSVB2J9W1A1`);
    expect(readerHref(PAPER)).toBe(`/paper/${PAPER}/read`);
  });

  it('opens the explain panel on that thread, once', async () => {
    const thread = GOLDEN.thread as Thread;
    installFetch({ [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [thread]) });
    search = new URLSearchParams({ thread: thread.thread_id });
    const select = vi.fn();
    function Reader(): ReactNode {
      useThreadFromNotebook(PAPER, select);
      return null;
    }
    const view = render(provider(<Reader />));
    await waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    expect(select.mock.calls[0]![0]).toMatchObject({ thread_id: thread.thread_id });
    view.rerender(provider(<Reader />));
    await new Promise((done) => setTimeout(done, 20));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('leaves the panel closed for a thread that is gone', async () => {
    installFetch({ [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, []) });
    search = new URLSearchParams({ thread: 'thr_gone' });
    const select = vi.fn();
    function Reader(): ReactNode {
      useThreadFromNotebook(PAPER, select);
      return null;
    }
    render(provider(<Reader />));
    await new Promise((done) => setTimeout(done, 30));
    expect(select).not.toHaveBeenCalled();
  });
});
