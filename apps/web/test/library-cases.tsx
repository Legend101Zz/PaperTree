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
import { LibraryHeader } from '@/features/library/components/LibraryHeader';
import { LibraryTitle } from '@/features/library/components/LibraryTitle';
import { ShelfHints } from '@/features/library/components/ShelfHints';
import { TableView } from '@/features/library/components/TableView';
import { UploadRow } from '@/features/library/components/UploadRow';
import {
  useUploadQueue,
  type UploadQueue,
  type UploadQueueOptions,
} from '@/features/library/hooks/useUploadQueue';
import type { LibraryBook } from '@/features/library/hooks/useLibrary';
import type { TableViewState } from '@/features/library/hooks/useTableView';
import { TOUCH_QUERY } from '@/features/library/hooks/useTouchTargets';
import { NO_FILTER } from '@/features/library/model/table';
import { DEFAULT_SORT } from '@/features/library/model/tableSort';

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

/**
 * The library's chrome draws its desktop sizes (36–40 px, frame 01) on a wide screen with a fine
 * pointer and 44 px targets on a phone or touch screen (`useTouchTargets`). These audits are the
 * touch audits, so every file that imports the cases sees a touch screen.
 */
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: query === TOUCH_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

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

/** The papers as the Table reads them (#197): one per state, one reading, one with a topic. */
const BOOKS: readonly LibraryBook[] = PAPERS.map((paper, index) => ({
  ...paper,
  year: index === 0 ? null : 2015 + index,
  arxivCategory: 'cs.CL',
  topic:
    index === 3
      ? {
          id: 't',
          name: 'Transformers',
          cloth: 'transformers',
          source: 'arxiv_category',
          sourceDetail: 'cs.CL',
        }
      : null,
  reading:
    index === 3
      ? {
          last_page: 3,
          furthest_page: 3,
          page_count: 9,
          opened_at: '2026-10-16T10:00:00Z',
          finished_at: null,
          state: 'reading',
        }
      : null,
}));

const TABLE: TableViewState = {
  chip: 'all',
  setChip: noop,
  filter: NO_FILTER,
  setFilter: noop,
  sort: DEFAULT_SORT,
  setSort: noop,
  hidden: new Set(),
  setShown: noop,
};

const TABLE_VIEW = (
  <TableView
    books={BOOKS}
    matches={null}
    table={TABLE}
    touch
    onRetry={noopAsync}
    onDelete={noopAsync}
    onShowOnShelf={noop}
  />
);

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
    name: 'LibraryHeader (searching)',
    element: (
      <LibraryHeader
        search={{ value: 'atten', onChange: noop, matched: 2, total: 4, onSubmit: noop }}
        searchRef={{ current: null }}
        onFiles={noop}
        email="mrigesh@example.test"
        signingOut={false}
        onSignOut={noop}
      />
    ),
  },
  {
    name: 'LibraryTitle',
    element: (
      <LibraryTitle
        stats={{ papers: 4, topics: 0, readingNow: 1, pages: 36, needALook: 1 }}
        needALookOnly={false}
        onNeedALook={noop}
        view="shelf"
        onView={noop}
        arrangement="topic"
        onArrange={noop}
      />
    ),
  },
  { name: 'ShelfHints', element: <ShelfHints query="" matched={0} total={4} /> },
  { name: 'TableView', element: TABLE_VIEW },
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
