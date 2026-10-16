/**
 * W2UI #141 (S3 should-fixes): the unverified-session notice really retries, a failed card says
 * one sentence, the upload row does not linger above the card it became, and a cancelled upload
 * tells the truth about whether the server kept the file.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_RETRY_DELAYS_MS, SessionBanner } from '@/components/auth/SessionBanner';
import { LibraryView } from '@/features/library';
import { CANCEL_COPY } from '@/features/library/hooks/useUploadQueue';
import { NetworkError } from '@/lib/api/client';
import { authApi } from '@/lib/api/papers';
import type { LibraryPaper } from '@/lib/api/types';
import { setToken } from '@/lib/auth';
import { useAuthStore } from '@/store/authStore';

import { UploadHarness } from './library-cases';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
    title: 'garbage',
    authors: [],
    original_filename: 'garbage.pdf',
    source_hash: 'sha256:00',
    page_count: null,
    processing: 'queued',
    job: null,
    generation: 1,
    parser_version: '1.0.0',
    highlight_count: 0,
    created_at: '2026-10-15T10:00:00+00:00',
    updated_at: '2026-10-15T10:00:00+00:00',
    ...overrides,
  } as LibraryPaper;
}

const pdf = (name = 'garbage.pdf') => new File(['%PDF-1.4 x'], name, { type: 'application/pdf' });
function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  fireEvent.change(input, { target: { files: [file] } });
}
function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LibraryView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.test' },
    isAuthenticated: true,
    isLoading: false,
    sessionUnverified: true,
    signedOutByUser: false,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the unverified-session notice (item 1)', () => {
  it('retries at 2 s, 5 s and 15 s, clears itself when a check succeeds, and says nothing it does not do', async () => {
    vi.useFakeTimers();
    setToken('tok');
    const me = vi
      .spyOn(authApi, 'me')
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockResolvedValueOnce({ user_id: 'u', email: 'a@b.test', display_name: null });
    render(<SessionBanner />);
    expect(screen.getByRole('status').textContent).toMatch(/could not confirm your session/);
    expect(screen.getByRole('status').textContent).toMatch(/Checking again shortly/);

    await act(() => vi.advanceTimersByTimeAsync(SESSION_RETRY_DELAYS_MS[0] - 100));
    expect(me).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(me).toHaveBeenCalledTimes(1); // failed: still unverified
    expect(useAuthStore.getState().sessionUnverified).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(SESSION_RETRY_DELAYS_MS[1] + 100));
    expect(me).toHaveBeenCalledTimes(2); // succeeded
    expect(useAuthStore.getState().sessionUnverified).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('after the last automatic try it says so and offers Try again, which checks once more', async () => {
    vi.useFakeTimers();
    setToken('tok');
    const me = vi.spyOn(authApi, 'me').mockRejectedValue(new NetworkError('offline'));
    render(<SessionBanner />);
    // One act per delay: React schedules the next retry only after it has flushed the last one.
    for (const delay of SESSION_RETRY_DELAYS_MS) {
      await act(() => vi.advanceTimersByTimeAsync(delay + 100));
    }
    expect(me).toHaveBeenCalledTimes(SESSION_RETRY_DELAYS_MS.length);
    expect(screen.getByRole('status').textContent).toMatch(/still not confirmed/);
    // No more automatic tries.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(me).toHaveBeenCalledTimes(SESSION_RETRY_DELAYS_MS.length);

    me.mockResolvedValueOnce({ user_id: 'u', email: 'a@b.test', display_name: null });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }), { detail: 0 });
    });
    expect(me).toHaveBeenCalledTimes(SESSION_RETRY_DELAYS_MS.length + 1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is absent when the session is verified', () => {
    useAuthStore.setState({ sessionUnverified: false });
    render(<SessionBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('a failed card says one sentence (item 2)', () => {
  it('shows the reason once and never the generic state sentence next to it', async () => {
    useAuthStore.setState({ sessionUnverified: false });
    api.list.mockResolvedValue([
      row({
        processing: 'failed',
        job: {
          job_id: 'j',
          kind: 'parse',
          state: 'dead_letter',
          step: 'parse',
          done: 0,
          total: 3,
          attempt: 3,
          max_attempts: 3,
          error_code: 'pdf_unreadable',
        } as never,
      }),
    ]);
    renderLibrary();
    // #195: the failed paper is a spine; its catalogue card holds the sentence and Retry.
    fireEvent.click(await screen.findByRole('button', { name: /garbage, could not read/ }));
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-card-paper-id]');
      if (found === null) throw new Error('no catalogue card');
      return found;
    });
    const reason =
      'This file could not be read as a PDF. It may be damaged, scanned without text or password protected. Retry, or upload a different copy.';
    expect(card.textContent).toContain(reason);
    // The whole card text, screen-reader-only text included.
    expect(card.textContent).not.toContain(
      'We could not read this paper. Retry, or open the original PDF.',
    );
    expect(card.querySelectorAll('[data-failure-reason]')).toHaveLength(1);
    expect(within(card).getByRole('button', { name: /Retry/ })).toBeTruthy();
  });
});

describe('the transient upload row (item 3)', () => {
  it('is gone as soon as the upload resolves: the paper card is the only thing left', async () => {
    useAuthStore.setState({ sessionUnverified: false });
    api.list.mockResolvedValue([]);
    api.uploadWithProgress.mockResolvedValue({
      paper_id: 'ppr_NEW',
      job_id: 'j',
      created: true,
      paper: row({ paper_id: 'ppr_NEW' }),
    });
    renderLibrary();
    await screen.findByRole('heading', { name: 'Your library' });
    api.list.mockResolvedValue([row({ paper_id: 'ppr_NEW', processing: 'failed' })]);
    pick(pdf());
    await screen.findByRole('button', { name: /^garbage,/ });
    expect(document.querySelector('[data-upload-state]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Uploaded - queued for reading/);
    expect(document.querySelectorAll('[data-paper-id]')).toHaveLength(1);
  });
});

describe('cancelling an upload (item 4)', () => {
  function neverEnding() {
    return vi.fn(
      (_file: File, ctx: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
  }
  const cancel = () =>
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }), { detail: 0 });

  it.each([
    ['not-added', CANCEL_COPY['not-added']],
    [
      'in-library',
      'It had already uploaded; it is in your library. Delete it if you did not mean to add it.',
    ],
    ['unknown', CANCEL_COPY.unknown],
  ] as const)('the row says the truth when the re-read finds: %s', async (outcome, sentence) => {
    const onCancelled = vi.fn().mockResolvedValue(outcome);
    render(<UploadHarness onUpload={neverEnding()} onCancelled={onCancelled} />);
    pick(pdf('paper.pdf'));
    await screen.findByRole('button', { name: /Cancel/ });
    cancel();
    await waitFor(() =>
      expect(document.querySelector('[data-upload-state]')?.textContent).toContain(sentence),
    );
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(onCancelled.mock.calls[0]![0].name).toBe('paper.pdf');
  });

  it('a failing re-read is "unknown", never "nothing was added"', async () => {
    const onCancelled = vi.fn().mockRejectedValue(new Error('offline'));
    render(<UploadHarness onUpload={neverEnding()} onCancelled={onCancelled} />);
    pick(pdf());
    await screen.findByRole('button', { name: /Cancel/ });
    cancel();
    await waitFor(() => expect(document.body.textContent).toContain(CANCEL_COPY.unknown));
    expect(document.body.textContent).not.toContain('Nothing was added');
  });

  it('in the library: the paper that arrived during the upload is found by re-reading GET /papers', async () => {
    useAuthStore.setState({ sessionUnverified: false });
    api.list.mockResolvedValue([]);
    api.uploadWithProgress.mockImplementation(
      (_file: File, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    renderLibrary();
    await screen.findByRole('heading', { name: 'Your library' });
    pick(pdf('late.pdf'));
    await screen.findByRole('button', { name: /Cancel/ });
    // The server had the whole body before the abort landed: the paper is in the list now.
    api.list.mockResolvedValue([
      row({ paper_id: 'ppr_LATE', original_filename: 'late.pdf', title: 'late' }),
    ]);
    cancel();
    await waitFor(
      () =>
        expect(document.querySelector('[data-upload-state="cancelled"]')?.textContent).toContain(
          'It had already uploaded',
        ),
      { timeout: 4000 },
    );
    // ...and it is in the library, so the sentence is true.
    expect(await screen.findByRole('button', { name: /^late,/ })).toBeTruthy();
  });

  it('in the library: a paper that did not land reads "Nothing was added"', async () => {
    useAuthStore.setState({ sessionUnverified: false });
    api.list.mockResolvedValue([]);
    api.uploadWithProgress.mockImplementation(
      (_file: File, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    renderLibrary();
    await screen.findByRole('heading', { name: 'Your library' });
    pick(pdf('never.pdf'));
    await screen.findByRole('button', { name: /Cancel/ });
    cancel();
    await waitFor(
      () =>
        expect(document.querySelector('[data-upload-state="cancelled"]')?.textContent).toContain(
          'Nothing was added to your library.',
        ),
      { timeout: 4000 },
    );
  });
});
