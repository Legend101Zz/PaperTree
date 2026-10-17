'use client';

/**
 * The reader's half of the notebook's "Ask about this" (S5d, #209): the hand-off taken once into a
 * new ask (`useAskFromNotebook`), and the note that says why the notebook words are in the
 * question box, shown once beside the explain panel (S4d's toast placement: beside the drawer on a
 * wide screen, above the sheet on a phone).
 */
import { Toast } from '@papertree/ui';
import { useLayoutEffect, useState } from 'react';

import { NOTEBOOK_ASK_NOTE, useAskFromNotebook } from '../hooks/useAskFromNotebook';

import type { ExplainController } from '@/components/explain/useExplainActions';
import type { ReactNode } from 'react';

/** Props for `AskFromNotebook`. */
export interface AskFromNotebookProps {
  readonly paperId: string | null;
  readonly controller: Pick<ExplainController, 'startFresh' | 'setDraft'>;
}

/** How much of the window's bottom the explain sheet covers (as `HighlightUndoToast` measures). */
function sheetInset(): number {
  const sheet = document.querySelector('.pt-explain-sheet');
  if (sheet === null) return 0;
  return Math.max(0, window.innerHeight - sheet.getBoundingClientRect().top);
}

/**
 * The note, clear of the explain sheet.
 *
 * @param props - What dismisses it.
 * @param props.onDismiss - Called on Dismiss and when its time is up.
 * @returns The toast.
 */
function AskNote({ onDismiss }: { readonly onDismiss: () => void }): ReactNode {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => setInset(sheetInset()), []);
  return <Toast message={NOTEBOOK_ASK_NOTE} bottomInset={inset} onDismiss={onDismiss} />;
}

/**
 * Ask about this, arriving in the reader.
 *
 * @example
 * <AskFromNotebook paperId={paperId} controller={explain} />
 */
export function AskFromNotebook({ paperId, controller }: AskFromNotebookProps): ReactNode {
  const ask = useAskFromNotebook(paperId, controller);
  return ask.noted ? <AskNote onDismiss={ask.dismiss} /> : null;
}
