/**
 * page-mats: figures keep their own colours on a dark or sepia page (#345).
 *
 * Source recolours the whole PDF canvas with a CSS filter (see `PageMats.tsx` for why that and not
 * pdf.js's `pageColors`), so a plot would come out as a negative. The parser's `figure` and `image`
 * boxes are drawn back from the same canvas on a mat. These tests pin which boxes those are, that
 * the mat is there on a dark page (and on sepia) and not on a light one, and that the pixels come
 * from the page's own canvas at its own resolution. The stylesheet half (the filter, the mat
 * colours) is read as text, the way `tokens.spec.ts` does.
 */
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IndexedBlock } from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

import { figureRegions } from '@/components/reader/figureRegions';
import { PageMats } from '@/components/reader/PageMats';
import { PdfPage } from '@/components/reader/PdfPage';
import { PAGE_ATTRIBUTE } from '@/features/settings';

vi.mock('@/components/reader/PdfDocumentProvider', async (original) => ({
  ...(await original<typeof import('@/components/reader/PdfDocumentProvider')>()),
  usePdfDocument: () => ({
    pdf: null,
    pdfjsVersion: null,
    numPages: 1,
    pageMeta: new Map([
      [
        0,
        {
          index: 0,
          width: 600,
          height: 800,
          rotate: 0,
          userUnit: 1,
          view: [0, 0, 600, 800],
          frame: {},
        },
      ],
    ]),
  }),
}));

function block(type: string, bbox: BBox, id = `${type}-${bbox.join('-')}`): IndexedBlock {
  return { id, type, bbox, pageIndex: 0 } as unknown as IndexedBlock;
}

describe('figureRegions', () => {
  it('takes figure and image boxes and nothing else', () => {
    const regions = figureRegions([
      block('paragraph', [0, 0, 600, 100]),
      block('figure', [100, 200, 500, 400]),
      block('image', [100, 500, 300, 600]),
      block('caption', [100, 410, 500, 440]),
      block('equation', [100, 700, 500, 740]),
    ]);
    expect(regions).toEqual([
      [100, 200, 500, 400],
      [100, 500, 300, 600],
    ]);
  });

  it('keeps the whole crop of a multi-panel figure, not a mat per panel', () => {
    const regions = figureRegions([
      block('figure', [100, 200, 500, 400]),
      block('figure', [110, 210, 300, 390]),
      block('figure', [310, 210, 490, 390]),
    ]);
    expect(regions).toEqual([[100, 200, 500, 400]]);
  });

  it('keeps one of a duplicated pair, and ignores empty boxes', () => {
    expect(
      figureRegions([
        block('figure', [100, 200, 500, 400], 'a'),
        block('image', [100, 200, 500, 400], 'b'),
        block('figure', [0, 0, 0, 0], 'c'),
      ]),
    ).toEqual([[100, 200, 500, 400]]);
  });

  it('turns a scanned page (one image the size of the page) into one page-sized region', () => {
    expect(figureRegions([block('image', [0, 0, 600, 800])])).toEqual([[0, 0, 600, 800]]);
  });
});

describe('PageMats', () => {
  afterEach(cleanup);

  it('puts one mat per region at its IR box times the scale', () => {
    const { container } = render(
      <PageMats
        source={null}
        paints={0}
        regions={[
          [100, 200, 500, 400],
          [100, 500, 300, 600],
        ]}
        irScale={1.5}
        cssWidth={900}
        cssHeight={1200}
      />,
    );
    const mats = Array.from(container.querySelectorAll<HTMLElement>('[data-papertree-mat]'));
    expect(mats).toHaveLength(2);
    expect(mats[0]?.style.left).toBe('150px');
    expect(mats[0]?.style.top).toBe('300px');
    expect(mats[0]?.style.width).toBe('600px');
    expect(mats[0]?.style.height).toBe('300px');
    // out of the accessibility tree and the pointer's way: text selection and highlights work through it
    expect(container.querySelector('[data-papertree-mats]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it("copies each box from the page canvas's own pixels at its backing-store resolution", () => {
    const draw = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => ({
        drawImage: draw,
      })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    const source = document.createElement('canvas');
    // a 2x backing store: 900 x 1200 CSS px drawn at 1800 x 2400 device px
    source.width = 1800;
    source.height = 2400;
    render(
      <PageMats
        source={source}
        paints={1}
        regions={[[100, 200, 500, 400]]}
        irScale={1.5}
        cssWidth={900}
        cssHeight={1200}
      />,
    );
    getContext.mockRestore();
    expect(draw).toHaveBeenCalledTimes(1);
    // box 100,200 .. 500,400 pt at 1.5 = 150,300 .. 750,600 CSS px, at 2x = 300,600 and 1200 x 600
    expect(draw.mock.calls[0]).toEqual([source, 300, 600, 1200, 600, 0, 0, 1200, 600]);
  });
});

describe('PdfPage on each page colour', () => {
  const regions: readonly BBox[] = [[100, 200, 500, 400]];
  beforeEach(() => document.documentElement.removeAttribute(PAGE_ATTRIBUTE));
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute(PAGE_ATTRIBUTE);
  });

  it.each(['dark', 'sepia'] as const)('draws the figure mat on a %s page', (page) => {
    document.documentElement.setAttribute(PAGE_ATTRIBUTE, page);
    const { container } = render(<PdfPage pageIndex={0} zoom={1} figureRegions={regions} />);
    expect(container.querySelectorAll('[data-papertree-mat]')).toHaveLength(1);
    // the mat sits between the recoloured canvas and the text layer
    const order = Array.from(container.querySelector('.papertree-page')?.children ?? []).map(
      (child) => child.className,
    );
    expect(order.findIndex((c) => c.includes('papertree-page__ink'))).toBeLessThan(
      order.findIndex((c) => c.includes('papertree-mats')),
    );
    expect(order.findIndex((c) => c.includes('papertree-mats'))).toBeLessThan(
      order.findIndex((c) => c.includes('papertree-text-layer')),
    );
  });

  it('draws none on a light page, which is the paper as it is', () => {
    document.documentElement.setAttribute(PAGE_ATTRIBUTE, 'light');
    const { container } = render(<PdfPage pageIndex={0} zoom={1} figureRegions={regions} />);
    expect(container.querySelector('[data-papertree-mat]')).toBeNull();
  });

  it('draws none for a page with no figures', () => {
    document.documentElement.setAttribute(PAGE_ATTRIBUTE, 'dark');
    const { container } = render(<PdfPage pageIndex={0} zoom={1} figureRegions={[]} />);
    expect(container.querySelector('[data-papertree-mat]')).toBeNull();
  });
});

describe('pdfPage.css', () => {
  const CSS = readFileSync(
    join(process.cwd(), 'src/components/reader/pdfPage.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('recolours the canvas live for Dark with a filter, not a re-render, and multiplies for Sepia', () => {
    expect(CSS).toMatch(
      /\[data-pt-page='dark'\][^{]*papertree-page__canvas\s*\{[^}]*filter:\s*invert\(1\)\s*hue-rotate\(180deg\)/,
    );
    expect(CSS).toMatch(
      /\[data-pt-page='sepia'\][^{]*papertree-page__canvas\s*\{[^}]*mix-blend-mode:\s*multiply/,
    );
  });

  it('takes every colour from a token, and eases none (a fade races a scheme change)', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(CSS).not.toMatch(/transition|animation/);
  });
});
