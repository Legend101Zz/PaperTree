/**
 * reader/actions — the ReaderActions context and its S0 wiring (contracts.md §5).
 *
 * The provider is only worth anything at its MOUNT SITE: a context that works in isolation and is
 * mounted by nothing is #58 again. So the second half of this file renders the real
 * `ReaderWorkspace` (on a real committed parse) and reaches the actions from INSIDE the tree, the
 * way S4's toolbar, S6's chips and S7's canvas will — through `useReaderActions()`.
 *
 * Stubbed, and only because happy-dom cannot run them: the PDF (`PdfDocumentProvider`), the
 * scroller (`VirtualPageList`, replaced by a spy with the same imperative handle, as in
 * `citation-scroll.spec`), and the document loader (which would `fetch` a file under `public/`).
 * `ModeSwitch` is replaced by a PROBE that calls the three actions; it sits in the toolbar, inside
 * the provider, which is exactly where a real caller will be.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureAnchor, indexDocument, type Anchor, type PaperSource } from '@papertree/anchoring';
import { DERIVED_MARKER } from '@papertree/ui';

import {
  ReaderActionsProvider,
  useReaderActions,
  type ReaderActions,
} from '@/components/reader/actions';

const FIXTURE = join(process.cwd(), '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json');
const paper = JSON.parse(readFileSync(FIXTURE, 'utf8')) as PaperSource & { ir_version?: string };
const doc = indexDocument(paper, `fixture/${paper.ir_version ?? 'unknown'}`);

const probe = vi.hoisted(() => ({
  anchor: null as unknown,
  quote: '',
  scrolls: [] as { readonly page: number; readonly bbox: readonly number[] }[],
  sent: [] as Promise<void>[],
}));

vi.mock('@/components/reader/VirtualPageList', () => ({
  VirtualPageList: forwardRef<unknown, Record<string, unknown>>(function VirtualPageListSpy(_props, ref) {
    useImperativeHandle(ref, () => ({
      scrollToPage: () => undefined,
      scrollToBlock(pageIndex: number, bbox: readonly number[]) {
        probe.scrolls.push({ page: pageIndex, bbox });
      },
      getVisiblePages: () => ({ first: 0, last: 0 }),
      getScrollElement: () => null,
    }));
    return <div data-testid="scroller" />;
  }),
}));

vi.mock('@/components/reader/PdfDocumentProvider', () => ({
  PdfDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  pageUnitSize: () => ({ width: 612, height: 792 }),
  usePdfDocument: () => ({ document: null, pages: [], error: null }),
}));

vi.mock('@/lib/paperSource', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/paperSource')>();
  const { indexDocument: index } = await import('@papertree/anchoring');
  const { readFileSync: read } = await import('node:fs');
  const { join: joinPath } = await import('node:path');
  const source = JSON.parse(
    read(
      joinPath(process.cwd(), '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json'),
      'utf8',
    ),
  ) as PaperSource & { ir_version?: string };
  const indexed = index(source, `fixture/${source.ir_version ?? 'unknown'}`);
  return {
    ...original,
    loadDocument: async () => indexed,
    pdfSourceFor: async () => 'fixture://paper.pdf',
  };
});

vi.mock('@/components/reader/ModeSwitch', async () => {
  const { useReaderActions: use } = await import('@/components/reader/actions');
  return {
    ModeSwitch: function ActionsProbe() {
      const actions = use();
      return (
        <div>
          <button
            type="button"
            onClick={() => actions.openExplain({ anchor: probe.anchor as Anchor, quote: probe.quote })}
          >
            probe explain
          </button>
          <button
            type="button"
            onClick={() => {
              probe.sent.push(actions.sendToCanvas({ kind: 'excerpt', anchor: probe.anchor as Anchor }));
            }}
          >
            probe canvas
          </button>
          <button type="button" onClick={() => actions.focusAnchor(probe.anchor as Anchor)}>
            probe focus
          </button>
        </div>
      );
    },
  };
});

const fetchMock = vi.fn();
const xhrConstructed = vi.fn();

beforeEach(() => {
  probe.scrolls.length = 0;
  probe.sent.length = 0;
  fetchMock.mockReset();
  xhrConstructed.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      constructor() {
        xhrConstructed();
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReaderActions — the context', () => {
  it('refuses to be used outside a provider instead of handing out no-ops', () => {
    function Orphan() {
      useReaderActions();
      return null;
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Orphan />)).toThrow(/outside <ReaderActionsProvider>/);
    consoleError.mockRestore();
  });

  it('hands every consumer the value the provider was given', () => {
    const value: ReaderActions = {
      openExplain: vi.fn(),
      sendToCanvas: vi.fn(async () => undefined),
      focusAnchor: vi.fn(),
    };
    let seen: ReaderActions | null = null;
    function Consumer() {
      seen = useReaderActions();
      return null;
    }
    render(
      <ReaderActionsProvider value={value}>
        <Consumer />
      </ReaderActionsProvider>,
    );
    expect(seen).toBe(value);
  });
});

describe('ReaderActions — mounted by ReaderWorkspace, reached from inside the reader', () => {
  // A body block off page 0, so a scroll to page 0 cannot pass by accident.
  const target = doc.blocks.find(
    (block) => block.pageIndex > 0 && block.type === 'paragraph' && block.text.length > 40,
  );

  async function mountReader(): Promise<void> {
    expect(target, 'the fixture must have a paragraph off page 0').toBeDefined();
    probe.anchor = captureAnchor({
      doc,
      blockId: target!.id,
      targetKind: 'text',
      id: '6f0e4f8e-7f0e-4e4b-9e8a-3c1f7c2f9a10',
      at: '1970-01-01T00:00:00.000Z',
      client: 'papertree-web/test',
    });
    probe.quote = target!.text.slice(0, 40);
    const { ReaderWorkspace } = await import('@/app/paper/[id]/read/ReaderWorkspace');
    render(<ReaderWorkspace paper={{ kind: 'fixture', slug: 'resnet-cvpr-2col' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'probe explain' })).toBeTruthy());
  }

  it('the fixture is real, so nothing below is measuring a stub', () => {
    expect(doc.blocks.length).toBeGreaterThan(50);
    expect(target).toBeDefined();
  });

  it('openExplain opens the placeholder panel on the quote, in the paper register, sending nothing', async () => {
    await mountReader();
    expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'probe explain' }));

    const panel = screen.getByRole('complementary', { name: 'Explain' });
    const quote = panel.querySelector('[data-register="paper"]');
    expect(quote?.querySelector('.pt-paper__text')?.textContent).toBe(probe.quote);
    expect(quote?.querySelector('cite')?.textContent).toBe(`p. ${String(target!.pageIndex + 1)}`);
    // The panel holds the paper's words and no model output, so it must not wear the AI mark.
    expect(panel.textContent).not.toContain(DERIVED_MARKER);
    expect(panel.textContent).toContain('Nothing was sent.');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Explain' })).toBeNull();
  });

  it('sendToCanvas resolves, says so, and makes no request of any kind', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await mountReader();

    fireEvent.click(screen.getByRole('button', { name: 'probe canvas' }));

    expect(probe.sent).toHaveLength(1);
    await expect(probe.sent[0]).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toMatch(/Send to canvas \(excerpt\) is not connected yet/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(xhrConstructed).not.toHaveBeenCalled();
  });

  it("focusAnchor resolves the anchor and scrolls the document to ITS block's page", async () => {
    await mountReader();
    await waitFor(() => expect(screen.getByTestId('scroller')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'probe focus' }));

    expect(probe.scrolls).toEqual([{ page: target!.pageIndex, bbox: target!.bbox }]);
  });
});

describe('the mount site itself', () => {
  it('ReaderWorkspace mounts the provider and the explain panel, with the stub implementations', () => {
    // A source assertion, like journey-wiring's D6: the behaviour above proves the wiring works,
    // this pins WHERE it is, so a refactor that drops the mount fails with a named reason.
    const source = readFileSync(
      join(process.cwd(), 'src/app/paper/[id]/read/ReaderWorkspace.tsx'),
      'utf8',
    );
    expect(source).toContain('<ReaderActionsProvider value={actions}>');
    expect(source).toContain('<ExplainPanel controller={explain} />');
    expect(source).toContain('sendToCanvas: (input) => sendToCanvas(paperId, input)');
  });
});
