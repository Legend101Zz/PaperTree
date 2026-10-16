/**
 * truths.spec — the product never says a claim is "verified", "fact-checked" or "accurate" (#190).
 *
 * The honest labels are "cited" and "not verified" (AGENTS.md §2). This parses every .ts/.tsx under
 * apps/web/src and packages/ui/src with the TypeScript compiler and checks only what a user can
 * read: string literals, template text and JSX text. Identifiers and comments are ignored, so code
 * may say `supported`. It lives in apps/web because that is where `typescript` and the whole
 * shipped surface (web plus the shared UI package) are both reachable by relative path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [resolve(HERE, '../src'), resolve(HERE, '../../../packages/ui/src')];

const BANNED = /\b(verified|fact[- ]checked|accurate)\b/gi;

/** Banned words in `text`, ignoring every "not verified" (and the `not-verified` status/class name). */
function bannedIn(text: string): string[] {
  const cleaned = text.replace(/\bnot[\s-]+verified\b/gi, ' ');
  return [...cleaned.matchAll(BANNED)].map((m) => m[0]);
}

/**
 * Banned words found in user-readable text of one source file.
 *
 * @param fileName Used for the TS script kind (.tsx enables JSX).
 * @param source The file's text.
 * @returns `line: "text" (word)` strings.
 */
function scan(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: string[] = [];
  const check = (node: ts.Node, text: string): void => {
    for (const word of bannedIn(text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      hits.push(`${fileName}:${String(line + 1)} "${text.trim().slice(0, 60)}" (${word})`);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      check(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('banned labels', () => {
  it('the scanner catches "Verified" in JSX text and in strings (so the test cannot pass vacuously)', () => {
    expect(scan('probe.tsx', 'export const A = () => <b>Verified ✓</b>;')).toHaveLength(1);
    expect(scan('probe.ts', "export const x = 'fact-checked';")).toHaveLength(1);
    expect(scan('probe.ts', 'export const y = `${a} is accurate`;')).toHaveLength(1);
  });

  it('allows "not verified" and ignores comments and identifiers', () => {
    expect(scan('ok.ts', "export const x = 'not verified'; // verified accurate")).toEqual([]);
    expect(scan('ok.ts', 'const verified = true; const accurate = 1;')).toEqual([]);
  });

  it('finds none in apps/web/src or packages/ui/src', () => {
    const files = ROOTS.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(20);
    const hits = files.flatMap((file) => scan(file, readFileSync(file, 'utf8')));
    expect(hits).toEqual([]);
  });
});
