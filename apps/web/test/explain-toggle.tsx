/**
 * The reader header with its Explain toggle wired to an explain controller, exactly as
 * `ReaderWorkspace` wires it (#203): the specs open and close the panel the way a reader does,
 * through the header, and the panel gets the toggle's ref for focus return and Esc.
 */
import { useRef, type ReactNode, type RefObject } from 'react';

import { ExplainPanel, type ExplainController } from '@/components/explain';
import { ReaderHeader, type ReaderHeaderProps } from '@/features/reader';

const HEADER: Omit<ReaderHeaderProps, 'explain'> = {
  title: 'A paper',
  page: 0,
  pageCount: 12,
  // Guided draws no zoom control, so its <select> options and <output> status stay out of the
  // panel specs' role queries.
  mode: 'guided',
  onModeChange: () => undefined,
  guidedAvailable: true,
  zoom: 1.25,
  zoomMode: { kind: 'scale', scale: 1.25 },
  onZoomChange: () => undefined,
  navigatorOpen: false,
  navigatorAvailable: true,
  onNavigatorToggle: () => undefined,
  highlightCount: 0,
  boardHref: null,
};

/** The header (with Explain) and the panel, sharing the toggle's ref. */
export function HeaderAndPanel({ explain }: { readonly explain: ExplainController }): ReactNode {
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ExplainHeader explain={explain} toggleRef={toggleRef} />
      <ExplainPanel controller={explain} toggleRef={toggleRef} />
    </>
  );
}

/** Just the header, for a spec that mounts the panel itself. */
export function ExplainHeader({
  explain,
  toggleRef,
}: {
  readonly explain: ExplainController;
  readonly toggleRef: RefObject<HTMLButtonElement>;
}): ReactNode {
  return (
    <ReaderHeader
      {...HEADER}
      explain={{
        open: explain.state.open,
        ref: toggleRef,
        onToggle: (next) => (next ? explain.openPanel() : explain.closeExplain()),
      }}
    />
  );
}
