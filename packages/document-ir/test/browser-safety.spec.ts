/**
 * document-ir/browser-safety.spec — nothing reachable from the barrel imports a `node:` builtin.
 *
 * WHAT THIS REPLACES, and why a build check was not enough.
 *
 * Issue #33: `src/index.ts` re-exported `./identity.js`, which imports `node:crypto` at module
 * scope. webpack 5 does not resolve a `node:`-prefixed specifier at all — it treats it as a URI
 * with a `node:` SCHEME, so it never reaches the alias table — and `apps/web` therefore could not
 * compile any import of this package, including one that only wanted `polygonExtent`. The
 * workaround was a `NormalModuleReplacementPlugin` in `next.config.js` pointing at a stub that
 * THROWS, plus `src/lib/pdf/node-crypto-stub.ts`. Both are deleted with this spec's arrival.
 *
 * `pnpm --filter papertree-web build` is the end-to-end proof and it is in #33's PR body. It is
 * not a sufficient guard: it lives in another package, it takes ~40 s, and the day someone stops
 * running it the property regresses silently — which is exactly how the reader ended up with a
 * deliberately ugly stub in the first place. This spec is 2 ms, lives beside the code it binds,
 * and fails on the specific edit that would undo it.
 *
 * THE MUTATION THAT MUST TURN THIS RED: restore `export * from './identity.js'` in `src/index.ts`.
 * Watched failing before this file was committed.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. It walks relative specifiers only. A `node:` import that
 * arrives through a bare package specifier — a dependency of a dependency — is invisible to it,
 * and the honest guard for that is the bundler. `zod` is this package's only runtime dependency
 * and is browser-safe by its own charter; the day a second one is added, that is the thing to
 * check by building, not here.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `./x.js` and `../x.js` only. A bare specifier is a package and leaves this graph. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  // NodeNext source carries the EMITTED `.js` extension; the file on disk is `.ts`.
  for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * Comments are stripped before matching, and that is not fastidiousness — it was watched failing.
 * `normalise.ts`'s own header explains the split by quoting `export * from './identity.js'`, and a
 * scanner that reads prose reported `identity.ts` as reachable from a barrel that does not import
 * it. A guard that fires on a sentence is a guard people learn to route around.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^[^\n]*?\/\/[^\n]*$/gm, '');
}

/** Every file reachable from `entry`, plus every bare specifier any of them imports. */
function walk(entry: string): { files: string[]; bare: Map<string, string[]> } {
  const seen = new Set<string>();
  const bare = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = codeOf(file);
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const target = resolveRelative(file, specifier);
      if (target !== null) {
        if (!seen.has(target)) queue.push(target);
      } else {
        bare.set(specifier, [...(bare.get(specifier) ?? []), relative(PKG, file)]);
      }
    }
  }
  return { files: [...seen].toSorted(), bare };
}

describe('document-ir/browser-safety.spec — the barrel is importable from a browser bundle', () => {
  const barrel = join(PKG, 'src/index.ts');
  const { files, bare } = walk(barrel);

  it('has a graph at all — the scan must not pass by finding nothing', () => {
    // #26's fixture script passed while validating nothing, and `uv run pytest` has reported green
    // over zero collected tests. A walk that resolves no files looks identical to a clean one.
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((file) => file.endsWith('normalise.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('geometry.ts'))).toBe(true);
  });

  it('reaches no `node:` builtin from `src/index.ts`', () => {
    const offenders = [...bare.entries()]
      .filter(([specifier]) => specifier.startsWith('node:'))
      .map(([specifier, importers]) => `${specifier} <- ${importers.join(', ')}`);

    expect(
      offenders,
      'A `node:` builtin is reachable from the barrel. webpack 5 will not resolve one — it is a ' +
        'URI scheme, not a module specifier, so `resolve.alias` never fires and the build dies ' +
        'with UnhandledSchemeError. That is issue #33, and `apps/web` carried a throwing stub for ' +
        'it. Move the offending code behind a subpath export, as `./identity` is.',
    ).toEqual([]);
  });

  it('does not reach `identity.ts`, which is the Node-only half', () => {
    // Named specifically rather than left to the scan above, so a regression fails with the file
    // and the issue rather than with a generic list. `identity.ts` is reachable, on purpose, only
    // as `@papertree/document-ir/identity`.
    expect(
      files.map((file) => relative(PKG, file)).filter((file) => file.endsWith('src/identity.ts')),
      '`src/identity.ts` is reachable from the barrel again — see #33. It imports `node:crypto` ' +
        'at module scope. The barrel must re-export `./normalise.js` instead.',
    ).toEqual([]);
  });

  it('`identity.ts` still IS the Node-only half — the split is not vacuous', () => {
    // The inverse guard. If someone "fixed" this by deleting the `node:crypto` import rather than
    // by splitting, every assertion above would pass and `blockId` would be silently broken.
    const identity = readFileSync(join(PKG, 'src/identity.ts'), 'utf8');
    expect(identity).toContain("import { createHash } from 'node:crypto';");
    expect(identity).toContain('export function blockId(');
    expect(identity).toContain('export function contentHash(');
  });

  it('the package declares the shape that lets a bundler act on this', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      sideEffects?: unknown;
      exports?: Record<string, string>;
    };
    // Without this a bundler must assume every module is load-bearing and may not drop any of them.
    expect(manifest.sideEffects).toBe(false);
    // The subpaths #33 asked for. `./identity` is listed on purpose: it is how a Node consumer
    // reaches the hashing half deliberately, rather than by accident through the barrel.
    for (const subpath of [
      '.',
      './geometry',
      './types',
      './normalise',
      './identity',
      './validate',
      './schema',
    ]) {
      expect(manifest.exports?.[subpath], `exports["${subpath}"] is missing`).toBeTypeOf('string');
    }
  });
});
