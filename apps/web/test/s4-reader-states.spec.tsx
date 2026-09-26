/**
 * s4-reader-states — every way the reader can fail to open a paper is a designed sentence with a
 * next action, and never the server's `detail` or an exception's `message` (s4-review.md F7).
 *
 * The workspace is the REAL `ReaderWorkspace`; only where the paper comes from is replaced, so each
 * failure arrives exactly as `lib/api/client.ts` raises it (an `ApiError` carrying the envelope, or
 * a `NetworkError`).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NetworkError } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';

const failure: { error: unknown } = { error: null };

vi.mock('@/lib/pdf/worker', () => ({
  getPdfjs: () => new Promise(() => undefined),
}));

vi.mock('@/lib/paperSource', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/paperSource')>();
  return {
    ...original,
    loadDocument: () => Promise.reject(failure.error),
    pdfSourceFor: () => Promise.reject(failure.error),
  };
});

afterEach(() => {
  cleanup();
});

const RAW = 'anchors: List should have at most 64 items after validation, not 128';

async function openWith(error: unknown): Promise<HTMLElement> {
  failure.error = error;
  const { ReaderWorkspace } = await import('@/app/paper/[id]/read/ReaderWorkspace');
  render(<ReaderWorkspace paper={{ kind: 'api', paperId: 'ppr_C425DTWW1KYMYDSWR205HB2069' }} />);
  return screen.findByRole('alert');
}

describe('s4: the reader’s failure states are designed sentences', () => {
  it('a refusal (4xx, not retryable) names no validator text and sends the reader back to the library', async () => {
    const state = await openWith(new ApiError(422, 'validation_failed', RAW, false));
    expect(state.textContent).toContain('This paper could not be opened');
    expect(state.textContent).not.toContain(RAW);
    expect(state.textContent).not.toMatch(/validation|List should/);
    expect(screen.getByRole('link', { name: 'Back to your library' })).toBeTruthy();
  });

  it('a server error (5xx) says so plainly and offers Try again', async () => {
    const state = await openWith(new ApiError(500, 'internal', 'Traceback (most recent call last)', true));
    expect(state.textContent).not.toMatch(/Traceback/);
    expect(state.textContent).toMatch(/Try again in a moment/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('no connection says the service is not reachable', async () => {
    const state = await openWith(new NetworkError('TypeError: Failed to fetch'));
    expect(state.textContent).toContain('PaperTree is not reachable');
    expect(state.textContent).not.toMatch(/TypeError|Failed to fetch/);
  });

  it('an unexpected exception is not shown either', async () => {
    const state = await openWith(new Error('Cannot read properties of undefined (reading "blocks")'));
    expect(state.textContent).not.toMatch(/Cannot read properties/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
