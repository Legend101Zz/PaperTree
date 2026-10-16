/**
 * #177 in #204: deleting a highlight offers "Highlight deleted" with Undo, and Undo restores the
 * SAME highlight: the same id, colour and note and the same stored Anchor (its quads included), so
 * it paints where it did. Drives the real `useHighlights` + `HighlightUndoToast` through the real
 * API client with only `fetch` replaced, on a real committed parse (resnet, as s4-highlights-persist).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureAnchor, indexDocument, type Anchor, type PaperSource } from '@papertree/anchoring';

import { useHighlights, type UseHighlights } from '@/components/reader/useHighlights';
import { HighlightUndoToast } from '@/features/highlights';

const FIXTURE = join(
  process.cwd(),
  '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json',
);
const source = JSON.parse(readFileSync(FIXTURE, 'utf8')) as PaperSource & {
  parser: { version: string };
};
const PAPER = source.paper_id;
const doc = indexDocument(source, `api/${PAPER}/g1/${source.parser.version}`);
const block = doc.blocks.find((b) => b.type === 'paragraph' && b.textCodePoints.length > 80);
const ID = 'hl_01K0UNDO00000000000000001';

function stored(): Anchor {
  if (block === undefined) throw new Error('fixture has no paragraph');
  return captureAnchor({
    doc,
    blockId: block.id,
    startOffset: 5,
    endOffset: 45,
    targetKind: 'text',
    id: '6f0e4f8e-0000-4000-8000-0000000000aa',
    at: '2026-09-26T00:00:00.000Z',
    client: 'test',
  });
}

const ANCHOR = stored();
const row = (anchor: Anchor) => ({
  highlight_id: ID,
  color: 'green',
  note: 'the residual idea',
  created_generation: 1,
  created_at: '2026-10-16T00:00:00.000Z',
  updated_at: '2026-10-16T00:00:00.000Z',
  anchors: [{ anchor_id: anchor.id, ordinal: 0, anchor, resolution: null }],
});

interface Call {
  readonly method: string;
  readonly body: unknown;
}
let calls: Call[] = [];
let postStatus = 201;

beforeEach(() => {
  calls = [];
  postStatus = 201;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, body });
      if (method === 'GET') return Response.json([row(ANCHOR)]);
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'POST' && postStatus !== 201) {
        return Response.json({ detail: 'x', code: 'internal', retryable: true }, { status: 500 });
      }
      if (method === 'POST') return Response.json(row(ANCHOR), { status: 201 });
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(): () => UseHighlights {
  let latest: UseHighlights | null = null;
  function Harness() {
    const api = useHighlights({ paper: { kind: 'api', paperId: PAPER }, doc });
    useEffect(() => {
      latest = api;
    });
    return <HighlightUndoToast highlights={api} />;
  }
  render(<Harness />);
  return () => {
    if (latest === null) throw new Error('not mounted');
    return latest;
  };
}

async function deleteIt(hook: () => UseHighlights): Promise<void> {
  await waitFor(() => expect(hook().highlights).toHaveLength(1));
  await act(async () => {
    await hook().remove(ID);
  });
  expect(hook().highlights).toHaveLength(0);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Highlight deleted'));
}

describe('highlight delete with Undo (#177)', () => {
  it('Undo re-creates the same highlight: id, colour, note and the stored Anchor with its quads', async () => {
    const hook = mount();
    await deleteIt(hook);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(hook().highlights[0]?.status).toBe('saved'));

    const post = calls.find((c) => c.method === 'POST')?.body as {
      highlight_id: string;
      color: string;
      note: string | null;
      anchors: { anchor: Anchor }[];
    };
    expect(post.highlight_id).toBe(ID);
    expect(post.color).toBe('green');
    expect(post.note).toBe('the residual idea');
    // The stored Anchor goes back as it was (no client cache on the wire), quads and all.
    expect(post.anchors.map((a) => a.anchor)).toEqual([ANCHOR]);
    const shape = ANCHOR.selectors.find((s) => s.type === 'ShapeSelector');
    expect(shape).toBeDefined();
    const back = hook().highlights[0];
    expect(back?.highlightId).toBe(ID);
    expect(back?.anchors[0]?.anchor.selectors).toEqual(ANCHOR.selectors);
    expect(hook().removed).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('Dismiss lets it go: nothing is sent again', async () => {
    const hook = mount();
    await deleteIt(hook);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(hook().removed).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(hook().highlights).toHaveLength(0);
  });

  it('a restore that fails stays on the page, not saved, with the same id to retry', async () => {
    postStatus = 500;
    const hook = mount();
    await deleteIt(hook);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(hook().highlights[0]?.status).toBe('unsaved'));
    expect(hook().highlights[0]?.highlightId).toBe(ID);
    expect(hook().highlights[0]?.retryable).toBe(true);
  });
});
