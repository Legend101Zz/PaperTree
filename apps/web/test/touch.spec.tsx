/**
 * reader/touch.spec — the automated touch audit.
 *
 * Three obligations from the epic brief, each checked mechanically rather than reviewed for:
 *
 *   1. every interactive element is at least 44 × 44 CSS px;
 *   2. zero hover-only actions;
 *   3. Pointer Events, never mouse-only ones.
 *
 * HOW BIG A THING IS, WITHOUT A LAYOUT ENGINE — READ THIS BEFORE TRUSTING §1.
 *
 * happy-dom parses CSS but does NOT lay anything out. `getBoundingClientRect()` returns all zeros
 * for every element in this file, and `getComputedStyle(el).minWidth` returns only what was set
 * inline, because no stylesheet is loaded and Tailwind's classes have no definitions here. So there
 * is no honest way to MEASURE a rendered pixel in this environment, and a test that called
 * `getBoundingClientRect()` and asserted `>= 44` would pass on a 4px button and fail on everything
 * — it would be asserting that happy-dom is happy-dom.
 *
 * This audit therefore reads the DECLARATION, not the result: the `min-w-*` / `min-h-*` / `w-*` /
 * `h-*` Tailwind tokens in `className`, and the `min-width` / `min-height` / `width` / `height` of
 * the inline `style`. That is a static audit of what the component asks for. It catches the failure
 * that matters — a control that never states a minimum, which is every one of v1's 8–20px icon
 * buttons — and it CANNOT catch a control that declares 44px and is then squashed by a flex parent
 * with `min-width: 0`. That residual case needs a real browser and belongs to a visual-regression
 * suite this repo does not have. Said plainly rather than papered over.
 *
 * Where a control delegates its size to its parent — `absolute inset-0 h-full w-full`, which is how
 * the upload dropzone's file input fills its label — the audit follows the delegation up the tree
 * and requires the ANCESTOR to declare the minimum. That is what the browser would do.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CASES, TOUCH_TARGET_MIN_PX, openDisclosure, type LibraryCase } from './library-cases';

afterEach(cleanup);

/**
 * The shared cases, plus one variant with the uncertainty disclosure OPEN — its Report button lives
 * inside a `[hidden]` subtree until then and would otherwise never be audited.
 */
const TOUCH_CASES: readonly LibraryCase[] = [
  ...CASES,
  {
    ...(CASES.find((c) => c.name === 'UncertaintyState') as LibraryCase),
    name: 'UncertaintyState (expanded)',
    afterRender: (container) => {
      openDisclosure(container, (element) => {
        // A plain `click` with `detail === 0` is exactly what a browser synthesises for Enter/Space
        // on a native button, so this opens the panel the same way a keyboard user would.
        fireEvent.click(element);
      });
    },
  },
];

// ────────────────────────────────────────────────────────────────────────────────────────────────
// declared-size audit
// ────────────────────────────────────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]',
].join(', ');

/**
 * Everything a user can reach with Tab, minus what the browser takes out of the tab order anyway.
 *
 * `[hidden]` subtrees are excluded because a collapsed disclosure's contents are not reachable —
 * which is why `UncertaintyState` appears twice in `CASES`, once expanded.
 */
function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute('tabindex') === '-1') return false;
    if (element.hasAttribute('disabled')) return false;
    if (element.closest('[hidden]') !== null) return false;
    if (element.closest('[aria-hidden="true"]') !== null) return false;
    return true;
  });
}

type Axis = 'width' | 'height';

const REM_PX = 16;
/** Tailwind's spacing scale: 1 unit = 0.25rem. */
const SPACING_UNIT_PX = 4;

function parseCssLength(raw: string): number | undefined {
  const trimmed = raw.trim();
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(trimmed);
  if (px !== null) return Number(px[1]);
  const rem = /^(-?\d+(?:\.\d+)?)rem$/.exec(trimmed);
  if (rem !== null) return Number(rem[1]) * REM_PX;
  return undefined;
}

/**
 * Strip Tailwind variants: `sm:min-h-[44px]` → `min-h-[44px]`.
 *
 * Only the part before the first `[` is searched for the separating colon, so arbitrary values that
 * legitimately contain one — `[text-decoration-line:underline]` — are not mangled.
 */
function stripVariants(token: string): { bare: string; hadVariant: boolean } {
  const bracket = token.indexOf('[');
  const head = bracket === -1 ? token : token.slice(0, bracket);
  const lastColon = head.lastIndexOf(':');
  if (lastColon === -1) return { bare: token, hadVariant: false };
  return { bare: token.slice(lastColon + 1), hadVariant: true };
}

type Declaration = { readonly kind: 'px'; readonly value: number } | { readonly kind: 'inherit' };

/** `full`, `auto`, a fraction, `inherit`: the size comes from somewhere up the tree. */
const DELEGATING_VALUES = new Set(['full', 'auto', 'fit', 'min', 'max', 'inherit', 'initial']);

function tailwindDeclarations(className: string, axis: Axis): Declaration[] {
  const prefixes = axis === 'width' ? ['min-w', 'w', 'size'] : ['min-h', 'h', 'size'];
  const found: Declaration[] = [];

  for (const token of className.split(/\s+/)) {
    if (token.length === 0) continue;
    const { bare, hadVariant } = stripVariants(token);
    // Variant-scoped sizes are ignored: `sm:w-auto` describes one breakpoint, and treating it as
    // THE size would let a base-state violation hide behind a responsive override (or vice versa).
    if (hadVariant) continue;

    for (const prefix of prefixes) {
      if (!bare.startsWith(`${prefix}-`)) continue;
      const value = bare.slice(prefix.length + 1);

      if (value.startsWith('[') && value.endsWith(']')) {
        const px = parseCssLength(value.slice(1, -1));
        if (px !== undefined) found.push({ kind: 'px', value: px });
        break;
      }
      if (DELEGATING_VALUES.has(value) || value.includes('/')) {
        found.push({ kind: 'inherit' });
        break;
      }
      if (value === 'screen' || value === 'dvh' || value === 'svh') {
        found.push({ kind: 'px', value: Number.MAX_SAFE_INTEGER });
        break;
      }
      if (value === 'px') {
        found.push({ kind: 'px', value: 1 });
        break;
      }
      if (/^\d+(\.\d+)?$/.test(value)) {
        found.push({ kind: 'px', value: Number(value) * SPACING_UNIT_PX });
        break;
      }
      break;
    }
  }
  return found;
}

function inlineDeclarations(element: HTMLElement, axis: Axis): Declaration[] {
  const props = axis === 'width' ? ['minWidth', 'width'] : ['minHeight', 'height'];
  const found: Declaration[] = [];
  for (const prop of props) {
    const raw = element.style.getPropertyValue(
      prop === 'minWidth' ? 'min-width' : prop === 'minHeight' ? 'min-height' : prop,
    );
    if (raw === '') continue;
    const px = parseCssLength(raw);
    if (px !== undefined) found.push({ kind: 'px', value: px });
    else if (raw.includes('%') || DELEGATING_VALUES.has(raw.trim())) found.push({ kind: 'inherit' });
  }
  return found;
}

interface Resolution {
  readonly px: number;
  /** Which element the number came from — the element itself, or an ancestor it delegates to. */
  readonly from: HTMLElement;
}

/**
 * The declared minimum for one axis, following `w-full`-style delegation up the tree.
 *
 * When several numbers are declared on one element the SMALLEST wins. Two declarations in one class
 * list (`min-h-[44px] h-6`) are ambiguous without a cascade, and for a minimum-size audit the
 * pessimistic reading is the correct one.
 */
function resolveDeclaredMin(element: HTMLElement, axis: Axis, root: HTMLElement): Resolution | null {
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current !== null && depth < 12) {
    const declarations = [
      ...tailwindDeclarations(current.className, axis),
      ...inlineDeclarations(current, axis),
    ];
    const pixels = declarations
      .filter((d): d is { kind: 'px'; value: number } => d.kind === 'px')
      .map((d) => d.value);

    if (pixels.length > 0) return { px: Math.min(...pixels), from: current };
    if (!declarations.some((d) => d.kind === 'inherit')) return null;

    if (current === root) return null;
    current = current.parentElement;
    depth += 1;
  }
  return null;
}

function describeElement(element: HTMLElement): string {
  const label =
    element.getAttribute('aria-label') ??
    element.textContent?.trim().slice(0, 40) ??
    element.getAttribute('id') ??
    '';
  return `<${element.tagName.toLowerCase()}> "${label}" class="${element.className}" style="${element.getAttribute('style') ?? ''}"`;
}

/** Every focusable element in `root` whose declared minimum is missing or below 44px. */
function auditTargets(root: HTMLElement): string[] {
  const offenders: string[] = [];
  for (const element of focusableElements(root)) {
    for (const axis of ['width', 'height'] as const) {
      const resolved = resolveDeclaredMin(element, axis, root);
      if (resolved === null) {
        offenders.push(`declares no ${axis} at all: ${describeElement(element)}`);
      } else if (resolved.px < TOUCH_TARGET_MIN_PX) {
        offenders.push(
          `${axis} declared as ${String(resolved.px)}px (< ${String(TOUCH_TARGET_MIN_PX)}px): ${describeElement(element)}`,
        );
      }
    }
  }
  return offenders;
}

describe('touch targets are at least 44 x 44 CSS px', () => {
  for (const testCase of TOUCH_CASES) {
    it(`${testCase.name}: every focusable element declares a 44px minimum`, () => {
      const { container } = render(testCase.element);
      testCase.afterRender?.(container);

      const offenders = auditTargets(container);
      expect(offenders, `${testCase.name} has undersized targets:\n  ${offenders.join('\n  ')}`).toEqual([]);
    });
  }

  it('the audit itself detects undersized and undeclared targets', () => {
    // Without this, "zero offenders" is equally consistent with a parser that matches nothing. Each
    // control below is a real v1 shape: a 16px icon button, a 40px one that is nearly right, and a
    // control that declares no size at all.
    const { container } = render(
      <div>
        <button type="button" className="w-4 h-4" aria-label="tiny" />
        <button type="button" style={{ minWidth: 40, minHeight: 40 }} aria-label="nearly" />
        <button type="button" aria-label="unstated" />
        <button type="button" className="min-w-[44px] min-h-[44px]" aria-label="fine" />
      </div>,
    );

    const offenders = auditTargets(container);
    expect(offenders.some((o) => o.includes('"tiny"') && o.includes('16px'))).toBe(true);
    expect(offenders.some((o) => o.includes('"nearly"') && o.includes('40px'))).toBe(true);
    expect(offenders.some((o) => o.includes('"unstated"') && o.includes('declares no'))).toBe(true);
    expect(offenders.some((o) => o.includes('"fine"'))).toBe(false);
  });

  it('the audit follows w-full/h-full delegation up to the sized ancestor', () => {
    // The upload dropzone's file input is `absolute inset-0 h-full w-full` inside a large label.
    // If the walk regressed to "the element itself must declare it", that input would be a false
    // positive and someone would "fix" it by shrinking the affordance.
    const { container } = render(
      <label className="min-h-[160px] min-w-[44px]">
        pick
        <input type="file" className="absolute inset-0 h-full w-full opacity-0" />
      </label>,
    );
    expect(auditTargets(container)).toEqual([]);
  });

  it('audits a non-trivial number of controls (guards against an empty sweep)', () => {
    // A size audit that renders nothing passes vacuously. This is the tripwire.
    let total = 0;
    for (const testCase of TOUCH_CASES) {
      const { container } = render(testCase.element);
      testCase.afterRender?.(container);
      total += focusableElements(container).length;
      cleanup();
    }
    expect(total).toBeGreaterThan(30);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// source scans
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `import.meta.url` is NOT a `file:` URL under vitest — the module id is a server path — so the
 * scan is anchored to the working directory instead, which vitest sets to the project root. The
 * repo-root case is handled too, because turbo runs the suite from there.
 */
const COMPONENTS_DIR = ((): string => {
  for (const candidate of [
    resolve(process.cwd(), 'src/components'),
    resolve(process.cwd(), 'apps/web/src/components'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`touch.spec: cannot locate apps/web/src/components from ${process.cwd()}`);
})();

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out.sort();
}

function repoPath(absolute: string): string {
  return relative(COMPONENTS_DIR, absolute).split(sep).join('/');
}

/**
 * v1 COMPONENTS THAT ALREADY VIOLATE THESE RULES. THE EXIT CRITERION FOR EPIC 2 IS AN EMPTY LIST.
 *
 * These files predate this epic. They are the canvas that `research/audit-frontend-reader.md`
 * describes: zero touch handlers, controls that appear on `group-hover`, drag implemented with
 * `onMouseMove`. The v1 READER was on this list too and is not any more — Epic 2 deleted
 * `PDFViewer`, `PDFMinimap`, `BookViewer`, `HighlightPopup`, `HighlightsPanel` and
 * `SmartOutlinePanel` in this branch, and their replacements in `components/reader/` pass this scan
 * unquarantined. The canvas is not in this epic's charter, so its six files stay listed rather than
 * turning the suite red for work nobody here is allowed to do.
 *
 * (#75 moved the whole canvas surface to `archive/v1-web-canvas/`, so the six entries below now
 * name files that are not in `src/` at all. They are kept rather than deleted because this ledger's
 * "a listed file that no longer offends fails" rule is guarded on the file EXISTING — an entry for
 * a moved file is inert, not stale. Delete them when Epic 5 (#43) rebuilds the canvas and this list
 * stops being the record of what was quarantined.)
 *
 * The list is a DEBT LEDGER and it is enforced in both directions:
 *
 *   - a file NOT on this list that offends fails the suite, so the debt cannot grow;
 *   - a file ON this list that no longer offends ALSO fails, with an instruction to delete its
 *     line, so the ledger cannot outlive the debt;
 *   - a file on this list that has been DELETED is reported and passes. Deleting the v1 component
 *     is the desired outcome and must never turn the build red.
 */
const V1_QUARANTINE: readonly string[] = [
  'canvas/MermaidRenderer.tsx',
  'canvas/RichCanvasNode.tsx',
  'canvas/nodes/AIResponseNode.tsx',
  'canvas/nodes/ExplorationNode.tsx',
  'canvas/nodes/NoteNode.tsx',
  'canvas/nodes/PageSuperNode.tsx',
];

/** Mouse-only interaction. `onMouseMove` drag is the v1 minimap; a finger never sends it. */
const MOUSE_INTERACTION = /\bon(?:MouseDown|MouseUp|MouseMove)\s*=/;

/**
 * Hover handlers.
 *
 * Every one is reported, not only the ones that "trigger an action" — a static scan cannot tell an
 * action from a decoration, and it does not need to: a decoration that only appears under a cursor
 * is itself a hover-only affordance, which is the thing being banned.
 */
const HOVER_HANDLER = /\bon(?:MouseEnter|MouseOver|MouseLeave)\s*=/;

/** `hover:` classes that control opacity, visibility or display. Colour changes are fine. */
const HOVER_VISIBILITY =
  /(?:group-)?hover:(?:opacity-\d+|visible|invisible|hidden|inline-block|inline-flex|inline|block|flex|grid|contents|table)\b/;

/** Anything that gives the same treatment to a keyboard user or an explicitly-open state. */
const FOCUS_COUNTERPART =
  /(?:group-)?(?:focus|focus-within|focus-visible):|data-\[(?:state=)?open|aria-expanded|data-open/;

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly rule: string;
}

function scan(file: string): Offence[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const offences: Offence[] = [];
  const path = repoPath(file);

  lines.forEach((line, index) => {
    if (MOUSE_INTERACTION.test(line)) {
      offences.push({ file: path, line: index + 1, text: line.trim(), rule: 'mouse-only-interaction' });
    }
    if (HOVER_HANDLER.test(line)) {
      offences.push({ file: path, line: index + 1, text: line.trim(), rule: 'hover-handler' });
    }
    if (HOVER_VISIBILITY.test(line)) {
      // A three-line window, because long class strings wrap and the `focus-visible:` counterpart
      // routinely lands on the next line. Erring towards NOT reporting is deliberate: a false
      // positive gets the rule disabled, a false negative gets it fixed next sweep.
      const window = [lines[index - 1] ?? '', line, lines[index + 1] ?? ''].join(' ');
      if (!FOCUS_COUNTERPART.test(window)) {
        offences.push({ file: path, line: index + 1, text: line.trim(), rule: 'hover-only-visibility' });
      }
    }
  });

  return offences;
}

function format(offences: readonly Offence[]): string {
  return offences.map((o) => `  ${o.file}:${String(o.line)} [${o.rule}] ${o.text.slice(0, 110)}`).join('\n');
}

describe('source audit: no hover-only actions, no mouse-only interaction', () => {
  const files = tsxFilesUnder(COMPONENTS_DIR);
  const quarantined = new Set(V1_QUARANTINE);
  const byFile = new Map(files.map((file) => [repoPath(file), scan(file)] as const));

  it('finds component sources to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('the scan patterns match the shapes they are meant to catch, and nothing else', () => {
    // A regex audit that quietly matches nothing reports a clean codebase forever.
    expect(MOUSE_INTERACTION.test('<div onMouseMove={handleDrag}>')).toBe(true);
    expect(MOUSE_INTERACTION.test('<div onPointerMove={handleDrag}>')).toBe(false);
    expect(HOVER_HANDLER.test('onMouseEnter={() => setHovered(true)}')).toBe(true);
    expect(HOVER_HANDLER.test('onPointerEnter={() => setHovered(true)}')).toBe(false);
    expect(HOVER_VISIBILITY.test('className="opacity-0 group-hover:opacity-100"')).toBe(true);
    expect(HOVER_VISIBILITY.test('className="hidden hover:block"')).toBe(true);
    // A colour or shadow change on hover is not a hover-ONLY affordance; nothing is being revealed.
    expect(HOVER_VISIBILITY.test('className="hover:bg-gray-100 hover:shadow-md"')).toBe(false);
    expect(FOCUS_COUNTERPART.test('group-hover:opacity-100 focus-visible:opacity-100')).toBe(true);
    expect(FOCUS_COUNTERPART.test('group-hover:opacity-100')).toBe(false);
  });

  it('no component outside the v1 quarantine uses onMouseDown/onMouseUp/onMouseMove', () => {
    const offenders: Offence[] = [];
    byFile.forEach((offences, path) => {
      if (quarantined.has(path)) return;
      offenders.push(...offences.filter((o) => o.rule === 'mouse-only-interaction'));
    });
    expect(
      offenders,
      `Pointer Events only. Offenders:\n${format(offenders)}`,
    ).toEqual([]);
  });

  it('no component outside the v1 quarantine has a hover-only action or hover-only visibility', () => {
    const offenders: Offence[] = [];
    byFile.forEach((offences, path) => {
      if (quarantined.has(path)) return;
      offenders.push(...offences.filter((o) => o.rule !== 'mouse-only-interaction'));
    });
    expect(
      offenders,
      `Every hover affordance needs a tap/focus equivalent. Offenders:\n${format(offenders)}`,
    ).toEqual([]);
  });

  it('the v1 quarantine list contains no file that is already clean', () => {
    const stale: string[] = [];
    const deleted: string[] = [];

    for (const path of V1_QUARANTINE) {
      const offences = byFile.get(path);
      if (offences === undefined) {
        deleted.push(path);
        continue;
      }
      if (offences.length === 0) stale.push(path);
    }

    if (deleted.length > 0) {
      // Deleting a v1 component is the point of the epic. Reported, never punished.
      // eslint-disable-next-line no-console
      console.warn(
        `touch.spec: ${String(deleted.length)} quarantined v1 file(s) no longer exist — tidy V1_QUARANTINE when convenient:\n  ${deleted.join('\n  ')}`,
      );
    }

    expect(
      stale,
      `These files are clean now. Delete them from V1_QUARANTINE in test/touch.spec.tsx so the ledger cannot outlive the debt:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the library components this epic adds are themselves clean', () => {
    // Belt and braces: the quarantine is keyed by path, and a typo in it would silently exempt a
    // new file. This asserts the new surface directly.
    const offenders: Offence[] = [];
    byFile.forEach((offences, path) => {
      if (path.startsWith('library/')) offenders.push(...offences);
    });
    expect(offenders, `New library components must be clean:\n${format(offenders)}`).toEqual([]);
  });
});
