import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from '@/lib/api/client';
import { threadsApi } from '@/lib/api/threads';

vi.mock('@/lib/api/client', () => ({
  request: vi.fn(() => Promise.resolve([])),
  streamSse: vi.fn(),
}));

afterEach(() => vi.mocked(request).mockClear());

describe('threadsApi.list', () => {
  it("is the reader's list by default: a board answer's thread is not in it", async () => {
    await threadsApi.list('ppr_1');
    expect(request).toHaveBeenCalledWith('/papers/ppr_1/threads');
  });

  it('asks for the board threads too only when the board reads its own answers', async () => {
    await threadsApi.list('ppr_1', { includeBoard: true });
    expect(request).toHaveBeenCalledWith('/papers/ppr_1/threads?include_board=true');
  });
});
