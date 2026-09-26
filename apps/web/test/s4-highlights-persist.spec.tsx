/**
 * s4-highlights-persist — the reader's highlights reach the API, and come back (#138).
 *
 * THE BASELINE STORED NOTHING: highlights lived in a component's state, no request ever reached
 * `/papers/{id}/highlights`, and a reload started empty (journey-baseline §B). `useHighlights` is
 * the one owner now. This drives it through the REAL `lib/api/highlights.ts` and `client.ts`, with
 * only `fetch` replaced, on a real committed parse indexed the way an API document is
 * (`api/<paper>/g1/<parser>`):
 *
 *   - open: GET, resolve every anchor against the document, PUT the resolutions the server lacks,
 *     and upgrade a `legacy-0001` row with a full record for the same block (ADR-002 §6.3);
 *   - create: ONE POST with every anchor and its resolutions under a client-minted `hl_` id; a
 *     failed POST leaves the highlight on the page, "unsaved", and Retry resends the same id;
 *   - PATCH a colour; a failed DELETE puts the highlight back and says so.
 *
 * The live half — the rows in sqlite, the reload repainting the same quads — is e2e/s4/journey-b.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureAnchor,
  indexDocument,
  RESOLVER_VERSION,
  type Anchor,
  type IndexedDocument,
  type PaperSource,
} from '@papertree/anchoring';

import { useHighlights, type UseHighlights } from '@/components/reader/useHighlights';

const FIXTURE = join(process.cwd(), '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json');
const source = JSON.parse(readFileSync(FIXTURE, 'utf8')) as PaperSource & { parser: { version: string } };
const PAPER = source.paper_id;
const doc: IndexedDocument = indexDocument(source, `api/${PAPER}/g1/${source.parser.version}`);
const paragraphs = doc.blocks.filter((b) => b.type === 'paragraph' && b.textCodePoints.length > 80);

function capture(blockIndex: number, id: string): Anchor {
  const block = paragraphs[blockIndex];
  if (block === undefined) throw new Error('fixture has too few paragraphs');
  return captureAnchor({
    doc,
    blockId: block.id,
    startOffset: 5,
    endOffset: 45,
    targetKind: 'text',
    id,
    at: '2026-09-26T00:00:00.000Z',
    client: 'test',
  });
}

/** A 0005-converted row: Block + Page + Shape of the WHOLE block, no quote, `legacy-0001`. */
function legacy(id: string): Anchor {
  const block = paragraphs[2];
  if (block === undefined) throw new Error('fixture has too few paragraphs');
  const page = doc.pages.find((p) => p.index === block.pageIndex);
  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id,
    doc: { paperId: PAPER, pdfSha256: doc.sourceHash, parserVersion: doc.parserVersion, textStreamId: 'legacy-0001' },
    targetKind: 'text',
    provenanceClass: 'source',
    selectors: [
      { type: 'BlockSelector', blockId: block.id, blockTextHash: block.contentHash },
      { type: 'PageSelector', index: block.pageIndex },
      {
        type: 'ShapeSelector',
        pageIndex: block.pageIndex,
        quads: [block.bbox],
        polygons: [block.polygon],
        pageWidth: page?.width ?? 612,
        pageHeight: page?.height ?? 792,
        rotation: 0,
        userUnit: 1,
        cropBox: [0, 0, page?.width ?? 612, page?.height ?? 792],
      },
    ],
    created: { mode: 'source', at: '2026-08-01T00:00:00.000Z', client: 'legacy-0001' },
  };
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

let calls: Call[] = [];
let answer: (call: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: [] });

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        path: new URL(url).pathname + new URL(url).search,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      const { status, body } = answer(call);
      return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ onReady }: { readonly onReady: (api: UseHighlights) => void }) {
  const api = useHighlights({ paper: { kind: 'api', paperId: PAPER }, doc, onNotice: () => undefined });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

function mount(): { current: () => UseHighlights } {
  let latest: UseHighlights | null = null;
  render(
    <Harness
      onReady={(api) => {
        latest = api;
      }}
    />,
  );
  return {
    current: () => {
      if (latest === null) throw new Error('not mounted');
      return latest;
    },
  };
}

const wire = (highlightId: string, anchors: readonly Anchor[], color = 'amber') => ({
  highlight_id: highlightId,
  color,
  note: null,
  created_generation: 1,
  created_at: '2026-09-26T00:00:00.000Z',
  updated_at: '2026-09-26T00:00:00.000Z',
  anchors: anchors.map((anchor, ordinal) => ({ anchor_id: anchor.id, ordinal, anchor, resolution: null })),
});

describe('s4: highlights persist through the API', () => {
  it('on open: GETs, resolves, PUTs the missing resolutions, and upgrades a legacy row', async () => {
    const saved = capture(0, '6f0e4f8e-0000-4000-8000-000000000001');
    const old = legacy('anc_01K0LEGACY0000000000001');
    answer = (call) =>
      call.method === 'GET'
        ? { status: 200, body: [wire('hl_01K0SAVED0000000000000001', [saved]), wire('hl_01K0LEGACY000000000000001', [old])] }
        : { status: 204 };
    const hook = mount();
    await waitFor(() => expect(hook.current().load).toBe('ready'));
    expect(hook.current().highlights).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: 'GET', path: `/papers/${PAPER}/highlights?gen=1` });

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT') as Call;
    expect(put.path).toBe(`/papers/${PAPER}/highlights/resolutions`);
    const body = put.body as { generation: number; items: { anchor_id: string; resolver_version: string; tier: number; upgraded_anchor?: Anchor }[] };
    expect(body.generation).toBe(1);
    expect(body.items.map((i) => i.anchor_id).sort()).toEqual([old.id, saved.id].sort());
    for (const item of body.items) expect(item.resolver_version).toBe(RESOLVER_VERSION);
    const upgraded = body.items.find((i) => i.anchor_id === old.id)?.upgraded_anchor;
    // The upgrade is a §6-complete record for the SAME anchor id: a quote, a page, quads, the IR stream.
    expect(upgraded?.id).toBe(old.id);
    expect(upgraded?.doc.textStreamId).toBe(doc.textStreamId);
    expect(upgraded?.selectors.map((s) => s.type)).toEqual(
      expect.arrayContaining(['BlockSelector', 'PageSelector', 'TextQuoteSelector', 'ShapeSelector']),
    );
    expect(body.items.find((i) => i.anchor_id === saved.id)?.upgraded_anchor).toBeUndefined();
  });

  it('create: one POST with every anchor; a failure stays on the page unsaved, and Retry resends the same id', async () => {
    let posts = 0;
    answer = (call) => {
      if (call.method === 'GET') return { status: 200, body: [] };
      if (call.method === 'POST') {
        posts += 1;
        if (posts === 1) return { status: 503, body: { detail: 'the database is busy', code: 'internal', retryable: true } };
        const sent = call.body as { highlight_id: string; anchors: { anchor: Anchor }[] };
        return { status: 201, body: wire(sent.highlight_id, sent.anchors.map((a) => a.anchor)) };
      }
      return { status: 204 };
    };
    const hook = mount();
    await waitFor(() => expect(hook.current().load).toBe('ready'));
    const anchors = [capture(0, '6f0e4f8e-0000-4000-8000-00000000000a'), capture(1, '6f0e4f8e-0000-4000-8000-00000000000b')];
    await act(async () => {
      await hook.current().create(anchors, 'blue');
    });
    await waitFor(() => expect(hook.current().highlights[0]?.status).toBe('unsaved'));
    const first = calls.find((c) => c.method === 'POST') as Call;
    const sent = first.body as {
      highlight_id: string;
      color: string;
      anchors: { anchor: Anchor }[];
      resolutions: { anchor_id: string; generation: number; resolver_version: string }[];
    };
    expect(first.path).toBe(`/papers/${PAPER}/highlights`);
    expect(sent.highlight_id).toMatch(/^hl_[0-9A-Z]{26}$/);
    expect(sent.color).toBe('blue');
    expect(sent.anchors.map((a) => a.anchor.id)).toEqual(anchors.map((a) => a.id));
    expect(sent.resolutions.map((r) => [r.anchor_id, r.generation, r.resolver_version])).toEqual(
      anchors.map((a) => [a.id, 1, RESOLVER_VERSION]),
    );
    expect(hook.current().highlights[0]?.error).toMatch(/Couldn't save this highlight/);

    await act(async () => {
      await hook.current().retry(sent.highlight_id);
    });
    await waitFor(() => expect(hook.current().highlights[0]?.status).toBe('saved'));
    const retried = calls.filter((c) => c.method === 'POST')[1] as Call;
    expect((retried.body as { highlight_id: string }).highlight_id).toBe(sent.highlight_id);
  });

  it('a colour change PATCHes; a failed delete puts the highlight back', async () => {
    const saved = capture(0, '6f0e4f8e-0000-4000-8000-000000000021');
    answer = (call) => {
      if (call.method === 'GET') return { status: 200, body: [wire('hl_01K0SAVED0000000000000021', [saved])] };
      if (call.method === 'PATCH') return { status: 200, body: wire('hl_01K0SAVED0000000000000021', [saved], 'pink') };
      if (call.method === 'DELETE') return { status: 500, body: { detail: 'boom', code: 'internal', retryable: false } };
      return { status: 204 };
    };
    const hook = mount();
    await waitFor(() => expect(hook.current().highlights).toHaveLength(1));
    await act(async () => {
      await hook.current().update('hl_01K0SAVED0000000000000021', { color: 'pink' });
    });
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: `/papers/${PAPER}/highlights/hl_01K0SAVED0000000000000021`,
      body: { color: 'pink' },
    });
    expect(hook.current().highlights[0]?.color).toBe('pink');
    await act(async () => {
      await hook.current().remove('hl_01K0SAVED0000000000000021');
    });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(hook.current().highlights).toHaveLength(1);
  });
});
