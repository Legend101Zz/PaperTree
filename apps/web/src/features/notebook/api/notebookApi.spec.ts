/**
 * notebookApi.spec — the notebook client's routes, its cache keys, and the 409 path (#208). `fetch`
 * is the only stub; the 409 body is the API's real `stale_version` envelope (routers/notebooks.py).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/api/client';

import { isStaleVersion, notebookApi, notebookKeys } from './notebookApi';
import { pushItem } from './pushItem';

const fetchMock = vi.fn();

function answer(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: async () => text,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function calls(): string[] {
  return (fetchMock.mock.calls as [string, RequestInit][]).map(
    ([url, init]) => `${init.method ?? 'GET'} ${url.slice(API_BASE_URL.length)}`,
  );
}

const ITEM = {
  item_id: 'ni_item0001',
  page_id: 'np_page0001',
  kind: 'text',
  x: 56,
  y: 96,
  w: 288,
  h: 72,
  z: 1,
  body: 'note',
  anchor: null,
  version: 3,
  created_at: '2026-10-16T00:00:00Z',
  updated_at: '2026-10-16T00:00:00Z',
};

describe('cache keys', () => {
  it('scopes every key by paper, so one paper never reads another one`s pages', () => {
    expect(notebookKeys.page('ppr_A', 'np_1')).toEqual(['notebook', 'ppr_A', 'page', 'np_1']);
    expect(notebookKeys.pages('ppr_A')).toEqual(['notebook', 'ppr_A', 'pages']);
    for (const key of [notebookKeys.page('ppr_A', 'np_1'), notebookKeys.pages('ppr_A')]) {
      expect(key.slice(0, 2)).toEqual(['notebook', 'ppr_A']);
    }
    expect(notebookKeys.page('ppr_A', 'np_1')).not.toEqual(notebookKeys.page('ppr_B', 'np_1'));
  });
});

describe('routes', () => {
  it('goes where routers/notebooks.py says', async () => {
    fetchMock.mockImplementation(async () => answer(200, ITEM));
    await notebookApi.getPage('np_page0001');
    await notebookApi.listPages('ppr_A');
    await notebookApi.createItem('np_page0001', { ...ITEM, kind: 'text', anchor: undefined });
    await notebookApi.patchItem('np_page0001', 'ni_item0001', { version: 3, x: 64 });
    fetchMock.mockImplementation(async () => answer(204, undefined));
    await notebookApi.deleteItem('np_page0001', 'ni_item0001', 3);
    expect(calls()).toEqual([
      'GET /notebook/pages/np_page0001',
      'GET /papers/ppr_A/notebook/pages',
      'POST /notebook/pages/np_page0001/items',
      'PATCH /notebook/pages/np_page0001/items/ni_item0001',
      'DELETE /notebook/pages/np_page0001/items/ni_item0001?version=3',
    ]);
  });
});

describe('pushItem and the 409 path', () => {
  it('returns the saved version on success', async () => {
    fetchMock.mockImplementation(async () => answer(200, { ...ITEM, version: 4 }));
    const result = await pushItem('np_page0001', 'ni_item0001', {
      kind: 'patch',
      body: { version: 3, x: 56 },
    });
    expect(result).toEqual({
      kind: 'saved',
      saved: expect.objectContaining({ version: 4, x: 56 }),
    });
  });

  it('reports a stale version as a conflict and sends NOTHING more (no silent overwrite)', async () => {
    fetchMock.mockImplementation(async () =>
      answer(409, {
        detail: 'This item changed somewhere else. The latest version is shown; try again.',
        code: 'stale_version',
        retryable: false,
        current: { ...ITEM, version: 5, body: 'their edit' },
      }),
    );
    const result = await pushItem('np_page0001', 'ni_item0001', {
      kind: 'patch',
      body: { version: 3, body: 'my edit' },
    });
    expect(result).toEqual({ kind: 'conflict' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a delete over a newer edit as a conflict too (the version rides on the DELETE)', async () => {
    fetchMock.mockImplementation(async () =>
      answer(409, { detail: 'changed', code: 'stale_version', retryable: false }),
    );
    expect(await pushItem('np_page0001', 'ni_item0001', { kind: 'delete', version: 1 })).toEqual({
      kind: 'conflict',
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.endsWith('/items/ni_item0001?version=1')).toBe(true);
  });

  it('sorts the rest: gone, refused, deleted, failed', async () => {
    const notFound = answer(404, { detail: 'no', code: 'not_found', retryable: false });
    fetchMock.mockImplementation(async () => notFound);
    expect(await pushItem('np_page0001', 'ni_item0001', { kind: 'delete', version: 2 })).toEqual({
      kind: 'deleted',
    });
    fetchMock.mockImplementation(async () =>
      answer(404, { detail: 'no', code: 'not_found', retryable: false }),
    );
    const patch = { kind: 'patch', body: { version: 2, x: 8 } } as const;
    expect(await pushItem('np_page0001', 'ni_item0001', patch)).toEqual({ kind: 'gone' });
    fetchMock.mockImplementation(async () =>
      answer(422, { detail: 'body: too long', code: 'validation_failed', retryable: false }),
    );
    expect(await pushItem('np_page0001', 'ni_item0001', patch)).toEqual({
      kind: 'rejected',
      detail: 'body: too long',
    });
    fetchMock.mockImplementation(async () =>
      answer(500, { detail: 'x', code: 'internal', retryable: true }),
    );
    const failed = await pushItem('np_page0001', 'ni_item0001', patch);
    expect(failed.kind).toBe('failed');
    expect(isStaleVersion(failed.kind === 'failed' ? failed.error : null)).toBe(false);
  });

  it('sends keepalive while the page is being left', async () => {
    fetchMock.mockImplementation(async () => answer(200, ITEM));
    await pushItem(
      'np_page0001',
      'ni_item0001',
      { kind: 'patch', body: { version: 1, x: 1 } },
      {
        keepalive: true,
      },
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
  });
});
