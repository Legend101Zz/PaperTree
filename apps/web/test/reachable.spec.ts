/**
 * reader/reachable.spec — every component this app ships is reachable from a route.
 *
 * THE DEFECT CLASS. Twice on this branch a feature was built, unit-tested, audited, and mounted by
 * nothing:
 *
 *   #58  `useSelectionCapture` + `SelectionToolbar` — imported only by their own files, so the
 *        reader could resolve highlights through a reparse and could not create one.
 *   #59  `components/library/**` — imported only by `test/library-cases.tsx` and `test/a11y.spec`,
 *        so all six designed system states existed and no user could reach any of them.
 *
 * Both had passing tests. Both are invisible to every kind of test that starts by importing the
 * component, which is every test in this repo — `render(<PaperGrid …/>)` proves `PaperGrid` works
 * and says nothing about whether anything renders it. The property that was actually broken is
 * REACHABILITY, and it is a property of the import graph rather than of any one module.
 *
 * So: walk the graph from `src/app/**` — Next.js's real entry points, the only files a URL can
 * reach — and require every component to be in the transitive closure. A component that is not is
 * either dead code or an unwired feature, and the difference is a judgement a human makes on the
 * ledger below, not one a scan can make.
 *
 * WHY A STATIC SCAN RATHER THAN A RENDER. Rendering every route needs a router, a query client, an
 * auth store and pdf.js; the scan needs none of them and cannot be defeated by a mock. It is also
 * the only form that stays honest as the app grows: a render test asserts what someone remembered
 * to render.
 *
 * @vitest-environment node
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = (() => {
  for (const candidate of [resolve(process.cwd(), 'src'), resolve(process.cwd(), 'apps/web/src')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`reachable.spec: cannot locate apps/web/src from ${process.cwd()}`);
})();

const EXTENSIONS = ['.tsx', '.ts'] as const;

/**
 * Known-unreachable files, with the issue that owns each.
 *
 * A LEDGER, enforced in both directions: a file that becomes unreachable and is not listed fails,
 * and a listed file that becomes reachable ALSO fails, so the ledger cannot outlive the debt.
 * Deleting a listed file is the desired outcome and passes.
 */
const ORPHAN_LEDGER: readonly { readonly file: string; readonly why: string }[] = [
  // The v1 canvas. `app/paper/[id]/canvas/page.tsx` is a stood-down placeholder — "no canvas" is an
  // explicit Epic 2 non-goal and `components/canvas/**` is outside its file ownership — so these
  // are unreachable BY DESIGN and stay in the tree for Epic 5 to find as they were. #43 deletes
  // them. `MermaidRenderer.tsx` additionally breaks "no fabricated diagrams" and wants deleting
  // rather than rebuilding.
  { file: 'components/canvas/CanvasToolbar.tsx', why: '#43 — Epic 5 owns the canvas' },
  { file: 'components/canvas/MermaidRenderer.tsx', why: '#43 — and delete, do not restyle' },
  { file: 'components/canvas/PaperCanvas.tsx', why: '#43 — Epic 5 owns the canvas' },
  { file: 'components/canvas/RichCanvasNode.tsx', why: '#43 — Epic 5 owns the canvas' },
  { file: 'components/canvas/nodes/AIResponseNode.tsx', why: '#43 — Epic 5 owns the canvas' },
  { file: 'components/canvas/nodes/ExplorationNode.tsx', why: '#43 — Epic 5 owns the canvas' },
  { file: 'components/canvas/nodes/InlineAskInput.tsx', why: '#43 — Epic 5 owns the canvas' },
  { file: 'components/canvas/nodes/NoteNode.tsx', why: '#43 — Epic 5 owns the canvas' },
  { file: 'components/canvas/nodes/PageSuperNode.tsx', why: '#43 — Epic 5 owns the canvas' },
];

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full));
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out.sort();
}

function rel(absolute: string): string {
  return relative(SRC, absolute).split(sep).join('/');
}

/** `@/x` and `./x` only. A bare specifier is a package and leaves this graph. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every specifier the file imports.
 *
 * Static `import`, `export … from`, and dynamic `import()` — the last because a route that lazily
 * loads a heavy component still reaches it, and treating that as unreachable would push people
 * towards eager imports to satisfy a test.
 */
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

function reachableFrom(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      const target = resolveSpecifier(file, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe('reader/reachable.spec — nothing ships that no route can reach', () => {
  const appEntries = sourceFilesUnder(join(SRC, 'app'));
  // `middleware.ts` sits beside `app/` and is an entry point in its own right.
  const middleware = join(SRC, 'middleware.ts');
  const entries = existsSync(middleware) ? [...appEntries, middleware] : appEntries;
  const reachable = reachableFrom(entries);

  const components = sourceFilesUnder(join(SRC, 'components'));

  it('has entry points at all — the scan must not pass by finding nothing', () => {
    expect(entries.length).toBeGreaterThan(3);
    expect(components.length).toBeGreaterThan(10);
    expect(reachable.size).toBeGreaterThan(entries.length);
  });

  it('every component is reachable from a route, or is on the ledger with a reason', () => {
    const ledgerFiles = new Set(ORPHAN_LEDGER.map((entry) => entry.file));
    const unreachable = components.filter((file) => !reachable.has(file)).map(rel);
    const undocumented = unreachable.filter((file) => !ledgerFiles.has(file));

    expect(
      undocumented,
      'These components are built and no URL reaches them. That is what #58 and #59 were. ' +
        'Wire them to a route, delete them, or add them to ORPHAN_LEDGER with the issue that owns them.',
    ).toEqual([]);

    // The ledger cannot outlive the debt: a listed file that is now reachable must be delisted.
    const staleLedger = ORPHAN_LEDGER.filter(
      (entry) => reachable.has(join(SRC, entry.file)) && existsSync(join(SRC, entry.file)),
    ).map((entry) => entry.file);
    expect(staleLedger, 'Now reachable — delete these lines from ORPHAN_LEDGER.').toEqual([]);
  });

  it('the two features that were unwired are wired', () => {
    // Named explicitly, so a future refactor that re-orphans one fails with its issue number rather
    // than with a generic list. These are regression pins, not a substitute for the scan above.
    for (const [file, issue] of [
      ['components/reader/useSelectionCapture.ts', '#58'],
      ['components/reader/SelectionToolbar.tsx', '#58'],
      ['components/reader/stampTextLayer.ts', '#58'],
      ['components/library/PaperGrid.tsx', '#59'],
      ['components/library/PaperList.tsx', '#59'],
      ['components/library/UploadDropzone.tsx', '#59'],
      ['components/library/SystemStates.tsx', '#59'],
    ] as const) {
      expect(reachable.has(join(SRC, file)), `${file} is unreachable again — see ${issue}`).toBe(true);
    }
  });

  it('the v1 dashboard is gone, not merely unreferenced', () => {
    // #59 replaced it. Leaving the files behind would let someone re-point a route at them.
    expect(existsSync(join(SRC, 'components/dashboard'))).toBe(false);
  });
});
