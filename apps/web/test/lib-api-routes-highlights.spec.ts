/**
 * lib/api/highlights — every method and path, pinned to contracts.md §2.4.
 *
 * The expected rows are copied from the contract's route table, not from the module, so a
 * wrong verb or path fails here before the server exists. Wave 2's `contracts.spec` checks the
 * SHAPES of what crosses the wire; this checks WHERE it goes. Owned by S4 after S0, with the
 * module (slice-plan §3).
 *
 * `fetch` is the only stub. The anchors are opaque placeholders: this pins the transport, and
 * the Anchor's own shape is pinned by `anchor-schema.spec` in packages/anchoring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/api/client';
import { highlightsApi } from '@/lib/api/highlights';
import type { Anchor } from '@/lib/api/types';

const P = 'ppr_C425DTWW1KYMYDSWR205HB2069';
const H = 'hl_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const ANCHOR = { id: 'a1-placeholder' } as unknown as Anchor;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: async () => '{}',
  }));
});

/** What the one fetch call sent: the verb, the path under API_BASE_URL, and the parsed body. */
function sent(): { method: string; path: string; body: unknown } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url.startsWith(API_BASE_URL)).toBe(true);
  return {
    method: init.method ?? 'GET',
    path: url.slice(API_BASE_URL.length),
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

const CREATE = {
  highlight_id: H,
  color: 'amber' as const,
  note: null,
  anchors: [{ anchor: ANCHOR }],
};
const RESOLUTIONS = {
  generation: 2,
  items: [
    {
      anchor_id: 'a1-placeholder',
      tier: 3 as const,
      state: 'approximate' as const,
      block_ids: ['b_1'],
      score: 0.9,
      resolver_version: 'test',
    },
  ],
};

describe('highlightsApi — contracts §2.4 routes', () => {
  const rows: readonly [string, () => Promise<unknown>, string, string, unknown][] = [
    ['list', () => highlightsApi.list(P), 'GET', `/papers/${P}/highlights`, undefined],
    ['list ?gen=', () => highlightsApi.list(P, 2), 'GET', `/papers/${P}/highlights?gen=2`, undefined],
    ['create', () => highlightsApi.create(P, CREATE), 'POST', `/papers/${P}/highlights`, CREATE],
    [
      'update',
      () => highlightsApi.update(P, H, { color: 'green', note: 'n' }),
      'PATCH',
      `/papers/${P}/highlights/${H}`,
      { color: 'green', note: 'n' },
    ],
    ['remove', () => highlightsApi.remove(P, H), 'DELETE', `/papers/${P}/highlights/${H}`, undefined],
    [
      'putResolutions',
      () => highlightsApi.putResolutions(P, RESOLUTIONS),
      'PUT',
      `/papers/${P}/highlights/resolutions`,
      RESOLUTIONS,
    ],
  ];

  for (const [name, call, method, path, body] of rows) {
    it(`${name} → ${method} ${path}`, async () => {
      await call();
      expect(sent()).toEqual({ method, path, body });
    });
  }

  it('encodes ids as one path segment each, so an id cannot climb the path', async () => {
    await highlightsApi.remove('ppr_x/../y', 'hl_a?b');
    expect(sent().path).toBe('/papers/ppr_x%2F..%2Fy/highlights/hl_a%3Fb');
  });
});
