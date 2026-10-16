/**
 * A tiny reader stand-in for the S6 specs: the REAL `useExplainActions` + `<ExplainPanel>`, inside
 * a real `ReaderActionsProvider`, with a button per thing the reader would call. Only `fetch` and
 * the three reader actions are fakes.
 */
import { useMemo, type ReactNode } from 'react';
import { vi } from 'vitest';

import type { Anchor } from '@papertree/anchoring';

import { ExplainPanel, useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';

import { anchorFixture } from './s6-support';

export const focusAnchor = vi.fn();
export const sendToCanvas = vi.fn(async (_input?: unknown) => undefined);

export function stubDesktop(desktop = true): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

export function Harness({
  paperId = 'ppr_s6test',
}: {
  readonly paperId?: string | null;
}): ReactNode {
  const explain = useExplainActions({ paperId });
  const { openExplain } = explain;
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain,
      sendToCanvas: (input) => sendToCanvas(input),
      focusAnchor: (anchor: Anchor, opts) => focusAnchor(anchor, opts),
    }),
    [openExplain],
  );
  return (
    <ReaderActionsProvider value={actions}>
      <button
        type="button"
        onClick={() =>
          openExplain({
            anchor: anchorFixture('sel1'),
            quote: 'We reframe object detection as a single regression problem.',
          })
        }
      >
        ask one
      </button>
      <button
        type="button"
        onClick={() =>
          openExplain({
            anchor: anchorFixture('sel2'),
            quote: 'Our system divides the input image into an S x S grid.',
          })
        }
      >
        ask two
      </button>
      <ExplainPanel controller={explain} />
    </ReaderActionsProvider>
  );
}
