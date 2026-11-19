/**
 * useFocusFromCanvas: the reader's half of a card's source link. A citation's anchor is read off the
 * board's own node (`citations`, read with the board), never from a thread scan (#344, #349).
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FOCUS_SETTLE_MS, useFocusFromCanvas } from '@/components/canvas/useFocusFromCanvas';
import { boardsApi } from '@/lib/api/boards';
import { threadsApi } from '@/lib/api/threads';

import type { Anchor } from '@papertree/anchoring';
import type { CanvasNode } from '@/lib/api/types';

const query = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.value) }));
vi.mock('@/lib/api/boards', () => ({ boardsApi: { get: vi.fn() } }));
vi.mock('@/lib/api/threads', () => ({ threadsApi: { list: vi.fn(), get: vi.fn() } }));

const at = (id: string): Anchor => ({ id, selectors: [] }) as unknown as Anchor;
const nodes = [
  { node_id: 'cn_p', source_anchor: at('passage'), citations: null },
  {
    node_id: 'cn_a',
    source_anchor: null,
    citations: [{ citation_id: 'cit_1', anchor: at('cited') }],
  },
] as unknown as CanvasNode[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(boardsApi.get).mockResolvedValue({ board: null, nodes, edges: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function focused(search: string): Promise<Anchor | null> {
  query.value = search;
  const focus = vi.fn();
  renderHook(() => useFocusFromCanvas('ppr_1', true, focus));
  await vi.advanceTimersByTimeAsync(FOCUS_SETTLE_MS + 50);
  return focus.mock.calls[0]?.[0] ?? null;
}

describe('a source link opens the reader on its passage', () => {
  it('flashes a passage card’s own anchor', async () => {
    expect((await focused('focus=cn_p'))?.id).toBe('passage');
  });
  it('flashes the cited passage of an answer, from the node, with no thread read', async () => {
    expect((await focused('focus=cn_a&cite=cit_1'))?.id).toBe('cited');
    expect(threadsApi.list).not.toHaveBeenCalled();
    expect(threadsApi.get).not.toHaveBeenCalled();
  });
  it('is quiet for a citation that is gone', async () => {
    expect(await focused('focus=cn_a&cite=cit_gone')).toBeNull();
  });
});
