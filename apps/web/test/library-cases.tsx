/**
 * The rendered cases both audits share.
 *
 * Not a `.spec.` file, so vitest does not collect it. `touch.spec.tsx` and `a11y.spec.tsx` import
 * the SAME list on purpose: if the two audits could drift apart on what they cover, the honest
 * summary of either one would be "these components, minus whichever ones I forgot".
 *
 * One paper per processing state, so every state-conditional control — the retry button, the
 * partial hint, the audio badge — actually renders and gets audited.
 */

import { fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import {
  EmptyLibrary,
  FailureState,
  OfflineState,
  ParsingState,
  PartialState,
  UncertaintyState,
} from '@/components/library/SystemStates';
import type { LibraryPaper } from '@/components/library/types';
import { AddPapers } from '@/features/library/components/AddPapers';
import { CatalogueCard } from '@/features/library/components/CatalogueCard';
import { UploadRow } from '@/features/library/components/UploadRow';
import {
  useUploadQueue,
  type UploadQueue,
  type UploadQueueOptions,
} from '@/features/library/hooks/useUploadQueue';

export const TOUCH_TARGET_MIN_PX = 44;

export const PAPERS: readonly LibraryPaper[] = [
  {
    id: 'p-pending',
    title: 'Queued paper',
    authors: ['A. Author'],
    pageCount: 12,
    pagesParsed: 0,
    readingProgress: 0,
    processing: 'pending',
    highlightCount: 0,
    addedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'p-parsing',
    title: 'Paper being read',
    authors: ['B. Author', 'C. Author', 'D. Author', 'E. Author'],
    pageCount: 12,
    pagesParsed: 5,
    readingProgress: 0.1,
    processing: 'parsing',
    highlightCount: 1,
    addedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'p-partial',
    title: 'Partly read paper',
    authors: [],
    pageCount: 18,
    pagesParsed: 3,
    readingProgress: 0.25,
    processing: 'partial',
    partialReason: 'Only pages 0-2 of the 18-page source PDF are parsed.',
    highlightCount: 4,
    addedAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'p-complete',
    title: 'Fully read paper',
    authors: ['F. Author'],
    pageCount: 9,
    pagesParsed: 9,
    readingProgress: 0.75,
    processing: 'complete',
    highlightCount: 22,
    addedAt: '2026-01-04T00:00:00.000Z',
  },
  {
    id: 'p-failed',
    title: 'Paper that failed to parse',
    authors: ['G. Author'],
    pageCount: 30,
    pagesParsed: 11,
    readingProgress: 0,
    processing: 'failed',
    failedStep: 'equation crops',
    highlightCount: 0,
    addedAt: '2026-01-05T00:00:00.000Z',
  },
];

const noop = (): void => {};
const noopAsync = async (): Promise<void> => {};

/** A queue in every state, so the upload row's Cancel and Dismiss are all audited (#195). */
const QUEUE: UploadQueue = {
  items: [
    { id: 'u1', fileName: 'queued.pdf', sizeBytes: 2048, progress: 0, state: 'queued' },
    { id: 'u2', fileName: 'going.pdf', sizeBytes: 4096, progress: 0.4, state: 'uploading' },
    { id: 'u3', fileName: 'bad.pdf', sizeBytes: 10, progress: 0, state: 'failed', error: 'x' },
    { id: 'u4', fileName: 'gone.pdf', sizeBytes: 10, progress: 0, state: 'cancelled' },
  ],
  rejections: [{ id: 'u5', fileName: 'notes.txt', reason: 'is not a PDF.' }],
  announcement: '',
  enqueue: noop,
  cancel: noop,
  dismiss: noop,
};

/**
 * The library's upload path without the page: Add papers feeding the queue, and the row under the
 * header. The queue tests (StrictMode, Cancel's truth, refusals) render this.
 */
export function UploadHarness(props: UploadQueueOptions): ReactElement {
  const queue = useUploadQueue(props);
  return (
    <>
      <AddPapers onFiles={queue.enqueue} />
      <UploadRow queue={queue} />
    </>
  );
}

export interface LibraryCase {
  readonly name: string;
  readonly element: ReactElement;
  /** Runs after mount, e.g. to open a disclosure so its contents are audited too. */
  readonly afterRender?: (container: HTMLElement) => void;
}

/** Opens `UncertaintyState`'s disclosure the way a keyboard user would. */
export function openDisclosure(
  container: HTMLElement,
  click: (element: HTMLElement) => void,
): void {
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  if (toggle === null) throw new Error('disclosure toggle not found');
  click(toggle);
}

export const CASES: readonly LibraryCase[] = [
  {
    // #195: the failed paper's catalogue card, so Read, Retry and Delete are all audited.
    name: 'CatalogueCard',
    element: (
      <CatalogueCard
        id="card"
        book={{ ...(PAPERS[4] as LibraryPaper), year: 2019, reading: null, arxivCategory: null }}
        onRead={noop}
        onRetry={noopAsync}
        onDelete={noopAsync}
      />
    ),
  },
  {
    name: 'CatalogueCard (a ready paper)',
    element: (
      <CatalogueCard
        id="card"
        book={{ ...(PAPERS[3] as LibraryPaper), year: 2017, reading: null, arxivCategory: null }}
        onRead={noop}
        onRetry={noopAsync}
        onDelete={noopAsync}
      />
    ),
  },
  {
    // The failed paper's card with its Delete confirmation open, so "Delete paper" and "Keep it" are audited.
    name: 'CatalogueCard (confirming Delete)',
    element: (
      <CatalogueCard
        id="card"
        book={{ ...(PAPERS[4] as LibraryPaper), year: null, reading: null, arxivCategory: null }}
        onRead={noop}
        onRetry={noopAsync}
        onDelete={noopAsync}
      />
    ),
    afterRender: (container) => {
      const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="Delete "]');
      if (remove === null) throw new Error('Delete not found');
      fireEvent.click(remove, { detail: 0 });
    },
  },
  { name: 'UploadRow', element: <UploadRow queue={QUEUE} /> },
  {
    name: 'ParsingState',
    element: <ParsingState totalPages={6} parsedPages={[0, 1, 2]} onOpenPage={noop} />,
  },
  {
    name: 'PartialState',
    element: (
      <PartialState
        partialReason="Golden fixture: only pages 0-2 of the 18-page source PDF are parsed."
        affectedPages={[11, 12, 13]}
        onOpenPage={noop}
      />
    ),
  },
  {
    // The non-contiguous branch of the banner heading. Both branches are rendered so neither can
    // rot unaudited — `[2, 9, 30]` must not be described as a range.
    name: 'PartialState (scattered pages)',
    element: (
      <PartialState
        partialReason="Pages 3, 10 and 31 produced no text layer."
        affectedPages={[30, 2, 9]}
        onOpenPage={noop}
      />
    ),
  },
  {
    name: 'UncertaintyState',
    element: (
      <UncertaintyState
        blockId="blk_abc"
        pageIndex={3}
        confidence={0.42}
        cropSrc="/crop.png"
        cropAlt="Crop of the uncertain region on page 4"
        onReport={noop}
      >
        <p>Residual learning reformulates the layers as learning residual functions.</p>
      </UncertaintyState>
    ),
  },
  {
    name: 'FailureState',
    element: (
      <FailureState
        failedStep="equation crops"
        completedSteps={['page images', 'text layer', 'block segmentation']}
        remainingSteps={['section tree', 'audio']}
        detail="MuPDF returned an empty pixmap for page 12."
        onRetryFrom={noop}
        onOpenSource={noop}
      />
    ),
  },
  { name: 'OfflineState', element: <OfflineState onRetryConnection={noop} /> },
  { name: 'EmptyLibrary', element: <EmptyLibrary onAddPaper={noop} /> },
];
