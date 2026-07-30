/**
 * Copy the pdf.js worker into `public/` so it is served from OUR origin.
 *
 * THE BUG THIS EXISTS TO KILL. The v1 reader fetched the worker from a third party, over a
 * PROTOCOL-RELATIVE URL, in three separate places:
 *
 *     PDFViewer.tsx:13    pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/...`
 *     PDFMinimap.tsx:17   (the same line again)
 *     FigureViewer.tsx:11 (and again)
 *
 * Three problems, in order of severity. A third party executes code in the reader's origin. A
 * protocol-relative URL downgrades to `http:` on an `http:` page. And `GlobalWorkerOptions` is a
 * SINGLETON, so whichever of the three modules evaluated last silently won — which means fixing
 * one of them fixes nothing.
 *
 * The worker is now set in exactly one module (`src/lib/pdf/worker.ts`) and served from `/`.
 *
 * WHY A COPY RATHER THAN A BUNDLER IMPORT. `new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs',
 * import.meta.url))` is the tidier form, but Next 14's webpack emits it to a hashed chunk whose URL
 * pdf.js cannot be told about without reaching into the build. A file copied to `public/` has a
 * stable path, is verifiable by eye in the network panel, and cannot silently become a CDN again.
 *
 * Runs from `prebuild`, `predev` and `pretest`, so no code path can reach a missing worker.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

// Resolve through the package rather than hard-coding node_modules: pnpm's store layout is not a
// flat node_modules, and a hard-coded path works on one developer's machine and not in CI.
const pkgJson = require.resolve('pdfjs-dist/package.json');
const pkgDir = dirname(pkgJson);

// v5 ships `.mjs`. v3 shipped `.js` and no `.mjs` at all — getting the extension wrong is a 404 and
// therefore no PDF at all, so both are tried and the choice is reported rather than assumed.
const candidates = [
  'build/pdf.worker.min.mjs',
  'build/pdf.worker.mjs',
  'build/pdf.worker.min.js',
  'build/pdf.worker.js',
];

const found = candidates.map((rel) => join(pkgDir, rel)).find((abs) => existsSync(abs));

if (found === undefined) {
  console.error(
    `[copy-pdf-worker] no worker found in ${pkgDir}. Tried:\n  ${candidates.join('\n  ')}\n` +
      `A missing worker is a blank reader, so this is fatal rather than a warning.`,
  );
  process.exit(1);
}

mkdirSync(publicDir, { recursive: true });
const target = join(publicDir, 'pdf.worker.min.mjs');
copyFileSync(found, target);

const { version } = require('pdfjs-dist/package.json');
const kb = Math.round(statSync(target).size / 1024);
console.log(`[copy-pdf-worker] pdfjs-dist@${version}: ${found.slice(pkgDir.length + 1)} -> public/pdf.worker.min.mjs (${kb} kB)`);
