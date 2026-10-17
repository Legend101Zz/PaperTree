/**
 * s5e-pinned-dive-in.spec — Dive in on the phone sheet's pinned footer (#293, frame 08b), at 390:
 * beside "Send answer 2 to board", a 44 px "Dive in to answer 2" for the answer the sheet ends on;
 * however often it is pressed it sends ONE Dive-in request for that answer and opens its page; the
 * earlier answer keeps its own Dive in in the scroll, at 44 px too.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GOLDEN } from './fixtures/attention-thread';
import { Harness, stubDesktop } from './s6-harness';
import { installFetch, jsonResponse, PAPER } from './s6-support';

const push = vi.fn();
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push, replace: vi.fn() }),
}));

interface HappyWindow {
  readonly happyDOM: { setViewport: (size: { width: number; height: number }) => void };
}

beforeEach(() => {
  (window as unknown as HappyWindow).happyDOM.setViewport({ width: 390, height: 844 });
  stubDesktop(false);
  push.mockReset();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  (window as unknown as HappyWindow).happyDOM.setViewport({ width: 1440, height: 900 });
  vi.unstubAllGlobals();
});

const LAST = GOLDEN.messages[GOLDEN.messages.length - 1]!.message_id;
const CREATE = `POST /papers/${PAPER}/notebook/pages`;

/** The phone sheet on the golden thread (two answers), its create route answering 201. */
async function openSheet(): Promise<{ sheet: HTMLElement; posts: () => unknown[] }> {
  const { calls } = installFetch({
    [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [GOLDEN.thread]),
    [`GET /papers/${PAPER}/threads/${GOLDEN.thread.thread_id}`]: () => jsonResponse(200, GOLDEN),
    [CREATE]: (call) =>
      jsonResponse(201, {
        page: { page_id: (call.body as { page_id: string }).page_id, paper_id: PAPER },
        items: [],
      }),
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
  const sheet = await screen.findByRole('dialog');
  await waitFor(() => expect(within(sheet).getByText(/central proposal/)).toBeTruthy());
  return {
    sheet,
    posts: () => calls.filter((c) => `${c.method} ${c.path}` === CREATE).map((c) => c.body),
  };
}

describe('Dive in on the pinned phone footer (08b)', () => {
  it('sits beside To board for the last answer, 44 px, and sends one request', async () => {
    const { sheet, posts } = await openSheet();
    const pinned = within(sheet.querySelector<HTMLElement>('[data-pinned-footer]')!);
    const dive = pinned.getByRole('button', { name: 'Dive in to answer 2' });
    expect(
      pinned.getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['Dive in to answer 2', 'Send answer 2 to board']);
    expect(dive.style.minHeight).toBe('44px');
    fireEvent.click(dive);
    fireEvent.click(dive);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const id = LAST.slice(LAST.indexOf('_') + 1);
    expect(posts()).toEqual([{ page_id: `np_${id}`, from_message_id: LAST }]);
    expect(push).toHaveBeenCalledWith(`/paper/${PAPER}/notebook/np_${id}`);
  });

  it('leaves the earlier answer its own 44 px Dive in in the scroll', async () => {
    const { sheet } = await openSheet();
    const scroll = within(sheet.querySelector<HTMLElement>('.pt-explain__scroll')!);
    const own = scroll.getByRole('button', { name: 'Dive in' });
    expect(own.style.minHeight).toBe('44px');
  });
});
