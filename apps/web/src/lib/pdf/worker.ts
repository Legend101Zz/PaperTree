/**
 * The ONE place `GlobalWorkerOptions.workerSrc` is ever assigned.
 *
 * `GlobalWorkerOptions` is a singleton on the pdf.js module. The v1 reader assigned it in three
 * separate components — `PDFViewer.tsx:13`, `PDFMinimap.tsx:17`, `FigureViewer.tsx:11` — each
 * pointing at a PROTOCOL-RELATIVE third-party CDN. Whichever module happened to evaluate last won,
 * which is why fixing one of them would have fixed nothing.
 *
 * Every module that touches pdf.js imports `getPdfjs()` from here, so there is exactly one
 * assignment and it is local. `public/pdf.worker.min.mjs` is copied from the installed
 * `pdfjs-dist` by `scripts/copy-pdf-worker.mjs`, which runs on `prebuild`, `predev` and `pretest`.
 */

import type * as PdfjsModule from 'pdfjs-dist';

export const WORKER_SRC = '/pdf.worker.min.mjs';

let cached: Promise<typeof PdfjsModule> | null = null;

/**
 * Load pdf.js and configure its worker exactly once.
 *
 * Dynamically imported rather than imported at module scope because pdf.js v5 touches `DOMMatrix`,
 * `Path2D` and `ImageData` while it initialises. Next renders this route's ancestors on the server,
 * where those do not exist, so a static import crashes the SSR pass before any component runs.
 */
export async function getPdfjs(): Promise<typeof PdfjsModule> {
  if (cached !== null) return cached;
  cached = import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    return pdfjs;
  });
  return cached;
}

/** Reset between tests. Never call this from application code. */
export function __resetPdfjsForTests(): void {
  cached = null;
}
