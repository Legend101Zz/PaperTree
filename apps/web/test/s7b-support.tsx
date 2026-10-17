/**
 * The S7b plate specs' harness (#217): the REAL `useExplainActions` and explain panel inside a real
 * `ReaderActionsProvider` behind the header's Explain toggle, a button that starts a diagram, and
 * one that switches to another thread (the controller's `selectThread`, as the thread menu calls
 * it). Only `fetch` and `focusAnchor` are fakes; the SSE is the recorded faux runs'. Not a spec.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';
import { vi } from 'vitest';

import { sendToCanvas } from '@/components/canvas/sendToCanvas';
import { useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';

import { HeaderAndPanel } from './explain-toggle';
import { plateFrames } from './fixtures/diagram-plate';
import storedThread from './fixtures/diagram-thread.json';
import { TestQueryProvider } from './query-client';
import { anchorFixture, installFetch, jsonResponse, sseResponse } from './s6-support';

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
      explainWithDiagram: explain.openDiagram,
      // The real send: the board read, then the node, through the stubbed fetch.
      sendToCanvas: (input) => sendToCanvas(PAPER, input),
      focusAnchor: (anchor, opts) => focusAnchor(anchor, opts),
    }),
    [explain.openExplain, explain.openDiagram],
  );
  return (
    <ReaderActionsProvider value={actions}>
      <button
        type="button"
        onClick={() =>
          actions.explainWithDiagram?.({
            anchor: anchorFixture('sel'),
            quote: 'We call our particular attention "Scaled Dot-Product Attention" (Figure 2).',
          })
        }
      >
        draw
      </button>
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

/** Mount the reader stand-in and start a diagram on the selection. */
export function mount(): void {
  render(
    <TestQueryProvider>
      <Reader />
    </TestQueryProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'draw' }));
}

/** The stored read after a Stop at three parts: what the server keeps (status `aborted`). */
export interface StoredRead {
  readonly thread: unknown;
  readonly messages: { status: string; diagram?: { status: string; parts: unknown[] } }[];
}
/** The recorded stored read as the server keeps it after a Stop at three parts. */
export function stoppedAtThree(): StoredRead {
  const copy = structuredClone(storedThread) as StoredRead;
  const answer = copy.messages[1];
  if (answer?.diagram === undefined) throw new Error('the recorded thread has no plate');
  answer.status = 'aborted';
  answer.diagram.status = 'stopped';
  answer.diagram.parts = answer.diagram.parts.slice(0, 3);
  return copy;
}

/** The faux bad run's thread: its frames are re-addressed to `THREAD` when used as a Redraw. */
export const BAD_THREAD = 'thr_01M536XJMQX7900YB9C2S1R819';

/** The panel's routes: the diagram stream (held, or whole), the cancel, the reads, the board. */
export function routes(
  stream: (signal: AbortSignal | null) => Response,
  stored: StoredRead = storedThread,
  extra: Parameters<typeof installFetch>[0] = {},
) {
  return installFetch({
    [`POST /papers/${PAPER}/threads`]: (_call, signal) => stream(signal),
    [`POST /runs/${RUN}/cancel`]: () => jsonResponse(202, {}),
    [`GET /papers/${PAPER}/threads`]: () => jsonResponse(200, [stored.thread]),
    [`GET /papers/${PAPER}/threads/${THREAD}`]: () => jsonResponse(200, stored),
    [`POST /papers/${PAPER}/threads/${THREAD}/messages`]: (_call, signal) =>
      // A Redraw's plate: the bad run's frames, as a turn of THIS thread.
      sseResponse(
        plateFrames('diagram-plate-bad').map((f) => f.replaceAll(BAD_THREAD, THREAD)),
        { signal },
      ),
    [`GET /papers/${PAPER}/board`]: () => jsonResponse(200, { board: null, nodes: [], edges: [] }),
    [`POST /papers/${PAPER}/board/nodes`]: (call) =>
      jsonResponse(201, { board: { board_id: 'brd_1' }, node: call.body }),
    ...extra,
  });
}

/** The key's part rows, in order. */
export const keyRows = (): HTMLElement[] => Array.from(document.querySelectorAll('[data-letter]'));
/** A part box's y in the drawing (a slot that moved changes it). */
export const box = (letter: string) =>
  document.querySelector(`[data-part="${letter}"] .pt-plate__box`)?.getAttribute('y');

/**
 * Recorded frames with one part changed (both the live frame and, through `storedWith`, its stored
 * copy), for the cases the faux runs do not record.
 *
 * @param frames The recorded frames.
 * @param letter The part to change.
 * @param change The change.
 * @returns The frames.
 */
export function withPart(
  frames: readonly string[],
  letter: string,
  change: (part: DiagramPart) => DiagramPart,
): string[] {
  return frames.map((frame) => {
    if (!frame.startsWith('event: part')) return frame;
    const data = JSON.parse(frame.slice(frame.indexOf('data: ') + 6)) as DiagramPart;
    return data.letter === letter
      ? `event: part\ndata: ${JSON.stringify(change(data))}\n\n`
      : frame;
  });
}

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
