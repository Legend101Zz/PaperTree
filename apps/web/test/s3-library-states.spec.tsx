/**
 * S3 — the library renders what `GET /papers` (S1's `LibraryPaper`) says, and polls only while it
 * must. One test per defect #141 names: every card read "Queued", was titled with its `ppr_` id,
 * showed "0 pages", had no Retry; a settled library kept asking; a StrictMode mount froze the
 * upload row on "Waiting to upload"; sample cards and audio claims were visible by default.
 */
import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryView, POLL_INTERVAL_MS, pollInterval } from '@/components/library/LibraryView';
import { UploadDropzone } from '@/components/library/UploadDropzone';
import { ApiError, type LibraryPaper } from '@/lib/api/types';
import { NetworkError } from '@/lib/api/client';

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
    ...overrides,
  };
}

function job(overrides: Partial<NonNullable<LibraryPaper['job']>> = {}): NonNullable<LibraryPaper['job']> {
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
  it('shows the server title and page count, never the ppr_ id, and Ready for a ready paper', async () => {
    api.list.mockResolvedValue([row()]);
    renderLibrary();

    const card = await screen.findByRole('article', { name: /You Only Look Once/ });
    expect(within(card).getByText('10 pages')).toBeTruthy();
    expect(within(card).getByText('Ready')).toBeTruthy();
    expect(card.textContent).not.toMatch(/ppr_/);
    expect(card.textContent).not.toMatch(/Queued/);
  });

  it('queued reads Queued', async () => {
    api.list.mockResolvedValue([row({ processing: 'queued', job: job({ state: 'pending' }) })]);
    renderLibrary();
    const card = await screen.findByRole('article');
    expect(card.getAttribute('data-processing-state')).toBe('pending');
    expect(within(card).getByText('Queued')).toBeTruthy();
  });

  it('reading shows the step in words, from job.done and job.step', async () => {
    api.list.mockResolvedValue([
      row({ processing: 'reading', job: job({ done: 1, step: 'persist' }) }),
    ]);
    renderLibrary();
    const card = await screen.findByRole('article');
    expect(card.getAttribute('data-processing-state')).toBe('parsing');
    expect(within(card).getByText('Saving what was read - step 2 of 3')).toBeTruthy();
    expect(within(card).getByRole('progressbar')).toBeTruthy();
  });

  it('step 1 is "Reading the PDF - step 1 of 3"', async () => {
    api.list.mockResolvedValue([row({ processing: 'reading', job: job() })]);
    renderLibrary();
    expect(await screen.findByText('Reading the PDF - step 1 of 3')).toBeTruthy();
  });

  it('partial says plainly that some parts could not be read', async () => {
    api.list.mockResolvedValue([row({ processing: 'partial' })]);
    renderLibrary();
    const card = await screen.findByRole('article');
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

    const card = await screen.findByRole('article');
    expect(card.textContent).toMatch(/could not be read as a PDF/);
    expect(card.textContent).not.toMatch(/pdf_unreadable|dead_letter/);
    fireEvent.click(within(card).getByRole('button', { name: /Retry/ }), { detail: 0 });
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('ppr_FAILED'));
  });

  it('a failed Retry is a sentence, not raw JSON', async () => {
    api.list.mockResolvedValue([row({ processing: 'failed', job: job({ state: 'dead_letter' }) })]);
    api.retry.mockRejectedValue(new NetworkError('x'));
    renderLibrary();
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: /Retry/ }), { detail: 0 });
    const alert = await within(card).findByRole('alert');
    expect(alert.textContent).toMatch(/could not be reached/i);
  });

  it('opening any card goes to /paper/<id>/read, including a failed one', async () => {
    api.list.mockResolvedValue([row({ paper_id: 'ppr_X', processing: 'failed', job: job({ state: 'dead_letter' }) })]);
    renderLibrary();
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: 'You Only Look Once: Unified, Real-Time Object Detection' }), { detail: 0 });
    expect(push).toHaveBeenCalledWith('/paper/ppr_X/read');
  });

  it('Delete confirms inline (no window.confirm), then calls DELETE and removes the card', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    api.list.mockResolvedValue([row({ paper_id: 'ppr_D' })]);
    api.remove.mockResolvedValue(undefined);
    renderLibrary();

    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: /Delete/ }), { detail: 0 });
    expect(api.remove).not.toHaveBeenCalled();
    const group = within(card).getByRole('group', { name: /Confirm deleting/ });
    fireEvent.click(within(group).getByRole('button', { name: 'Delete paper' }), { detail: 0 });

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('ppr_D'));
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Keep it leaves the paper alone', async () => {
    api.list.mockResolvedValue([row()]);
    renderLibrary();
    const card = await screen.findByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: /Delete/ }), { detail: 0 });
    fireEvent.click(within(card).getByRole('button', { name: 'Keep it' }), { detail: 0 });
    expect(api.remove).not.toHaveBeenCalled();
    expect(within(card).queryByRole('group')).toBeNull();
  });
});

describe('#137: nothing in the library is not the user\'s', () => {
  it('shows no sample cards and no audio claims by default, and an upload call to action when empty', async () => {
    api.list.mockResolvedValue([]);
    renderLibrary();
    await screen.findByRole('heading', { name: 'Add your first paper' });
    expect(screen.getByRole('button', { name: /Upload a PDF/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Attention Is All You Need|Deep Residual|Neural Ordinary/);
    expect(document.body.textContent).not.toMatch(/audio/i);
  });
});

describe('polling', () => {
  it('pollInterval is on only while a row is queued or reading', () => {
    expect(pollInterval([row({ processing: 'queued' })])).toBe(POLL_INTERVAL_MS);
    expect(pollInterval([row(), row({ processing: 'reading' })])).toBe(POLL_INTERVAL_MS);
    expect(pollInterval([row(), row({ processing: 'partial' }), row({ processing: 'failed' })])).toBe(false);
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

    expect(await screen.findByText('Queued')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100));
    expect(await screen.findByText('Reading the PDF - step 1 of 3')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100));
    expect(await screen.findByText('Ready')).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('a settled library makes no further requests', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.list.mockResolvedValue([row(), row({ paper_id: 'ppr_2', processing: 'partial' })]);
    renderLibrary();
    await screen.findAllByRole('article');
    expect(api.list).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});

describe('UploadDropzone', () => {
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
        <UploadDropzone onUpload={onUpload} />
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
        <UploadDropzone onUpload={onUpload} />
      </StrictMode>,
    );
    pick(pdf());
    const bar = await screen.findByRole('progressbar', { name: /Upload progress/ });
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('40'));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }), { detail: 0 });
    await waitFor(() =>
      expect(document.querySelector('[data-upload-state]')?.getAttribute('data-upload-state')).toBe('cancelled'),
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
    render(<UploadDropzone onUpload={onUpload} />);
    pick(pdf());
    await waitFor(() =>
      expect(document.querySelector('[data-upload-state]')?.getAttribute('data-upload-state')).toBe('failed'),
    );
    expect(document.body.textContent).toMatch(pattern);
    expect(document.body.textContent).not.toMatch(/\{"detail"/);
  });

  it('refuses a non-PDF before any bytes leave, with a sentence', () => {
    const onUpload = vi.fn();
    render(<UploadDropzone onUpload={onUpload} />);
    pick(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(onUpload).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/notes\.txt is not a PDF/);
  });

  it('the file input has an associated label', () => {
    render(<UploadDropzone onUpload={vi.fn()} />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.labels?.length).toBeGreaterThan(0);
  });
});
