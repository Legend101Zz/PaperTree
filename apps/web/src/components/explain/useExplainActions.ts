'use client';

/**
 * explain/useExplainActions — the `openExplain` half of `ReaderActions` (contracts.md §5).
 *
 * S0 STUB, owned by S6. It holds exactly one piece of state — what the panel is open on — and does
 * NOTHING over the network: `openExplain` opens `<ExplainPanel>`'s placeholder and nothing is
 * sent. S6 replaces the body (threads, streaming, follow-ups) behind the same return type, so the
 * mount lines in `ReaderWorkspace` never change.
 *
 * The controller is handed to `<ExplainPanel controller={…}/>` as ONE opaque prop, so S6 can grow
 * it without touching the workspace (which S4 owns).
 */
import { useCallback, useMemo, useState } from 'react';

import type { Anchor } from '@papertree/anchoring';

export interface ExplainRequest {
  readonly anchor: Anchor;
  /** The exact selected text, verbatim — the paper's words, rendered in the paper's register. */
  readonly quote: string;
}

export interface ExplainController {
  /** The API paper, or `null` for a fixture paper, which no server can be asked about. */
  readonly paperId: string | null;
  /** What the panel is open on; `null` means closed. */
  readonly request: ExplainRequest | null;
  readonly openExplain: (input: ExplainRequest) => void;
  readonly closeExplain: () => void;
}

export function useExplainActions(options: { readonly paperId: string | null }): ExplainController {
  const { paperId } = options;
  const [request, setRequest] = useState<ExplainRequest | null>(null);

  const openExplain = useCallback((input: ExplainRequest) => {
    setRequest({ anchor: input.anchor, quote: input.quote });
  }, []);
  const closeExplain = useCallback(() => setRequest(null), []);

  return useMemo(
    () => ({ paperId, request, openExplain, closeExplain }),
    [paperId, request, openExplain, closeExplain],
  );
}
