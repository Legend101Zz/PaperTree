/**
 * lib/api/boards — every method and path, pinned to contracts.md §2.7.
 *
 * The expected rows are copied from the contract's route table, not from the module, so a
 * wrong verb or path fails here before S7's routes exist (they answer 501 until then). Wave 2's
 * `contracts.spec` checks the SHAPES of what crosses the wire; this checks WHERE it goes. Owned
 * by S7 after S0, with the module (slice-plan §3).
 *
 * `fetch` is the only stub. The anchor is an opaque placeholder: this pins the transport.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { boardsApi } from '@/lib/api/boards';
import { API_BASE_URL } from '@/lib/api/client';
import type { Anchor } from '@/lib/api/types';

const P = 'ppr_C425DTWW1KYMYDSWR205HB2069';
const B = 'brd_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const N = 'cn_0b7c6f8e-0d7c-4a55-9c7e-2f1e9b8a7d61';
const E = 'ce_5d1a2b3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
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

const NODE = {
  node_id: N,
  kind: 'excerpt' as const,
  x: 10,
  y: 20,
  w: 240,
  h: 120,
  source_anchor: ANCHOR,
};
const EDGE = { edge_id: E, from_node_id: N, to_node_id: 'cn_other-node-0001', kind: 'supports' as const };

describe('boardsApi — contracts §2.7 routes', () => {
  const rows: readonly [string, () => Promise<unknown>, string, string, unknown][] = [
    ['get', () => boardsApi.get(P), 'GET', `/papers/${P}/board`, undefined],
    ['createNode', () => boardsApi.createNode(P, NODE), 'POST', `/papers/${P}/board/nodes`, NODE],
    [
      'patchNode',
      () => boardsApi.patchNode(B, N, { version: 3, x: 11 }),
      'PATCH',
      `/boards/${B}/nodes/${N}`,
      { version: 3, x: 11 },
    ],
    ['deleteNode', () => boardsApi.deleteNode(B, N), 'DELETE', `/boards/${B}/nodes/${N}`, undefined],
    ['createEdge', () => boardsApi.createEdge(B, EDGE), 'POST', `/boards/${B}/edges`, EDGE],
    [
      'patchEdge',
      () => boardsApi.patchEdge(B, E, { kind: 'contradicts', label: 'no' }),
      'PATCH',
      `/boards/${B}/edges/${E}`,
      { kind: 'contradicts', label: 'no' },
    ],
    ['deleteEdge', () => boardsApi.deleteEdge(B, E), 'DELETE', `/boards/${B}/edges/${E}`, undefined],
    [
      'patchBoard',
      () => boardsApi.patchBoard(B, { viewport: { x: 1, y: 2, zoom: 0.5 } }),
      'PATCH',
      `/boards/${B}`,
      { viewport: { x: 1, y: 2, zoom: 0.5 } },
    ],
  ];

  for (const [name, call, method, path, body] of rows) {
    it(`${name} → ${method} ${path}`, async () => {
      await call();
      expect(sent()).toEqual({ method, path, body });
    });
  }
});
