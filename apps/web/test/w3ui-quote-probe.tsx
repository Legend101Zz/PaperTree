/** A reader stand-in that opens the explain panel with a given quote. */
import { useMemo, type ReactNode } from 'react';

import type { Anchor } from '@papertree/anchoring';

import { useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';

import { HeaderAndPanel } from './explain-toggle';
import { TestQueryProvider } from './query-client';
import { anchorFixture, PAPER } from './s6-support';

export function QuoteProbe({ quote }: { readonly quote: string }): ReactNode {
  const explain = useExplainActions({ paperId: PAPER });
  const { openExplain } = explain;
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain,
      sendToCanvas: async () => undefined,
      focusAnchor: (_a: Anchor) => undefined,
    }),
    [openExplain],
  );
  return (
    <TestQueryProvider>
      <ReaderActionsProvider value={actions}>
        <button type="button" onClick={() => openExplain({ anchor: anchorFixture('q'), quote })}>
          open
        </button>
        <HeaderAndPanel explain={explain} />
      </ReaderActionsProvider>
    </TestQueryProvider>
  );
}
