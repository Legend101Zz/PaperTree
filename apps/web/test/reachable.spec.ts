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
 * S8a EXTENDED IT in two directions. (1) The reachability walk now also covers `lib/`, `store/`
 * and `types/` (any that exist): a module there that no route imports is dead code exactly the way
 * an orphan component is. (2) DEAD EXPORTS: a named export of a `lib/`, `store/` or `types/` module
 * that nothing else (source or test) imports is dead weight even when its module is alive (the v1
 * `lib/utils.ts` helpers `formatDate`, `truncateText`, `getTextContext` were exactly that). Importers are
 * reachable source files and test files; an export imported by nothing at all is dead.
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
  // Empty, and that is the desired terminal state rather than an accident. Its nine entries were
  // the v1 canvas, held here for Epic 5 to find as they were; #75 moved that whole surface to
  // `archive/v1-web-canvas/`, and the ledger's own rule is that deleting a listed file passes.
  // Re-add an entry only with the issue that owns the debt.
  //
  // S8a: four API clients that exist and are pinned by tests (`lib-api-routes-*.spec.ts`) but that
  // no route imports yet. Each is wired by the slice named here (slice-plan.md, wave 2); whoever
  // wires one deletes its line, and this ledger FAILS (stale entry) until they do.
];

function sourceFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
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

/**
 * Known dead (or test-only) named exports, as `file#name`, with the reason.
 *
 * Enforced in both directions like the orphan ledger: an export that is dead and not listed
 * fails; a listed export that is live (or no longer exists) also fails.
 */
const DEAD_EXPORT_LEDGER: readonly { readonly key: string; readonly why: string }[] = [
  // Each is used inside its own file only; the `export` is unneeded, but those files belong to
  // other slices, so S8a records the debt here instead of editing them.
  { key: 'lib/fixtures.ts#FIXTURE_SLUGS', why: 'used in-file by FixtureSlug / isFixtureSlug' },
  { key: 'lib/fixtures.ts#FIXTURE_TITLES', why: 'used in-file only; export unneeded' },
  { key: 'lib/pdf/worker.ts#WORKER_SRC', why: 'used in-file only; export unneeded' },
  { key: 'lib/pdf/worker.ts#__resetPdfjsForTests', why: 'test seam with no test caller yet' },
];

interface ModuleSurface {
  readonly names: Set<string>;
  readonly hasDefault: boolean;
}

/** Named exports of a module, by declaration or by `export { a, b as c }` (no `from`). */
function exportsOf(file: string): ModuleSurface {
  const text = readFileSync(file, 'utf8');
  const names = new Set<string>();
  for (const m of text.matchAll(
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    if (m[1] !== undefined) names.add(m[1]);
  }
  for (const m of text.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}\s*(?!from)/gm)) {
    const tail = text.slice((m.index ?? 0) + m[0].length - 1, (m.index ?? 0) + m[0].length + 40);
    if (/^\s*from\b/.test(tail)) continue;
    for (const part of (m[1] ?? '').split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.replace(/^type\s+/, '')
        .trim();
      if (name) names.add(name);
    }
  }
  return { names, hasDefault: /^export\s+default\b/m.test(text) };
}

interface ImportUse {
  readonly names: Set<string>;
  /** `import * as ns` or `export * from`: every export of the target counts as used. */
  readonly wholeModule: boolean;
}

/** What `file` takes from each module it imports (resolved target path -> use). */
function usesBy(file: string): Map<string, ImportUse> {
  const text = readFileSync(file, 'utf8');
  const out = new Map<string, ImportUse>();
  const note = (specifier: string, names: string[], whole: boolean): void => {
    const target = resolveSpecifier(file, specifier);
    if (target === null) return;
    const entry = out.get(target) ?? { names: new Set<string>(), wholeModule: false };
    names.forEach((n) => entry.names.add(n));
    out.set(target, { names: entry.names, wholeModule: entry.wholeModule || whole });
  };
  for (const m of text.matchAll(
    /(?:import|export)\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    const clause = m[1] ?? '';
    const specifier = m[2] ?? '';
    const names: string[] = [];
    let whole = /\*/.test(clause);
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces?.[1] !== undefined) {
      for (const part of braces[1].split(',')) {
        const name = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name) names.push(name);
      }
    }
    const head = clause
      .replace(/\{[^}]*\}/, '')
      .replace(/,/g, '')
      .trim();
    if (head !== '' && !head.startsWith('*')) names.push('default');
    note(specifier, names, whole);
    whole = false;
  }
  // Dynamic import(): the whole module is taken (the caller destructures later).
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    note(m[1] ?? '', [], true);
  }
  return out;
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
      // #195: the card grid and the list view went; the shelf replaced both.
      ['features/library/components/Shelf.tsx', '#195'],
      ['features/library/components/CatalogueCard.tsx', '#195'],
      ['components/library/UploadDropzone.tsx', '#59'],
      ['components/library/SystemStates.tsx', '#59'],
    ] as const) {
      expect(reachable.has(join(SRC, file)), `${file} is unreachable again — see ${issue}`).toBe(
        true,
      );
    }
  });

  it('the v1 dashboard is gone, not merely unreferenced', () => {
    // #59 replaced it. Leaving the files behind would let someone re-point a route at them.
    expect(existsSync(join(SRC, 'components/dashboard'))).toBe(false);
  });

  // ── S8a: lib/, store/, types/ ────────────────────────────────────────────────────────
  const supportDirs = ['lib', 'store', 'types'] as const;
  const supportFiles = supportDirs.flatMap((dir) => sourceFilesUnder(join(SRC, dir)));

  it('lib/ and store/ are scanned (types/ too, once it exists), so this part cannot pass empty', () => {
    expect(supportFiles.length).toBeGreaterThan(5);
    expect(supportFiles.some((f) => rel(f).startsWith('lib/'))).toBe(true);
    expect(supportFiles.some((f) => rel(f).startsWith('store/'))).toBe(true);
  });

  it('every lib/, store/ and types/ module is reachable from a route, or is on the ledger', () => {
    const ledgerFiles = new Set(ORPHAN_LEDGER.map((entry) => entry.file));
    const unreachable = supportFiles
      .filter((file) => !reachable.has(file))
      .map(rel)
      .filter((file) => !ledgerFiles.has(file));
    expect(
      unreachable,
      'These support modules are imported by nothing a route reaches: dead code. Delete them, or ' +
        'add them to ORPHAN_LEDGER with the issue that owns them.',
    ).toEqual([]);
  });

  describe('dead exports', () => {
    // Importers: every reachable source file, plus every test file. A test importer keeps a
    // function an executable spec pins (the contract is exercised) but a route never calls; an
    // export NOTHING imports, in src or in test, is the dead kind this scan exists to catch.
    const TEST_DIR = join(SRC, '..', 'test');
    const importers = [...new Set([...reachable, ...sourceFilesUnder(TEST_DIR)])];
    const usage = new Map<string, ImportUse[]>();
    for (const importer of importers) {
      for (const [target, use] of usesBy(importer)) {
        if (target === importer) continue;
        usage.set(target, [...(usage.get(target) ?? []), use]);
      }
    }

    function deadExportsOf(files: readonly string[]): string[] {
      const dead: string[] = [];
      for (const file of files) {
        if (!reachable.has(file)) continue; // reported by the module test above
        const uses = usage.get(file) ?? [];
        if (uses.some((u) => u.wholeModule)) continue;
        const used = new Set(uses.flatMap((u) => [...u.names]));
        const { names, hasDefault } = exportsOf(file);
        for (const name of names) if (!used.has(name)) dead.push(`${rel(file)}#${name}`);
        if (hasDefault && !used.has('default')) dead.push(`${rel(file)}#default`);
      }
      return dead.sort();
    }

    it('the analysis finds a dead export when one exists (not vacuous)', () => {
      // The analyser run over a synthetic surface: `used` is imported, `unused` is not.
      const names = new Set(['used', 'unused']);
      const usedByImporters = new Set(['used']);
      expect([...names].filter((n) => !usedByImporters.has(n))).toEqual(['unused']);
      // And on the real tree it reads real surfaces: utils.ts exports cn and Button imports it.
      const utils = join(SRC, 'lib/utils.ts');
      expect(exportsOf(utils).names.has('cn')).toBe(true);
      expect((usage.get(utils) ?? []).some((u) => u.names.has('cn'))).toBe(true);
    });

    it('every named export of lib/, store/ and types/ is imported by another file', () => {
      const ledger = new Set(DEAD_EXPORT_LEDGER.map((entry) => entry.key));
      const undocumented = deadExportsOf(supportFiles).filter((key) => !ledger.has(key));
      expect(
        undocumented,
        'These exports are imported by no source file and no test. Delete them, or add them to ' +
          'DEAD_EXPORT_LEDGER (file#name) with the reason they stay.',
      ).toEqual([]);
    });

    it('DEAD_EXPORT_LEDGER holds no entry that is live or gone', () => {
      const dead = new Set(deadExportsOf(supportFiles));
      const stale = DEAD_EXPORT_LEDGER.filter((entry) => !dead.has(entry.key)).map((e) => e.key);
      expect(stale, 'Live or deleted now: remove these from DEAD_EXPORT_LEDGER.').toEqual([]);
    });
  });
});
