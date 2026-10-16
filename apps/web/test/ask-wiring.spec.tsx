/**
 * explain/ask-wiring.spec — the explain panel talks to the real `/threads` routes and shows what
 * came back, honestly (rewritten in S6; the old file tested the Inspector's `/ask` source, R12).
 *
 * `fetch` is the only stub. The hook, the reducer, the SSE reader and the panel are the real ones,
 * so what each test asserts is what a reader would see after the same bytes arrived.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { focusAnchor, Harness, sendToCanvas, stubDesktop } from './s6-harness';
import {
  citation,
  done,
  errorBody,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  status,
  text,
  usage,
  frame,
} from './s6-support';

beforeEach(() => {
  stubDesktop();
  focusAnchor.mockReset();
  sendToCanvas.mockClear();
  window.localStorage.setItem('papertree.session', 'test-token');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const THREADS = `POST /papers/${PAPER}/threads`;
const MESSAGES = `POST /papers/${PAPER}/threads/thr_1/messages`;

function answerFrames(extra: string[] = []): string[] {
  return [
    run(),
    status({ phase: 'tool', label: 'Reading p. 4 · §2.1' }),
    text('YOLO frames detection as one regression problem [b1]'),
    text(', and the grid cell holds the centre [b2].'),
    frame('citations', { items: [citation('b1'), citation('b2', { supported: false })] }),
    usage(),
    done(),
    ...extra,
  ];
}

async function ask(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'ask one' }));
}

describe('Ask: a streamed answer with markers, a usage line and nothing raw', () => {
  it('POSTs an explain thread with the anchor, streams, then shows markers that flash the passage', async () => {
    const { calls } = installFetch({
      [THREADS]: (_c, signal) => sseResponse(answerFrames(), { signal }),
    });
    render(<Harness />);
    await ask();

    await waitFor(() => expect(screen.getByText(/YOLO frames detection/)).toBeTruthy());
    const post = calls.find((c) => c.method === 'POST' && c.path === `/papers/${PAPER}/threads`);
    expect(post?.body).toMatchObject({ kind: 'explain', anchor: { id: 'anchor-sel1' } });
    expect((post?.body as Record<string, unknown>)['question']).toBeUndefined();

    // Deterministic (#252): wait until the answer has settled and its stored re-read has been
    // asked for (a 404 here), so the click below lands on the markers that stay.
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'GET' && c.path === `/papers/${PAPER}/threads/thr_1`),
      ).toBe(true),
    );
    // Both passages arrive with the citations event as numbered markers (#202); the second is
    // not verified, in words.
    const markers = await waitFor(() => {
      const found = document.querySelectorAll('[data-citation-id] button');
      expect(found).toHaveLength(2);
      return found;
    });
    expect(markers[1]?.getAttribute('aria-label')).toBe('Passage 2, p. 4, not verified');
    expect(markers[0]?.getAttribute('aria-label')).toBe('Passage 1, p. 4');

    fireEvent.click(markers[0] as Element);
    expect(focusAnchor).toHaveBeenCalledTimes(1);
    expect(focusAnchor.mock.calls[0]?.[0]).toMatchObject({ id: 'anchor-b1' });
    expect(focusAnchor.mock.calls[0]?.[1]).toEqual({
      flash: true,
      from: { n: 1, page: 4, para: null, notVerified: false },
    });

    // The usage line: tokens and an estimate marker.
    expect(document.querySelector('[data-usage-line]')?.textContent).toBe(
      '1,234 tokens · ≈ $0.0012 (estimate)',
    );

    // The model's words are in the AI's voice; the handles never reach the screen as text.
    const ai = document.querySelector('[data-voice="ai"]');
    expect(ai?.textContent).toContain('YOLO frames detection');
    expect(ai?.getAttribute('aria-label')).toMatch(/not the paper's words/);
    const panel = screen.getByRole('complementary', { name: 'Explain' });
    expect(panel.textContent).not.toMatch(/\[b\d+\]|msg_|thr_|run_|blk_|\{"/);
  });

  it('shows the status label while it works, and not the tool or an id', async () => {
    let handle: { push(c: string): void; close(): void } | undefined;
    installFetch({
      [THREADS]: (_c, signal) =>
        sseResponse([run(), status({ phase: 'tool', label: 'Reading p. 4 · §2.1' })], {
          hold: true,
          signal,
          onHandle: (h) => (handle = h),
        }),
    });
    render(<Harness />);
    await ask();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Reading p. 4 · §2.1'),
    );
    handle?.push(text('Now writing'));
    await waitFor(() => expect(screen.getByText(/Now writing/)).toBeTruthy());
    // Once text flows the tab row says the AI is writing (#204), never the tool.
    expect(screen.getByRole('status').textContent).toBe('Writing…');
    handle?.push(done());
    handle?.close();
  });

  it('a follow-up goes to the thread, with the typed question', async () => {
    const { calls } = installFetch({
      [THREADS]: (_c, signal) => sseResponse(answerFrames(), { signal }),
      [MESSAGES]: (_c, signal) =>
        sseResponse(
          [
            run({ message_id: 'msg_a2' }),
            text('That means one network pass.'),
            done('complete', null, 'msg_a2'),
          ],
          { signal },
        ),
    });
    render(<Harness />);
    await ask();
    await waitFor(() => expect(document.querySelectorAll('[data-citation-id]')).toHaveLength(2));

    fireEvent.change(screen.getByLabelText('Ask a question about this paper'), {
      target: { value: 'What does that mean?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText(/one network pass/)).toBeTruthy());
    const follow = calls.find((c) => c.path === `/papers/${PAPER}/threads/thr_1/messages`);
    expect(follow?.body).toEqual({ question: 'What does that mean?' });
    expect(screen.getByText('What does that mean?')).toBeTruthy();
  });

  it('Send to canvas calls the context action with the message id and reports a failure', async () => {
    installFetch({ [THREADS]: (_c, signal) => sseResponse(answerFrames(), { signal }) });
    render(<Harness />);
    await ask();
    const button = await screen.findByRole('button', { name: 'Send to canvas' });
    fireEvent.click(button);
    await waitFor(() =>
      expect(sendToCanvas).toHaveBeenCalledWith({ kind: 'explanation', messageId: 'msg_a1' }),
    );
    await screen.findByRole('button', { name: 'Sent to canvas' });
  });

  it('Send to canvas failing is said in a sentence, with the button usable again', async () => {
    sendToCanvas.mockRejectedValueOnce(new Error('boom'));
    installFetch({ [THREADS]: (_c, signal) => sseResponse(answerFrames(), { signal }) });
    render(<Harness />);
    await ask();
    fireEvent.click(await screen.findByRole('button', { name: 'Send to canvas' }));
    await screen.findByText("Couldn't send this to the canvas. Try again.");
    expect(
      (screen.getByRole('button', { name: 'Send to canvas' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('Designed errors: a sentence, a next action, the partial text kept', () => {
  it('agent_unavailable before the stream: plain words and a working Retry', async () => {
    let attempt = 0;
    installFetch({
      [THREADS]: (_c, signal) => {
        attempt += 1;
        return attempt === 1
          ? jsonResponse(503, errorBody('agent_unavailable', 'agent down', true))
          : sseResponse(answerFrames(), { signal });
      },
    });
    render(<Harness />);
    await ask();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('AI is not available on this server right now.');
    expect(alert.textContent).not.toContain('agent down');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText(/YOLO frames detection/)).toBeTruthy());
    expect(attempt).toBe(2);
  });

  it('budget_exhausted explains the daily budget and offers no Retry that must fail', async () => {
    installFetch({
      [THREADS]: () => jsonResponse(429, errorBody('budget_exhausted')),
      'GET /usage': () =>
        jsonResponse(200, {
          runs: 9,
          input_tokens: 1,
          output_tokens: 1,
          cost_usd_est: 0.9712,
          budget_usd: 1,
          since: 'x',
          by_kind: {},
        }),
    });
    render(<Harness />);
    await ask();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Daily spend cap reached');
    // An Explain from a selection typed nothing, so nothing is said to be kept in the box.
    expect(alert.textContent).toContain('Nothing was sent to the AI.');
    await waitFor(() =>
      expect(alert.textContent).toContain('≈ $0.97 of $1.00 used in the last 24 hours (estimate).'),
    );
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('not_configured says AI is not available on this server', async () => {
    installFetch({ [THREADS]: () => jsonResponse(503, errorBody('not_configured')) });
    render(<Harness />);
    await ask();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'AI is not available on this server.',
    );
  });

  it('a mid-answer failure keeps the partial text, and Retry re-runs it with retry_of', async () => {
    let n = 0;
    const { calls } = installFetch({
      [THREADS]: (_c, signal) =>
        sseResponse(
          [
            run(),
            text('The first half of the answer'),
            done('error', {
              code: 'upstream_unavailable',
              retryable: true,
              message: 'raw 503 upstream',
            }),
          ],
          { signal },
        ),
      [MESSAGES]: (_c, signal) => {
        n += 1;
        return sseResponse([run(), text('A fresh full answer.'), done()], { signal });
      },
    });
    render(<Harness />);
    await ask();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("The AI service didn't respond.");
    expect(alert.textContent).not.toContain('raw 503');
    expect(screen.getByText(/The first half of the answer/)).toBeTruthy();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('A fresh full answer.')).toBeTruthy());
    expect(n).toBe(1);
    const retry = calls.find((c) => c.path.endsWith('/messages'));
    expect(retry?.body).toMatchObject({ question: 'Explain this passage.', retry_of: 'msg_a1' });
    expect(screen.queryByText(/The first half/)).toBeNull();
  });
});

describe('Stop: cancel the run, abort the stream, keep what arrived', () => {
  it('POSTs /runs/{id}/cancel, marks the text stopped and keeps it', async () => {
    let handle: { push(c: string): void; close(): void } | undefined;
    const { calls } = installFetch({
      [THREADS]: (_c, signal) =>
        sseResponse([run(), text('Half an answer')], {
          hold: true,
          signal,
          onHandle: (h) => (handle = h),
        }),
      'POST /runs/run_1/cancel': () => jsonResponse(202, {}),
    });
    render(<Harness />);
    await ask();
    await waitFor(() => expect(screen.getByText(/Half an answer/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/runs/run_1/cancel')).toBe(true));
    await waitFor(() => expect(document.querySelector('[data-stopped]')).not.toBeNull());
    expect(screen.getByText(/Half an answer/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // A late byte from the aborted stream does not change the kept text.
    try {
      handle?.push(text(' LATE'));
    } catch {
      /* the stream is already errored */
    }
    expect(screen.queryByText(/LATE/)).toBeNull();
  });
});

describe('a paper with no server', () => {
  it('a sample paper says so and sends nothing', async () => {
    const { calls } = installFetch({});
    render(<Harness paperId={null} />);
    await ask();
    expect(screen.getByText(/a sample has no server to ask/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
