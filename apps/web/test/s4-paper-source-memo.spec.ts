/**
 * s4-paper-source-memo — the reader's in-memory copies of a paper (its PDF bytes and its indexed
 * parse) belong to ONE signed-in session and are few (s4-review.md F8).
 *
 * `pdfSourceFor` / `loadDocument` memoise so a remount (StrictMode's double effect, reopening from
 * the library) does not download the PDF again. Before this, the memo was keyed by paper id alone
 * and lived for the tab: after a sign-out, the next account in the same tab was handed the previous
 * account's bytes for the same id without a request, and every paper ever opened stayed in memory.
 *
 * `fetch` is the only thing replaced; the real `papersApi` and `client.ts` run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __clearDocumentCache, pdfSourceFor } from '@/lib/paperSource';

let requests: { path: string; auth: string | null }[] = [];

beforeEach(() => {
  __clearDocumentCache();
  requests = [];
  window.localStorage.setItem('papertree.session', 'token-A');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({ path: new URL(url).pathname, auth: headers.get('Authorization') });
      return new Response(new TextEncoder().encode(`%PDF-1.7 ${new URL(url).pathname}`), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.removeItem('papertree.session');
});

const paper = (id: string) => ({ kind: 'api' as const, paperId: id });

describe('s4: the PDF memo is per session and bounded', () => {
  it('a remount in the same session reuses the bytes (one download)', async () => {
    await pdfSourceFor(paper('ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA'));
    await pdfSourceFor(paper('ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA'));
    expect(requests).toHaveLength(1);
  });

  it('after a sign-out and another sign-in, the same id is fetched again, with the new token', async () => {
    await pdfSourceFor(paper('ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA'));
    window.localStorage.removeItem('papertree.session');
    window.localStorage.setItem('papertree.session', 'token-B');
    await pdfSourceFor(paper('ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA'));
    expect(requests).toHaveLength(2);
    expect(requests[1]?.auth).toBe('Bearer token-B');
  });

  it('keeps only the most recent papers, not every one opened in the tab', async () => {
    const ids = ['A', 'B', 'C', 'D'].map((c) => `ppr_${c.repeat(26)}`);
    for (const id of ids) await pdfSourceFor(paper(id));
    expect(requests).toHaveLength(4);
    // The first one opened has been let go: opening it again downloads it again.
    await pdfSourceFor(paper(ids[0] as string));
    expect(requests).toHaveLength(5);
    // The latest is still held.
    await pdfSourceFor(paper(ids[3] as string));
    expect(requests).toHaveLength(5);
  });
});
