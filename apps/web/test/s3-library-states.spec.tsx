/**
 * S3 — the library renders what `GET /papers` (S1's `LibraryPaper`) says, and polls only while it
 * must. One test per defect #141 names: every card read "Queued", was titled with its `ppr_` id,
 * showed "0 pages", had no Retry; a settled library kept asking; a StrictMode mount froze the
 * upload row on "Waiting to upload"; sample cards and audio claims were visible by default.
 *
 * Since #195 the papers are spines on the shelf and a paper's details live in its catalogue card
 * (a click on the spine), so each assertion now reads the spine or the card; none was dropped.
 */
import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView, POLL_INTERVAL_MS, pollInterval } from '@/features/library';
import { ApiError, type LibraryPaper } from '@/lib/api/types';
import { NetworkError } from '@/lib/api/client';

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

/** Take the (first, or named) book down: its catalogue card opens. Returns the spine and the card. */
async function openCard(name: RegExp = /./) {
  const shelf = await screen.findByRole('toolbar', { name: 'Shelf' });
  const spine = within(shelf).getAllByRole('button', { name })[0] as HTMLElement;
  fireEvent.click(spine);
  const card = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-card-paper-id]');
    if (found === null) throw new Error('no catalogue card');
    return found;
  });
  return { spine, card };
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
  it('shows the server title and page count, never the ppr_ id, and a ready paper is not Queued', async () => {
    api.list.mockResolvedValue([row()]);
    renderLibrary();

    const { spine, card } = await openCard(/You Only Look Once/);
    expect(spine.getAttribute('data-processing-state')).toBe('complete');
    expect(spine.getAttribute('aria-label')).toBe(
      'You Only Look Once: Unified, Real-Time Object Detection, Redmon and Divvala, not started',
    );
    expect(card.textContent).toMatch(/10 pages/);
    expect(within(card).getByText('Not started')).toBeTruthy();
    expect(`${card.textContent ?? ''}${spine.textContent ?? ''}`).not.toMatch(/ppr_/);
    expect(card.textContent).not.toMatch(/Queued/);
  });

  it('queued reads Queued', async () => {
    api.list.mockResolvedValue([row({ processing: 'queued', job: job({ state: 'pending' }) })]);
    renderLibrary();
    const { spine, card } = await openCard();
    expect(spine.getAttribute('data-processing-state')).toBe('pending');
    expect(spine.getAttribute('data-spine-state')).toBe('queued');
    expect(within(card).getByText('Queued')).toBeTruthy();
  });

  it('reading shows the step in words, from job.done and job.step', async () => {
    api.list.mockResolvedValue([
      row({ processing: 'reading', job: job({ done: 1, step: 'persist' }) }),
    ]);
    renderLibrary();
    const { spine, card } = await openCard();
    expect(spine.getAttribute('data-processing-state')).toBe('parsing');
    expect(within(card).getByText('Saving what was read - step 2 of 3')).toBeTruthy();
    expect(within(card).getByRole('progressbar')).toBeTruthy();
  });

  it('step 1 is "Reading the PDF - step 1 of 3"', async () => {
    api.list.mockResolvedValue([row({ processing: 'reading', job: job() })]);
    renderLibrary();
    const { card } = await openCard();
    expect(await within(card).findByText('Reading the PDF - step 1 of 3')).toBeTruthy();
  });

  it('partial says plainly that some parts could not be read', async () => {
    api.list.mockResolvedValue([row({ processing: 'partial' })]);
    renderLibrary();
    const { card } = await openCard();
    expect(within(card).getByText('Partly read')).toBeTruthy();
    expect(card.textContent).toMatch(/some parts of this paper could not be read/i);
  });

  it('failed shows a readable reason and Retry, which calls POST retry for that paper', async () => {
    api.list.mockResolvedValue([
      row({
        paper_id: 'ppr_FAILED',
        processing: 'failed',
        job: job({ state: 'dead_letter', error_code: 'pdf_unreadable', done: 0 }),
      }),
    ]);
    api.retry.mockResolvedValue({ job_id: 'job_2', generation: 1 });
    renderLibrary();

    const { spine, card } = await openCard();
    expect(spine.getAttribute('data-spine-state')).toBe('failed');
    expect(card.textContent).toMatch(/could not be read as a PDF/);
    expect(card.textContent).not.toMatch(/pdf_unreadable|dead_letter/);
    fireEvent.click(within(card).getByRole('button', { name: /Retry/ }), { detail: 0 });
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('ppr_FAILED'));
  });

  it('a double press on Retry sends one request, and the button says it is busy meanwhile', async () => {
    api.list.mockResolvedValue([row({ processing: 'failed', job: job({ state: 'dead_letter' }) })]);
    let settle: (value: unknown) => void = () => undefined;
    api.retry.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    renderLibrary();
    const { card } = await openCard();
    const retry = within(card).getByRole('button', { name: /Retry/ });
    fireEvent.click(retry, { detail: 1 });
    fireEvent.click(retry, { detail: 2 });
    expect(api.retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(retry.getAttribute('aria-disabled')).toBe('true'));
    await act(async () => settle({ job_id: 'job_2', generation: 2 }));
    expect(api.retry).toHaveBeenCalledTimes(1);
    expect(within(card).queryByRole('alert')).toBeNull();
  });

  it('a 409 "nothing to retry" (a retry got there first) is not an error: the list is asked again', async () => {
    api.list.mockResolvedValue([row({ processing: 'failed', job: job({ state: 'dead_letter' }) })]);
    api.retry.mockRejectedValue(
      new ApiError(
        409,
        'not_failed',
        "the paper's latest parse has not failed; nothing to retry",
        false,
      ),
    );
    renderLibrary();
    const { card } = await openCard();
    const asked = api.list.mock.calls.length;
    fireEvent.click(within(card).getByRole('button', { name: /Retry/ }), { detail: 0 });
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(asked));
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(card.textContent).not.toMatch(/nothing to retry/);
  });

  it('a failed Retry is a sentence, not raw JSON', async () => {
    api.list.mockResolvedValue([row({ processing: 'failed', job: job({ state: 'dead_letter' }) })]);
    api.retry.mockRejectedValue(new NetworkError('x'));
    renderLibrary();
    const { card } = await openCard();
    fireEvent.click(within(card).getByRole('button', { name: /Retry/ }), { detail: 0 });
    const alert = await within(card).findByRole('alert');
    expect(alert.textContent).toMatch(/could not be reached/i);
  });

  it('Read opens /paper/<id>/read for any paper, including a failed one', async () => {
    api.list.mockResolvedValue([
      row({ paper_id: 'ppr_X', processing: 'failed', job: job({ state: 'dead_letter' }) }),
    ]);
    renderLibrary();
    const { card } = await openCard();
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Read You Only Look Once: Unified, Real-Time Object Detection',
      }),
    );
    expect(push).toHaveBeenCalledWith('/paper/ppr_X/read');
  });

  it('Delete confirms inline (no window.confirm), then calls DELETE and removes the book', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    api.list.mockResolvedValue([row({ paper_id: 'ppr_D' })]);
    api.remove.mockResolvedValue(undefined);
    renderLibrary();

    const { card } = await openCard();
    fireEvent.click(within(card).getByRole('button', { name: /Delete/ }), { detail: 0 });
    expect(api.remove).not.toHaveBeenCalled();
    const group = within(card).getByRole('group', { name: /Confirm deleting/ });
    fireEvent.click(within(group).getByRole('button', { name: 'Delete paper' }), { detail: 0 });

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('ppr_D'));
    await waitFor(() => expect(document.querySelector('[data-paper-id="ppr_D"]')).toBeNull());
    expect(screen.queryByRole('region', { name: /You Only Look Once/ })).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('an armed Delete stays with its book: the next book taken down opens unarmed', async () => {
    api.list.mockResolvedValue([
      row({ paper_id: 'ppr_A', title: 'Alpha' }),
      row({ paper_id: 'ppr_B', title: 'Beta', created_at: '2026-10-16T10:00:00+00:00' }),
    ]);
    renderLibrary();
    const shelf = await screen.findByRole('toolbar', { name: 'Shelf' });
    const cardOf = (id: string) =>
      waitFor(() => {
        const found = document.querySelector<HTMLElement>(`[data-card-paper-id="${id}"]`);
        if (found === null) throw new Error(`no card for ${id}`);
        return found;
      });
    fireEvent.click(within(shelf).getByRole('button', { name: /^Alpha/ }));
    const alpha = await cardOf('ppr_A');
    fireEvent.click(within(alpha).getByRole('button', { name: 'Delete Alpha' }), { detail: 0 });
    expect(within(alpha).getByRole('group', { name: 'Confirm deleting Alpha' })).toBeTruthy();

    fireEvent.click(within(shelf).getByRole('button', { name: /^Beta/ }));
    const beta = await cardOf('ppr_B');
    expect(within(beta).queryByRole('group', { name: /Confirm deleting/ })).toBeNull();
    expect(within(beta).getByRole('button', { name: 'Delete Beta' })).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('Keep it leaves the paper alone', async () => {
    api.list.mockResolvedValue([row()]);
    renderLibrary();
    const { card } = await openCard();
    fireEvent.click(within(card).getByRole('button', { name: /Delete/ }), { detail: 0 });
    expect(document.activeElement?.textContent).toBe('Keep it');
    fireEvent.click(within(card).getByRole('button', { name: 'Keep it' }), { detail: 0 });
    expect(api.remove).not.toHaveBeenCalled();
    expect(within(card).queryByRole('group')).toBeNull();
    // Focus goes back to the Delete that opened the confirmation, never to the page.
    await waitFor(() =>
      expect(document.activeElement).toBe(within(card).getByRole('button', { name: /^Delete/ })),
    );
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

    // The open card follows its paper through every poll, as the spine does.
    const { spine, card } = await openCard();
    expect(await within(card).findByText('Queued')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100));
    expect(await within(card).findByText('Reading the PDF - step 1 of 3')).toBeTruthy();
    expect(spine.getAttribute('data-spine-state')).toBe('parsing');
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100));
    expect(await within(card).findByText('Not started')).toBeTruthy();
    expect(spine.getAttribute('data-spine-state')).toBe('ready');
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
