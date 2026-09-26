/**
 * s4-remount-arraybuffer — an uploaded paper's PDF survives a mode switch (slice-plan §S4).
 *
 * THE BASELINE DEFECT (journey-baseline §B): for an API paper the PDF arrives as an `ArrayBuffer`,
 * and pdf.js TRANSFERS the buffer it is given to its worker — which detaches it (0 bytes). The
 * provider lived inside `SourcePane`, so Source → Guided → Source unmounted it, and the remount
 * called `getDocument` again on the detached buffer: the uploaded paper went blank until a reload.
 * A fixture passed a URL string, which is why only uploads broke.
 *
 * THE FAKE HERE DOES WHAT pdf.js DOES: `getDocument` transfers whatever buffer it is handed
 * (`ArrayBuffer.prototype.transfer`, Node 22) and refuses a detached one, as the real worker does.
 * Two properties, each of which the baseline fails:
 *
 *   1. the provider hands pdf.js a COPY, so the caller's bytes are never detached and a second
 *      open of the same bytes (a retry, a remount) still works;
 *   2. the WORKSPACE opens the PDF once per session: Source → Guided → Source → Split → Source is
 *      one `getDocument`, and the pages are there each time Source comes back.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type PaperSource } from '@papertree/anchoring';

import { PdfDocumentProvider, usePdfDocument } from '@/components/reader/PdfDocumentProvider';

const FIXTURE = join(process.cwd(), '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json');
const paper = JSON.parse(readFileSync(FIXTURE, 'utf8')) as PaperSource & { ir_version?: string };
const doc = indexDocument(paper, `api/${paper.paper_id}/g1/0.1.0`);

const pdf = vi.hoisted(() => ({
  opens: 0,
  refused: 0,
  bytes: new ArrayBuffer(0),
}));

/** The part of the data a real `getDocument` input can carry. */
function bufferOf(input: unknown): ArrayBuffer | null {
  if (input instanceof ArrayBuffer) return input;
  if (typeof input === 'object' && input !== null && 'data' in input) {
    const data = (input as { data: unknown }).data;
    if (data instanceof Uint8Array) return data.buffer as ArrayBuffer;
    if (data instanceof ArrayBuffer) return data;
  }
  return null;
}

vi.mock('@/lib/pdf/worker', () => ({
  getPdfjs: () =>
    Promise.resolve({
      version: '5.7.284',
      TextLayer: class {
        readonly textDivs: HTMLElement[] = [];
        constructor(private readonly args: { container: HTMLElement }) {}
        render() {
          const span = document.createElement('span');
          span.textContent = 'Deep Residual Learning';
          this.args.container.append(span);
          this.textDivs.push(span);
          return Promise.resolve();
        }
        cancel() {}
      },
      getDocument: (input: unknown) => {
        pdf.opens += 1;
        const buffer = bufferOf(input);
        if (buffer !== null && buffer.byteLength === 0) {
          pdf.refused += 1;
          return { promise: Promise.reject(new Error('Invalid PDF structure: the buffer is detached')), destroy: () => Promise.resolve() };
        }
        // What the worker transfer does to the caller's buffer.
        if (buffer !== null) (buffer as ArrayBuffer & { transfer(): ArrayBuffer }).transfer();
        return {
          promise: Promise.resolve({
            numPages: 2,
            getPage: (n: number) =>
              Promise.resolve({
                pageNumber: n,
                rotate: 0,
                userUnit: 1,
                view: [0, 0, 612, 792],
                getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale, scale }),
                render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
                getTextContent: () =>
                  Promise.resolve({ items: [{ str: 'Deep Residual Learning', transform: [10, 0, 0, 10, 72, 700], width: 120, height: 10 }], styles: {} }),
              }),
            destroy: () => Promise.resolve(),
          }),
          destroy: () => Promise.resolve(),
        };
      },
    }),
}));

vi.mock('@/lib/paperSource', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/paperSource')>();
  return {
    ...original,
    loadDocument: async () => doc,
    // The API path's shape: the PDF as bytes (the file route needs a bearer header).
    pdfSourceFor: async () => pdf.bytes,
  };
});

beforeEach(() => {
  pdf.opens = 0;
  pdf.refused = 0;
  pdf.bytes = new TextEncoder().encode('%PDF-1.7 fake bytes for the transfer').buffer as ArrayBuffer;
  // happy-dom lays nothing out; give the scroller a size so pages mount.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe() {
  const value = usePdfDocument();
  return <p data-testid="probe">{value.error !== null ? `error: ${value.error.message}` : value.pdf === null ? 'loading' : `open ${String(value.numPages)}`}</p>;
}

describe('s4: the PDF bytes survive a remount', () => {
  it('the provider opens a COPY, so the same bytes open again after a remount', async () => {
    const bytes = pdf.bytes;
    const size = bytes.byteLength;
    const first = render(
      <PdfDocumentProvider src={bytes}>
        <Probe />
      </PdfDocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('open 2'));
    expect(bytes.byteLength, "the caller's buffer was transferred away").toBe(size);
    first.unmount();

    render(
      <PdfDocumentProvider src={bytes}>
        <Probe />
      </PdfDocumentProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('open 2'));
    expect(pdf.refused).toBe(0);
    expect(pdf.opens).toBe(2);
  });

  it('a PDF pdf.js cannot open is a designed state with Try again, not a blank pane', async () => {
    const { SourcePane } = await import('@/components/reader/SourcePane');
    const { ReaderActionsProvider } = await import('@/components/reader/actions');
    render(
      <PdfDocumentProvider src={new ArrayBuffer(0)}>
        <ReaderActionsProvider value={{ openExplain: () => undefined, sendToCanvas: async () => undefined, focusAnchor: () => undefined }}>
          <SourcePane
            doc={doc}
            zoom={1}
            highlights={[]}
            onCreateHighlight={() => undefined}
            highlightUnavailableReason={null}
            onActivateHighlight={() => undefined}
            activeHighlightId={null}
            flash={null}
            narrow={false}
            onViewportResize={() => undefined}
            onSelectionChange={() => undefined}
            documentRef={{ current: null }}
            initialPosition={null}
            onPositionChange={() => undefined}
          />
        </ReaderActionsProvider>
      </PdfDocumentProvider>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This PDF could not be opened');
    // A designed sentence, never pdf.js's own text (s4-review.md F7).
    expect(alert.textContent).not.toMatch(/Invalid PDF structure|detached/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('the workspace opens the PDF once across Source → Guided → Source → Split → Source', async () => {
    const { ReaderWorkspace } = await import('@/app/paper/[id]/read/ReaderWorkspace');
    render(<ReaderWorkspace paper={{ kind: 'api', paperId: paper.paper_id }} />);
    const pages = () => document.querySelectorAll('.papertree-page').length;
    await waitFor(() => expect(pages()).toBeGreaterThan(0), { timeout: 5000 });

    const switchTo = async (name: string) => {
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name }));
      });
    };
    await switchTo('Guided');
    await waitFor(() => expect(document.querySelector('[data-guided-root]')).not.toBeNull());
    expect(pages()).toBe(0);
    await switchTo('Source');
    await waitFor(() => expect(pages()).toBeGreaterThan(0), { timeout: 5000 });
    await switchTo('Split');
    await waitFor(() => expect(document.querySelector('[data-split-pane="source"] .papertree-page')).not.toBeNull(), {
      timeout: 5000,
    });
    await switchTo('Source');
    await waitFor(() => expect(pages()).toBeGreaterThan(0), { timeout: 5000 });

    expect(screen.queryByText(/This PDF could not be opened/)).toBeNull();
    expect(pdf.refused).toBe(0);
    expect(pdf.opens, 'one getDocument for the whole session').toBe(1);
  });
});
