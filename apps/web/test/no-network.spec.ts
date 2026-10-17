/**
 * The no-network guard (#310, `setup-no-network.ts`): an unmocked request reads as offline to the
 * code and as a named failure to the test, through each way it can leave (fetch, XHR, a raw
 * socket), and the mocking styles the specs use still work. Each case drains what it provoked, so
 * the guard's own `afterEach` sees nothing.
 */
import http from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  API_BASE_URL,
  apiFetch,
  NetworkError,
  request,
  uploadWithProgress,
} from '@/lib/api/client';

import { assertNoNetworkAttempts } from './setup-no-network';

/** Where a direct call goes: nothing listens on port 1, so even a broken guard sends nothing. */
const NOWHERE = 'http://127.0.0.1:1';

/** What the guard recorded since the last check ('' for nothing), and the list emptied. */
function drained(): string {
  try {
    assertNoNetworkAttempts();
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('an unmocked request', () => {
  it('through the API client is offline to the code and names GET and the URL to the test', async () => {
    await expect(apiFetch('/auth/me')).rejects.toBeInstanceOf(NetworkError);
    const report = drained();
    expect(report).toContain(`GET ${API_BASE_URL}/auth/me\n    in "an unmocked request > through`);
    expect(report).toContain('tests never touch the network');
    expect(drained()).toBe('');
  });

  it('names where it came from, in the failure and in its own rejection', async () => {
    const error = await apiFetch('/auth/me').catch((caught: unknown) => caught);
    // The NetworkError's cause is the guard's rejection: what an uncaught one would print.
    const cause = String((error as NetworkError).cause);
    expect(cause).toMatch(/^TypeError: #310: blocked network request GET \S+\/auth\/me, from /);
    const origin = /from src\/lib\/api\/client\.ts:\d+:\d+ < test\/no-network\.spec\.ts:\d+:\d+/;
    expect(cause).toMatch(origin);
    expect(drained()).toMatch(origin);
  });

  it('names the method of a Request, and resolves a relative URL against the test page', async () => {
    await expect(fetch(new Request(`${NOWHERE}/topics`, { method: 'POST' }))).rejects.toThrow(
      TypeError,
    );
    await expect(fetch('/fixtures/resnet.paperir.json')).rejects.toThrow('#310');
    const report = drained();
    expect(report).toContain(`POST ${NOWHERE}/topics`);
    expect(report).toContain('GET http://localhost:3000/fixtures/resnet.paperir.json');
  });

  it('through XMLHttpRequest (the upload) is stopped at send', async () => {
    const file = new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' });
    await expect(uploadWithProgress(file)).rejects.toThrow('#310');
    expect(drained()).toContain(`POST ${API_BASE_URL}/papers`);
  });

  it('on a raw socket is refused before it connects', async () => {
    const code = await new Promise<unknown>((resolve) => {
      http.get(`${NOWHERE}/`).on('error', (error) => resolve((error as { code?: unknown }).code));
    });
    expect(code).toBe('ECONNREFUSED');
    expect(drained()).toContain('TCP connect 127.0.0.1:1');
  });
});

describe('a test’s own mock', () => {
  it('vi.stubGlobal answers instead of the guard, and vi.unstubAllGlobals puts the guard back', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/topics')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(drained()).toBe('');

    vi.unstubAllGlobals();
    await expect(fetch(`${NOWHERE}/topics`)).rejects.toThrow('#310');
    expect(drained()).toContain(`GET ${NOWHERE}/topics`);
  });

  it('vi.spyOn(globalThis, "fetch") answers instead of the guard, and mockRestore puts it back', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    await expect(request('/topics')).resolves.toEqual([]);
    expect(spy).toHaveBeenCalledOnce();
    expect(drained()).toBe('');

    spy.mockRestore();
    await expect(fetch(`${NOWHERE}/topics`)).rejects.toThrow('#310');
    expect(drained()).toContain(`GET ${NOWHERE}/topics`);
  });
});
