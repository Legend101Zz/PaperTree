/**
 * image-highlight: Note (and a colour) on a picture is a highlight over its REGION ONLY (v0.3 #348,
 * item 8). The API accepts an image anchor with no quoted text, so the create is one POST whose
 * anchor is the picture's, the page paints it from its stored rectangle, and the unanchored tray
 * does not take it for text it could not find.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type IndexedDocument, type PaperSource } from '@papertree/anchoring';

import { paintItemsOf } from '@/components/reader/SourcePane';
import { useHighlights, type UseHighlights } from '@/components/reader/useHighlights';
import { buildImageAnchor, isImageAnchor } from '@/lib/imageAnchor';

const source = JSON.parse(
  readFileSync(
    join(process.cwd(), '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json'),
    'utf8',
  ),
) as PaperSource & { parser: { version: string } };
const PAPER = source.paper_id;
const doc: IndexedDocument = indexDocument(source, `api/${PAPER}/g1/${source.parser.version}`);
const figure = doc.blocks.find((b) => b.type === 'figure');

interface Call {
  readonly method: string;
  readonly body: unknown;
}
let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      const body = (init?.method ?? 'GET') === 'GET' ? [] : null;
      return new Response(body === null ? null : JSON.stringify(body), {
        status: body === null ? 204 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(): { current: () => UseHighlights } {
  let latest: UseHighlights | null = null;
  function Harness() {
    const api = useHighlights({
      paper: { kind: 'api', paperId: PAPER },
      doc,
      onNotice: () => undefined,
    });
    useEffect(() => {
      latest = api;
    });
    return null;
  }
  render(<Harness />);
  return { current: () => latest as UseHighlights };
}

describe('a highlight over a picture', () => {
  it('is one POST with the image anchor (page and one quad, no quote) and its resolution', async () => {
    if (figure === undefined) throw new Error('fixture has no figure');
    const anchor = buildImageAnchor({
      doc,
      page: figure.pageIndex,
      box: figure.bbox,
      kind: 'figure',
      block: figure,
      id: '7e1f0c3a-5b2d-4c8e-9a64-1d2e3f4a5b6c',
      at: '2026-11-20T10:00:00.000Z',
      client: 'test',
    });
    const hook = mount();
    await waitFor(() => expect(hook.current().load).toBe('ready'));
    const made = await hook.current().create([anchor], 'amber');
    expect(made).not.toBeNull();
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!.body as {
      anchors: { anchor: typeof anchor }[];
      resolutions: { anchor_id: string }[];
    };
    expect(post.anchors).toHaveLength(1);
    expect(post.anchors[0]?.anchor.targetKind).toBe('figure');
    expect(isImageAnchor(post.anchors[0]?.anchor)).toBe(true);
    expect(post.resolutions.map((r) => r.anchor_id)).toEqual([anchor.id]);
  });

  it('paints from its stored rectangle and is not an orphan for having no words', () => {
    if (figure === undefined) throw new Error('fixture has no figure');
    const anchor = buildImageAnchor({
      doc,
      page: figure.pageIndex,
      box: [100, 120, 300, 260],
      kind: 'figure_region',
      id: 'region-1',
      at: '2026-11-20T10:00:00.000Z',
      client: 'test',
    });
    const { items, unplaced } = paintItemsOf(doc, [
      {
        highlightId: 'hl_1',
        color: 'amber',
        note: 'why this curve?',
        createdAt: '2026-11-20T10:00:00.000Z',
        anchors: [{ anchor, resolution: { state: 'orphan', pageIndex: null } as never }],
        status: 'saved',
      } as never,
    ]);
    expect(unplaced).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]?.quads).toEqual([[100, 120, 300, 260]]);
    expect(items[0]?.label).toBe('picture');
  });
});
