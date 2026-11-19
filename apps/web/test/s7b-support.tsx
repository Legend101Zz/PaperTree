/**
 * The S7b plate specs' harness (#217): the REAL `useExplainActions` and explain panel inside a real
 * `ReaderActionsProvider` behind the header's Explain toggle, and two buttons that switch threads
 * (the controller's `selectThread`, as the thread menu calls it). A plate reaches the panel the two
 * ways it still can: as a STORED diagram thread (the recorded read), and as a Redraw of it, whose
 * SSE is a recorded faux run's. (The reader no longer starts a diagram thread, #339.) Only `fetch`
 * and `focusAnchor` are fakes. Not a spec.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';
import { vi } from 'vitest';

import { sendToCanvas } from '@/components/canvas/sendToCanvas';
import { useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';

import { HeaderAndPanel } from './explain-toggle';
import { plateFrames } from './fixtures/diagram-plate';
import storedThread from './fixtures/diagram-thread.json';
import { TestQueryProvider } from './query-client';
import { installFetch, jsonResponse, sseResponse } from './s6-support';

import type { DiagramPart, Thread } from '@/lib/api/types';

export const PAPER = 'ppr_G9AYN750E5MG1NRBMGSQJ4N5JM';
export const THREAD = 'thr_01M536X6ADZ62TFKAZWW548BN8';
export const RUN = 'run_01M536X6ADDT1C3RNGGY9WBWHM';
export const focusAnchor = vi.fn();

function Reader(): ReactNode {
  const explain = useExplainActions({ paperId: PAPER });
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain: explain.openExplain,
      // The real send: the board read, then the node, through the stubbed fetch.
      sendToCanvas: (input) => sendToCanvas(PAPER, input),
      focusAnchor: (anchor, opts) => focusAnchor(anchor, opts),
    }),
    [explain.openExplain],
  );
  return (
    <ReaderActionsProvider value={actions}>
      <button
        type="button"
        onClick={() =>
          explain.selectThread({
            ...(storedThread.thread as unknown as Thread),
            thread_id: 'thr_other',
            kind: 'explain',
          })
        }
      >
        switch away
      </button>
      <button
        type="button"
        onClick={() => explain.selectThread(storedThread.thread as unknown as Thread)}
      >
        switch back
      </button>
      <HeaderAndPanel explain={explain} />
    </ReaderActionsProvider>
  );
}

/** Mount the reader stand-in on the recorded diagram thread (the panel reads it from the API). */
export function mount(): void {
  render(
    <TestQueryProvider>
      <Reader />
    </TestQueryProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'switch back' }));
}

/**
 * Mount on the stored plate, wait for it, and press its Redraw: Plate 2 streams in under its own
 * ask from the recorded run `routes` serves.
 *
 * @returns The explain panel.
 */
export async function mountRedrawing(): Promise<HTMLElement> {
  mount();
  const panel = await screen.findByRole('complementary', { name: 'Explain' });
  fireEvent.click(await within(panel).findByRole('button', { name: 'Redraw' }));
  return panel;
}

/** The nth exchange of the panel (0 = Plate 1 as stored, 1 = Plate 2 as redrawn). */
export const exchange = (panel: HTMLElement, n: number): HTMLElement =>
  panel.querySelectorAll<HTMLElement>('.pt-exchange--diagram')[n] as HTMLElement;

/** A stored read of the diagram thread: what the server keeps. */
export interface StoredRead {
  readonly thread: unknown;
  readonly messages: { status: string; diagram?: { status: string; parts: unknown[] } }[];
}

/** The faux bad run's thread: its frames are re-addressed to `THREAD` when used as a Redraw. */
export const BAD_RUN = 'run_01M536XJMQ7TYFG50M6CPHD36C';
export const BAD_THREAD = 'thr_01M536XJMQX7900YB9C2S1R819';

/** The panel's routes: the Redraw stream (held, or whole), the cancel, the reads, the board. */
export function routes(
  stream: (signal: AbortSignal | null) => Response = (signal) =>
    sseResponse(
      plateFrames('diagram-plate-bad').map((f) => f.replaceAll(BAD_THREAD, THREAD)),
      {
        signal,
      },
    ),
  stored: StoredRead = storedThread,
  extra: Parameters<typeof installFetch>[0] = {},
) {
  return installFetch({
    [`POST /runs/${RUN}/cancel`]: () => jsonResponse(202, {}),
    [`POST /runs/${BAD_RUN}/cancel`]: () => jsonResponse(202, {}),
    [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [stored.thread]),
    [`GET /papers/${PAPER}/threads/${THREAD}`]: () => jsonResponse(200, stored),
    // A Redraw's plate: by default the bad run's frames, as a turn of THIS thread.
    [`POST /papers/${PAPER}/threads/${THREAD}/messages`]: (_call, signal) => stream(signal),
    [`GET /papers/${PAPER}/board`]: () => jsonResponse(200, { board: null, nodes: [], edges: [] }),
    [`POST /papers/${PAPER}/board/nodes`]: (call) =>
      jsonResponse(201, { board: { board_id: 'brd_1' }, node: call.body }),
    ...extra,
  });
}

/** The key's part rows, in order. */
export const keyRows = (root: ParentNode = document): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-letter]'));
/** A part box's y in the drawing (a slot that moved changes it). */
export const box = (letter: string, root: ParentNode = document) =>
  root.querySelector(`[data-part="${letter}"] .pt-plate__box`)?.getAttribute('y');

/**
 * The recorded stored read with one part changed, or with the plate stopped at `keep` parts.
 *
 * @param change The change to the stored plate's parts.
 * @param status The answer's stored status.
 * @returns The read.
 */
export function storedWith(
  change: (parts: DiagramPart[]) => DiagramPart[],
  status = 'complete',
): StoredRead {
  const copy = structuredClone(storedThread) as StoredRead;
  const answer = copy.messages[1];
  if (answer?.diagram === undefined) throw new Error('the recorded thread has no plate');
  answer.status = status;
  answer.diagram.parts = change(answer.diagram.parts as DiagramPart[]);
  return copy;
}

/**
 * The stored read after a Redraw (Plate 2) was stopped before its first part: the recorded Plate 1,
 * the Redraw's ask, and an `aborted` answer with no part, under the ids of the bad run's frames.
 */
export function redrawStoppedEmpty(): StoredRead {
  const copy = structuredClone(storedThread) as unknown as {
    thread: unknown;
    messages: Record<string, unknown>[];
  };
  const [ask, plate] = copy.messages as [Record<string, unknown>, Record<string, unknown>];
  const answer = structuredClone(plate) as { diagram: { status: string; parts: unknown[] } };
  answer.diagram.status = 'stopped';
  answer.diagram.parts = [];
  copy.messages.push(
    {
      ...ask,
      message_id: 'msg_01M536XJMQHV024A13MK8WTT86',
      ordinal: 2,
      content: 'Redraw the diagram.',
    },
    {
      ...answer,
      message_id: 'msg_01M536XJMQ3RXM94FQ9A74JA02',
      ordinal: 3,
      status: 'aborted',
    },
  );
  return copy as unknown as StoredRead;
}
