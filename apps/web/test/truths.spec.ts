/**
 * truths.spec — the product never says a claim is "verified", "fact-checked" or "accurate" (#190).
 *
 * The honest labels are "cited" and "not verified" (AGENTS.md §2). This parses every .ts/.tsx under
 * apps/web/src and packages/ui/src with the TypeScript compiler and checks only what a user can
 * read: string literals, template text, JSX text and attribute strings, after decoding HTML
 * entities and joining `'a' + 'b'` literal concatenations. Identifiers, comments, import/export
 * paths, quoted property names and string-literal TYPES are not user text and are skipped, so code
 * may say `supported` or `unverified` as a name. It lives in apps/web because that is where
 * `typescript` and both source trees are reachable.
 *
 * The banned family: verified, unverified, verifies/verify/verifying, verification, accurate,
 * accurately, accuracy, fact-check(ed|ing) in any spacing or hyphenation. "not verified" and
 * "not-verified" (the status/class name) are exempt.
 *
 * ALLOW-LIST: `truths.allowlist.json` (path relative to the repo root, the exact string, a one-line
 * reason). It starts empty and the test prints it, so every exemption is visible in the run.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const ROOTS = [resolve(HERE, '../src'), resolve(REPO, 'packages/ui/src')];

/** One documented exemption. */
interface Allowed {
  readonly path: string;
  readonly text: string;
  readonly reason: string;
}

const ALLOWLIST = JSON.parse(
  readFileSync(resolve(HERE, 'truths.allowlist.json'), 'utf8'),
) as readonly Allowed[];

const BANNED =
  /\b(?:un)?verif(?:ied|ies|y|ying|ication)\b|\baccura(?:te|tely|cy)\b|\bfact[\s-]*check(?:ed|ing|s)?\b/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
};

/** Decode numeric and the few named HTML entities, so `Verif&#105;ed` is read as "Verified". */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Banned words in `text`, ignoring every "not verified" / "not-verified". */
function bannedIn(text: string): string[] {
  const cleaned = decodeEntities(text).replace(/\bnot[\s-]+verified\b/gi, ' ');
  return [...cleaned.matchAll(BANNED)].map((m) => m[0]);
}

/** True when the string is a module path, a property name or a type, i.e. not text a user reads. */
function isNotUserText(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent)) return true;
  if (ts.isImportTypeNode(parent.parent) || ts.isModuleDeclaration(parent)) return true;
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  return false;
}

/** The text of a node made only of string literals joined with `+`, or undefined. */
function constantText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constantText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantText(node.left);
    const right = constantText(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

/**
 * Banned words found in user-readable text of one source file.
 *
 * @param fileName Repo-relative path; `.tsx` enables JSX.
 * @param source The file's text.
 * @param allow Exemptions that apply to this run.
 * @returns `path:line "text" (word)` strings, one per hit not covered by `allow`.
 */
function scan(fileName: string, source: string, allow: readonly Allowed[] = ALLOWLIST): string[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: string[] = [];
  const seen = new Set<string>();
  const check = (node: ts.Node, text: string): void => {
    for (const word of bannedIn(text)) {
      if (allow.some((a) => a.path === fileName && a.text === text)) continue;
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const hit = `${fileName}:${String(line + 1)} "${text.trim().slice(0, 60)}" (${word})`;
      if (!seen.has(hit)) hits.push(hit);
      seen.add(hit);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const joined = constantText(node);
      if (joined !== undefined) check(node, joined);
    }
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      !isNotUserText(node)
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

describe('banned labels: the scanner catches each form (so the test cannot pass vacuously)', () => {
  const caught: [string, string, string][] = [
    ['JSX text', 'probe.tsx', 'export const A = () => <b>Verified ✓</b>;'],
    ['string', 'probe.ts', "export const x = 'fact-checked';"],
    ['template', 'probe.ts', 'export const y = `${a} is accurate`;'],
    ['attribute', 'probe.tsx', 'export const A = () => <i title="Verified answer" />;'],
    ['JSX expression', 'probe.tsx', "export const A = () => <b>{'Accurate'}</b>;"],
    ['unverified', 'probe.ts', "export const x = 'unverified claim';"],
    ['verifies', 'probe.ts', "export const x = 'Verifies the claim';"],
    ['verification', 'probe.ts', "export const x = 'Verification passed';"],
    ['accuracy', 'probe.ts', "export const x = 'Accuracy 98%';"],
    ['accurately', 'probe.ts', "export const x = 'Accurately cited';"],
    ['fact check, spaced', 'probe.ts', "export const x = 'Fact check passed';"],
    ['fact  check, hyphen', 'probe.ts', "export const x = 'a fact-check';"],
    ['numeric entity', 'probe.tsx', 'export const A = () => <b>Verif&#105;ed</b>;'],
    ['hex entity', 'probe.tsx', 'export const A = () => <b>Verif&#x69;ed</b>;'],
    ['concatenation', 'probe.ts', "export const x = 'Veri' + 'fied';"],
    ['three-part concatenation', 'probe.ts', "export const x = ('Ver' + 'if') + 'ied';"],
    [
      'a second use after "not verified"',
      'probe.ts',
      "export const x = 'not verified, now verified';",
    ],
  ];
  for (const [name, file, source] of caught) {
    it(`catches ${name}`, () => {
      expect(scan(file, source, []), source).not.toEqual([]);
    });
  }

  it('allows "not verified" / "not-verified" and ignores comments and identifiers', () => {
    expect(scan('ok.ts', "export const x = 'not verified'; // verified accurate", [])).toEqual([]);
    expect(scan('ok.ts', "export const c = 'pt-tab--not-verified';", [])).toEqual([]);
    expect(scan('ok.ts', 'const verified = true; const accurate = 1;', [])).toEqual([]);
  });

  it('does not flag module paths, quoted keys or string-literal types', () => {
    const source = [
      "import { a } from './verified.js';",
      "export * from './accuracy.js';",
      "export type S = 'verified' | 'cited';",
      "export const o = { 'verified': 1 };",
      "export const lazy = () => import('./verification.js');",
    ].join('\n');
    expect(scan('ok.ts', source, [])).toEqual([]);
  });

  it('honours the allow-list, and only for the named path and string', () => {
    const source = "export const x = 'Verified';";
    const allow = [{ path: 'a.ts', text: 'Verified', reason: 'probe' }];
    expect(scan('a.ts', source, allow)).toEqual([]);
    expect(scan('b.ts', source, allow)).not.toEqual([]);
  });
});

describe('banned labels in the codebase', () => {
  it('prints the allow-list, and every entry has a path, a string and a reason', () => {
    console.info(`truths allow-list (${String(ALLOWLIST.length)} entries):`, ALLOWLIST);
    for (const entry of ALLOWLIST) {
      expect(entry.path).toBeTruthy();
      expect(entry.text).toBeTruthy();
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('finds none in apps/web/src or packages/ui/src', () => {
    const files = ROOTS.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(20);
    const hits = files.flatMap((file) => scan(relative(REPO, file), readFileSync(file, 'utf8')));
    expect(hits).toEqual([]);
  });
});
