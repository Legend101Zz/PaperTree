/**
 * S3 — the library renders what `GET /papers` (S1's `LibraryPaper`) says, and polls only while it
 * must. One test per defect #141 names: every row read "Queued", was titled with its `ppr_` id;
 * a settled library kept asking; a StrictMode mount froze the upload row on "Waiting to upload";
 * sample cards and audio claims were visible by default.
 *
 * Since #195 the papers are spines on the shelf, so each assertion reads the spine (its name and
 * state). Since v0.3 (#337) there is no catalogue card: a click opens the book, and Retry and
 * Remove are the Table's (library-table.spec.tsx, library-table-edges.spec.tsx).
 */
import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView, POLL_INTERVAL_MS, pollInterval } from '@/features/library';
import { ApiError, type LibraryPaper } from '@/lib/api/types';

import { UploadHarness } from './library-cases';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
vi.mock('@/lib/api/papers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/papers')>()),
  papersApi: api,
}));
// The opened book reads its figures, abstract and summary; this spec only needs it to open.
vi.mock('@/features/book/api/bookApi', async (importOriginal) =>
  (await import('./api-stubs')).withEmptyBook(await importOriginal()),
);
vi.mock('@/lib/api/summary', async (importOriginal) =>
  (await import('./api-stubs')).withNoSummary(await importOriginal()),
);
// The library reads `GET /topics` for its stats line; this spec is not about topics (#310).
vi.mock('@/lib/api/topics', async (importOriginal) =>
  (await import('./api-stubs')).withNoTopics(await importOriginal()),
);

function row(overrides: Partial<LibraryPaper> = {}): LibraryPaper {
  return {
    paper_id: 'ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA',
    title: 'You Only Look Once: Unified, Real-Time Object Detection',
    authors: ['Joseph Redmon', 'Santosh Divvala'],
    original_filename: 'yolo.pdf',
    source_hash: 'sha256:00',
    page_count: 10,
    processing: 'ready',
    job: null,
    generation: 1,
    parser_version: '1.0.0',
    highlight_count: 0,
    created_at: '2026-10-15T10:00:00+00:00',
    updated_at: '2026-10-15T10:00:00+00:00',
    reading: null,
    year: null,
    arxiv_id: null,
    arxiv_category: null,
    thread_count: 0,
    has_summary: false,
    topic: null,
    notebook_count: 0,
    plate: null,
    ...overrides,
  };
}

function job(
  overrides: Partial<NonNullable<LibraryPaper['job']>> = {},
): NonNullable<LibraryPaper['job']> {
  return {
    job_id: 'job_1',
    kind: 'parse',
    state: 'running',
    step: 'parse',
    done: 0,
    total: 3,
    attempt: 1,
    max_attempts: 3,
    error_code: null,
    ...overrides,
  };
}

function renderLibrary(ui: ReactNode = <LibraryView />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** The (first, or named) spine on the shelf. */
async function spineOf(name: RegExp = /./): Promise<HTMLElement> {
  const shelf = await screen.findByRole('toolbar', { name: 'Shelf' });
  return within(shelf).getAllByRole('button', { name })[0] as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('library rows from the API (S1 shape)', () => {
  it('shows the server title, never the ppr_ id, and a ready paper is not Queued', async () => {
    api.list.mockResolvedValue([row()]);
    renderLibrary();

    const spine = await spineOf(/You Only Look Once/);
    expect(spine.getAttribute('data-processing-state')).toBe('complete');
    expect(spine.getAttribute('aria-label')).toBe(
      'You Only Look Once: Unified, Real-Time Object Detection, Redmon and Divvala, not started',
    );
    expect(spine.textContent).not.toMatch(/ppr_/);
    expect(spine.getAttribute('aria-label')).not.toMatch(/Queued/);
  });

  it('queued reads as waiting to be read', async () => {
    api.list.mockResolvedValue([row({ processing: 'queued', job: job({ state: 'pending' }) })]);
    renderLibrary();
    const spine = await spineOf();
    expect(spine.getAttribute('data-processing-state')).toBe('pending');
    expect(spine.getAttribute('data-spine-state')).toBe('queued');
    expect(spine.getAttribute('aria-label')).toMatch(/waiting to be read$/);
  });

  it('reading is a kraft wrap that says it is being read', async () => {
    api.list.mockResolvedValue([
      row({ processing: 'reading', job: job({ done: 1, step: 'persist' }) }),
    ]);
    renderLibrary();
    const spine = await spineOf();
    expect(spine.getAttribute('data-processing-state')).toBe('parsing');
    expect(spine.getAttribute('aria-label')).toMatch(/being read$/);
    expect(spine.textContent).toContain('being read');
  });

  it('partial says plainly that it was partly read, and still opens as a book', async () => {
    api.list.mockResolvedValue([row({ paper_id: 'ppr_P', processing: 'partial' })]);
    renderLibrary();
    const spine = await spineOf();
    expect(spine.getAttribute('aria-label')).toMatch(/partly read$/);
    fireEvent.click(spine);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('failed is a torn label, and a click reads the paper (Source mode works for it)', async () => {
    api.list.mockResolvedValue([
      row({
        paper_id: 'ppr_X',
        processing: 'failed',
        job: job({ state: 'dead_letter', error_code: 'pdf_unreadable', done: 0 }),
      }),
    ]);
    renderLibrary();
    const spine = await spineOf();
    expect(spine.getAttribute('data-spine-state')).toBe('failed');
    expect(spine.getAttribute('aria-label')).toMatch(/could not read$/);
    fireEvent.click(spine);
    // There is nothing to open yet: no card and no book, and no Retry here (it is the Table's).
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-card-paper-id]')).toBeNull();
    expect(push).toHaveBeenCalledWith('/paper/ppr_X/read');
  });
});

describe("#137: nothing in the library is not the user's", () => {
  it('shows no sample cards and no audio claims by default, and an upload call to action when empty', async () => {
    api.list.mockResolvedValue([]);
    renderLibrary();
    // Since #196 the call to action is the accession slip (frame 01b).
    await screen.findByRole('heading', { name: 'Drop PDFs here or choose files' });
    expect(screen.getByRole('heading', { name: 'Your library' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'choose files' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /Attention Is All You Need|Deep Residual|Neural Ordinary/,
    );
    expect(document.body.textContent).not.toMatch(/audio/i);
  });
});

describe('polling', () => {
  it('pollInterval is on only while a row is queued or reading', () => {
    expect(pollInterval([row({ processing: 'queued' })])).toBe(POLL_INTERVAL_MS);
    expect(pollInterval([row(), row({ processing: 'reading' })])).toBe(POLL_INTERVAL_MS);
    expect(
      pollInterval([row(), row({ processing: 'partial' }), row({ processing: 'failed' })]),
    ).toBe(false);
    expect(pollInterval([])).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });

  it('keeps asking while a row is reading, and the state change appears without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.list
      .mockResolvedValueOnce([row({ processing: 'queued', job: job({ state: 'pending' }) })])
      .mockResolvedValueOnce([row({ processing: 'reading', job: job() })])
      .mockResolvedValue([row({ processing: 'ready' })]);
    renderLibrary();

    // The spine follows its paper through every poll.
    const spine = await spineOf();
    expect(spine.getAttribute('data-spine-state')).toBe('queued');
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100));
    await waitFor(() => expect(spine.getAttribute('data-spine-state')).toBe('parsing'));
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100));
    await waitFor(() => expect(spine.getAttribute('data-spine-state')).toBe('ready'));
    expect(spine.getAttribute('aria-label')).toMatch(/not started$/);
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('a settled library makes no further requests', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.list.mockResolvedValue([row(), row({ paper_id: 'ppr_2', processing: 'partial' })]);
    renderLibrary();
    await screen.findByRole('toolbar', { name: 'Shelf' });
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});

// #195: the queue moved out of UploadDropzone into useUploadQueue, behind Add papers and the
// upload row under the header; the same behaviours are asserted on that path.
describe('the upload queue (Add papers and the upload row)', () => {
  const pdf = () => new File(['%PDF-1.4 x'], 'paper.pdf', { type: 'application/pdf' });

  function pick(file: File) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('no file input');
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('under StrictMode the row leaves "Waiting to upload" and goes once the upload resolves (the mountedRef freeze)', async () => {
    let finish: () => void = () => undefined;
    const onUpload = vi.fn(
      (_file: File, ctx: { onProgress: (n: number) => void }) =>
        new Promise<void>((resolve) => {
          ctx.onProgress(0.5);
          finish = resolve;
        }),
    );
    render(
      <StrictMode>
        <UploadHarness onUpload={onUpload} />
      </StrictMode>,
    );
    pick(pdf());
    // THE REGRESSION: with the frozen ref the row never left "Waiting to upload".
    await waitFor(() => {
      const li = document.querySelector('[data-upload-state]');
      expect(li?.getAttribute('data-upload-state')).toBe('uploading');
    });
    expect(document.body.textContent).not.toMatch(/Waiting to upload/);
    // The upload resolved: the server row is in the library, so the transient row is dropped (W2UI).
    await act(async () => {
      finish();
    });
    await waitFor(() => expect(document.querySelector('[data-upload-state]')).toBeNull());
  });

  it('shows progress and Cancel aborts: the row reads Cancelled', async () => {
    let signal: AbortSignal | undefined;
    const onUpload = vi.fn(
      (_file: File, ctx: { onProgress: (n: number) => void; signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal = ctx.signal;
          ctx.onProgress(0.4);
          ctx.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    render(
      <StrictMode>
        <UploadHarness onUpload={onUpload} />
      </StrictMode>,
    );
    pick(pdf());
    const bar = await screen.findByRole('progressbar', { name: /Upload progress/ });
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('40'));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }), { detail: 0 });
    await waitFor(() =>
      expect(document.querySelector('[data-upload-state]')?.getAttribute('data-upload-state')).toBe(
        'cancelled',
      ),
    );
    expect(signal?.aborted).toBe(true);
    expect(document.body.textContent).toMatch(/Cancelled/);
  });

  it.each([
    [400, /empty/i],
    [413, /too large/i],
    [415, /not a PDF/i],
  ])('a %i from the server is a sentence', async (status, pattern) => {
    const onUpload = vi.fn(async () => {
      throw new ApiError(status, 'internal', '{"detail":"raw"}', false);
    });
    render(<UploadHarness onUpload={onUpload} />);
    pick(pdf());
    await waitFor(() =>
      expect(document.querySelector('[data-upload-state]')?.getAttribute('data-upload-state')).toBe(
        'failed',
      ),
    );
    expect(document.body.textContent).toMatch(pattern);
    expect(document.body.textContent).not.toMatch(/\{"detail"/);
  });

  it('refuses a non-PDF before any bytes leave, with a sentence', () => {
    const onUpload = vi.fn();
    render(<UploadHarness onUpload={onUpload} />);
    pick(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(onUpload).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/notes\.txt is not a PDF/);
  });

  it('Add papers is a named button that opens the file picker', () => {
    render(<UploadHarness onUpload={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>('[data-add-papers] input[type="file"]');
    const opened = vi.fn();
    input?.addEventListener('click', opened);
    fireEvent.click(screen.getByRole('button', { name: 'Add papers' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(input?.accept).toContain('application/pdf');
  });
});
