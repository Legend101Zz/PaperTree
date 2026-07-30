/**
 * document-ir/codegen-drift.spec — the named acceptance test of F0.3.
 *
 * findings.md §G5 records the failure this exists to prevent: TWO contradictory `Highlight` types
 * and two canvas type systems, both hand-written, both drifted. Generating from one schema is the
 * structural fix; THIS TEST is what keeps it true. Without it, "generated" degrades into "was
 * generated once, then edited".
 *
 * The test regenerates from the schema into a temp directory and byte-compares against the
 * committed files. It fails with the exact file that drifted and the command that fixes it.
 *
 * It also asserts DETERMINISM directly: two independent generations must be byte-identical. A
 * non-deterministic generator makes this test flap, and the first person to hit a flapping test
 * deletes it.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate, writeGenerated } from '../codegen/generate.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = 'pnpm --filter @papertree/document-ir codegen';

/** The directories `generate()` owns, so a stale committed file is caught as well as a changed one. */
const GENERATED_DIRS = ['src/generated', 'python/papertree_document_ir/generated'] as const;

/** Build artefacts that are not checked in and are not the generator's business. */
const IGNORED = new Set(['__pycache__', '.mypy_cache', '.ruff_cache']);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir).toSorted()) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function committedFiles(): string[] {
  const out: string[] = [];
  for (const dir of GENERATED_DIRS) {
    for (const file of walk(join(PKG, dir))) {
      out.push(relative(PKG, file).split(sep).join('/'));
    }
  }
  return out.toSorted();
}

describe('codegen drift', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'papertree-codegen-'));
  const written = writeGenerated(tmp).toSorted();

  it('the generator is deterministic — two runs are byte-identical', () => {
    const a = generate();
    const b = generate();
    expect([...b.keys()].toSorted()).toEqual([...a.keys()].toSorted());
    for (const [path, text] of a) {
      expect(b.get(path), `${path} differs between two runs of the same generator`).toBe(text);
    }
  });

  it('every generated file is LF-terminated with no trailing blank lines and carries the banner', () => {
    for (const [path, text] of generate()) {
      expect(text.includes('\r'), `${path} contains CR`).toBe(false);
      expect(text.endsWith('\n'), `${path} does not end with a newline`).toBe(true);
      expect(text.endsWith('\n\n'), `${path} ends with a blank line`).toBe(false);
      expect(text, `${path} is missing a DO NOT EDIT banner`).toMatch(/DO NOT EDIT/);
      // The Python package marker carries no bindings, so it names no schema file.
      if (!path.endsWith('__init__.py')) {
        expect(text, `${path} does not name the schema it was generated from`).toMatch(
          /DO NOT EDIT — generated from schema\/(paperir|derivation)-1\.0\.0\.schema\.json by codegen\/generate\.ts/,
        );
      }
      expect(text, `${path} leaks an absolute path`).not.toMatch(/\/(Users|home|Volumes)\//);
    }
  });

  /**
   * Construct 3, asserted STRUCTURALLY rather than only case-by-case in equivalence.spec: a
   * `.strict()` or `extra="forbid"` that goes missing from one object is a hole the corpus only
   * catches if it happens to carry a case for that object.
   */
  it('every generated object closes its field set', () => {
    const files = generate();
    for (const name of ['src/generated/zod.ts', 'src/generated/derivation.zod.ts']) {
      const text = files.get(name) as string;
      const objects = text.match(/\.object\(\{/g)?.length ?? 0;
      const strict = text.match(/\n\s*\.strict\(\)/g)?.length ?? 0;
      expect(objects, `${name} emits no objects`).toBeGreaterThan(0);
      expect(strict, `${name}: ${objects} z.object() but only ${strict} .strict()`).toBe(objects);
    }
    for (const name of [
      'python/papertree_document_ir/generated/models.py',
      'python/papertree_document_ir/generated/derivation_models.py',
    ]) {
      const text = files.get(name) as string;
      const classes = text.match(/^class \w+\(/gm) ?? [];
      // Every model class derives from _Model, which is the only place extra="forbid" is set;
      // StrEnum vocabularies and the base itself are the only other class statements.
      const models = classes.filter(
        (c) => !/(StrEnum|BaseModel)/.test(text.slice(text.indexOf(c), text.indexOf(c) + 120)),
      );
      expect(models.length, `${name} emits no models`).toBeGreaterThan(0);
      expect(text.match(/^class \w+\(_Model\):$/gm)?.length ?? 0).toBe(models.length);
      expect(text).toContain('model_config = ConfigDict(extra="forbid", strict=True)');
    }
  });

  /**
   * The structural check above counts `.object({` against `.strict()` and therefore CANNOT see the
   * hole the differential attack found, which lived in the two `.record(` sites: `z.record`
   * REBUILDS the object, so `JSON.parse`'s own `__proto__` key was deleted before `propertyNames`,
   * `findModelDeclaration` or a nested `.strict()` ever ran (DESIGN.md §12.1). The fix is a
   * pass-through `z.custom`, and this is the assertion that keeps a future "simplification" from
   * quietly undoing it — the verdict cases in equivalence.spec would not necessarily notice.
   */
  it('no open object is rebuilt — z.record must not reappear in a generated validator', () => {
    const files = generate();
    for (const name of ['src/generated/zod.ts', 'src/generated/derivation.zod.ts']) {
      // Comment lines are excluded: the generated header EXPLAINS why z.record is not used, and a
      // check that forbids naming the bug would forbid documenting it.
      const code = (files.get(name) as string)
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
        .join('\n');
      expect(code.match(/z\s*\n?\s*\.record\(/g) ?? [], `${name} uses z.record`).toEqual([]);
    }
    const paperir = files.get('src/generated/zod.ts') as string;
    expect(paperir).toContain('function openObject()');
    expect(paperir).toContain('z.custom<Record<string, unknown>>(isPlainObject');
  });

  /** Both bindings must carry the SAME bound; two numbers is two contracts. */
  it('the payload depth bound is one number, emitted into both languages', () => {
    const files = generate();
    const ts = /export const MAX_PAYLOAD_DEPTH = (\d+);/.exec(
      files.get('src/generated/zod.ts') as string,
    );
    const py = /^MAX_PAYLOAD_DEPTH = (\d+)$/m.exec(
      files.get('python/papertree_document_ir/generated/models.py') as string,
    );
    expect(ts?.[1], 'MAX_PAYLOAD_DEPTH missing from the Zod binding').toBeDefined();
    expect(py?.[1], 'MAX_PAYLOAD_DEPTH missing from the Pydantic binding').toBe(ts?.[1]);
  });

  /**
   * `\s` means three different things in the three engines the schema is handed to. The Zod
   * binding must keep the schema's own pattern (JS is the reference); the Pydantic binding must
   * never receive a bare `\s` (DESIGN.md §12.2).
   */
  it('no bare \\s reaches a non-JavaScript regex engine', () => {
    const files = generate();
    for (const name of [
      'python/papertree_document_ir/generated/models.py',
      'python/papertree_document_ir/generated/derivation_models.py',
    ]) {
      const text = files.get(name) as string;
      for (const line of text.split('\n')) {
        if (!/pattern=|re\.compile\(/.test(line)) continue;
        expect(
          /\\s/.test(line),
          `${name}: a raw \\s survives into a Python regex:\n  ${line}`,
        ).toBe(false);
      }
    }
    // ...and the expansion really is the ECMA set, not an approximation.
    expect(files.get('python/papertree_document_ir/generated/models.py')).toContain('\\ufeff');
  });

  /** Every schema string is guarded in BOTH bindings, or the two disagree with each other. */
  it('the unpaired-surrogate guard is present in both bindings', () => {
    const files = generate();
    expect(files.get('src/generated/zod.ts')).toContain('isWellFormedText');
    expect(files.get('python/papertree_document_ir/generated/models.py')).toContain(
      'JsonText = Annotated[str, AfterValidator(_well_formed)]',
    );
    const zod = files.get('src/generated/zod.ts') as string;
    // Every z.string() carries the refine; a bare one is a string nobody checks.
    const strings = zod.match(/z\.string\(\)(?!\.)/g) ?? [];
    expect(strings, 'a z.string() with no refinements at all').toEqual([]);
  });

  it('the committed generated files are exactly the files the generator emits', () => {
    expect(
      committedFiles(),
      `the set of committed generated files differs from what codegen emits. Run \`${FIX}\`.`,
    ).toEqual(written);
  });

  it.each(written)('%s has not drifted from the schema', (rel) => {
    const fresh = readFileSync(join(tmp, rel), 'utf8');
    const committed = readFileSync(join(PKG, rel), 'utf8');
    if (fresh !== committed) {
      const freshLines = fresh.split('\n');
      const committedLines = committed.split('\n');
      const idx = freshLines.findIndex((line, i) => line !== committedLines[i]);
      // `findIndex` returns -1 when the fresh output is a strict PREFIX of the committed file —
      // i.e. someone appended to a generated file, which is the most likely hand edit of all. The
      // diagnostic then printed "line 0 / undefined / undefined" and told the reader nothing.
      const at = idx === -1 ? Math.min(freshLines.length, committedLines.length) : idx;
      throw new Error(
        [
          ``,
          `DRIFT: ${rel} does not match what the schema generates.`,
          ``,
          `  first difference at line ${at + 1}`,
          `    committed: ${JSON.stringify(committedLines[at])}`,
          `    generated: ${JSON.stringify(freshLines[at])}`,
          ``,
          `  The JSON Schema is the single source of truth. Do not edit generated files:`,
          `  run \`${FIX}\` and commit the result. If the schema changed, that is the`,
          `  expected fix. If it did not, someone hand-edited a generated file.`,
          ``,
        ].join('\n'),
      );
    }
    expect(fresh).toBe(committed);
  });

  it('cleans up', () => {
    rmSync(tmp, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
