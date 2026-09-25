'use client';

/**
 * explain — the explain panel (contracts.md §5). S0 STUB, owned by S6.
 *
 * `<ExplainPanel>` is mounted by `ReaderWorkspace` and renders nothing until `openExplain` is
 * called. Then it shows a PLACEHOLDER: the selected passage, in the paper's own register
 * (`PaperText`, because it is the paper's words), and a plain statement that explanations are not
 * wired yet. It sends nothing, and it shows no ⊙: there is no model output here to mark.
 */
import type { Anchor } from '@papertree/anchoring';
import { PaperText } from '@papertree/ui';

import type { ExplainController } from './useExplainActions';

export type { ExplainController, ExplainRequest } from './useExplainActions';
export { useExplainActions } from './useExplainActions';

export interface ExplainPanelProps {
  readonly controller: ExplainController;
}

export function ExplainPanel({ controller }: ExplainPanelProps) {
  const { request, closeExplain } = controller;
  if (request === null) return null;

  return (
    <aside
      aria-label="Explain"
      data-explain-panel="placeholder"
      className="fixed inset-x-0 bottom-0 z-30 max-h-[60dvh] overflow-y-auto border-t bg-[--pt-panel-ground] p-4 shadow-lg md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[420px] md:border-l md:border-t-0"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Explain</h2>
        <button
          type="button"
          className="flex h-11 min-w-11 items-center justify-center rounded px-3 text-sm"
          onPointerUp={closeExplain}
          onClick={(event) => {
            if (event.detail === 0) closeExplain();
          }}
        >
          Close
        </button>
      </header>
      <PaperText as="blockquote" pageLabel={pageLabelOf(request.anchor)}>
        {request.quote}
      </PaperText>
      <p role="status" className="mt-3 text-sm opacity-80">
        Explanations are not connected yet. Nothing was sent.
      </p>
    </aside>
  );
}

/** "p. 4" from the anchor's own PageSelector — the paper's label if it has one, else 1-based. */
function pageLabelOf(anchor: Anchor): string | undefined {
  for (const selector of anchor.selectors) {
    if (selector.type === 'PageSelector') {
      return `p. ${selector.label ?? String(selector.index + 1)}`;
    }
  }
  return undefined;
}
