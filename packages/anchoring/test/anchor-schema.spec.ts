/**
 * anchoring/anchor-schema.spec — every `captureAnchor()` output is a valid persisted Anchor v1
 * (contracts.md §6, §9).
 *
 * `contracts/anchor/anchor-v1.schema.json` is HAND-WRITTEN from `src/types.ts` (no TS-to-schema
 * generator is locked), so it is kept honest from both sides:
 *
 *   this spec   validates, with ajv, what `captureAnchor` actually emits: every block of every
 *               fixture paper whole and as a sub-range, a Guided capture, and the ten target kinds
 *               of `targets.spec`. A field added to `Anchor` without the schema fails here.
 *   the API     `services/api/python/tests/test_anchor_examples.py` requires the pydantic `AnchorV1`
 *               to accept every file in `contracts/anchor/examples/`, which this spec writes (all
 *               but `legacy-0001.json`, which the Python side writes from a REAL 0005 migration).
 *
 * THE EXAMPLES are compared, not overwritten: a missing one is written; a stale one fails, naming
 * the file, unless `PAPERTREE_WRITE_ANCHOR_EXAMPLES=1` (then it is rewritten, and the diff is the
 * review). After writing, run `pnpm exec prettier --write contracts/anchor`; the comparison is on
 * parsed JSON, so formatting never makes an example stale.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { captureAnchor, type CaptureInput } from '../src/capture.js';
import { indexDocument, type IndexedDocument, type PaperSource } from '../src/document.js';
import type { Anchor, SubTarget, TargetKind } from '../src/types.js';
import { FIXTURE_SLUGS, loadFixture } from './fixtures.js';

const CONTRACT_DIR = fileURLToPath(new URL('../../../contracts/anchor/', import.meta.url));
const EXAMPLES_DIR = `${CONTRACT_DIR}examples/`;
const SCHEMA = JSON.parse(readFileSync(`${CONTRACT_DIR}anchor-v1.schema.json`, 'utf8')) as object;
const CITATION_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/citation-nav.paperir.json', import.meta.url)),
    'utf8',
  ),
) as PaperSource;

type Validate = ((value: unknown) => boolean) & { errors?: unknown[] | null };
// The same cast `document-ir/test/schema.spec.ts` uses: ajv's CJS default export under NodeNext.
const AjvCtor = Ajv2020 as unknown as new (opts: Record<string, unknown>) => {
  compile(schema: object): Validate;
};
const validate = new AjvCtor({ strict: true, allErrors: true }).compile(SCHEMA);

const AT = '2026-09-25T15:09:25.123Z';
const CLIENT = 'papertree-web';

/** `crypto.randomUUID()`'s shape, deterministic so the examples are stable. */
function uuid(n: number): string {
  return `3f1c9a52-7d4e-4b8a-9c21-${n.toString(16).padStart(12, '0')}`;
}

/** contracts.md §6: the IR path's `textStreamId`. */
function index(paper: PaperSource): IndexedDocument {
  const generation = (paper as { generation?: number }).generation ?? 1;
  return indexDocument(
    paper,
    `api/${paper.paper_id}/g${String(generation)}/${paper.parser?.version ?? 'unknown'}`,
  );
}

function errorsOf(anchor: unknown): string {
  validate(anchor);
  return JSON.stringify(validate.errors ?? []);
}

function capture(
  doc: IndexedDocument,
  input: Omit<CaptureInput, 'doc' | 'at' | 'client' | 'id'> & { id?: string },
): Anchor {
  return captureAnchor({ doc, at: AT, client: CLIENT, id: input.id ?? uuid(0), ...input });
}

const PAPERS: { name: string; paper: PaperSource }[] = [
  ...FIXTURE_SLUGS.map((slug) => ({ name: slug, paper: loadFixture(slug) })),
  { name: 'citation-nav', paper: CITATION_FIXTURE },
];

/** Every capture this spec can make of every fixture paper. */
function everyCapture(): { label: string; anchor: Anchor }[] {
  const out: { label: string; anchor: Anchor }[] = [];
  let n = 1;
  for (const { name, paper } of PAPERS) {
    const doc = index(paper);
    for (const block of doc.blocks) {
      const length = block.textCodePoints.length;
      out.push({
        label: `${name}/${block.id} whole`,
        anchor: capture(doc, { blockId: block.id, targetKind: 'text', id: uuid(n++) }),
      });
      if (length > 12) {
        out.push({
          label: `${name}/${block.id} range`,
          anchor: capture(doc, {
            blockId: block.id,
            targetKind: 'text',
            startOffset: 3,
            endOffset: Math.min(length, 80),
            id: uuid(n++),
          }),
        });
        out.push({
          label: `${name}/${block.id} guided`,
          anchor: capture(doc, {
            blockId: block.id,
            targetKind: 'guided_para',
            provenanceClass: 'ai_generated',
            mode: 'guided',
            startOffset: 0,
            endOffset: Math.min(length, 40),
            id: uuid(n++),
          }),
        });
      }
    }
  }
  return out;
}

interface Case {
  readonly kind: TargetKind;
  readonly paper: PaperSource;
  readonly blockType: string;
  readonly subTarget?: SubTarget;
  readonly range?: readonly [number, number];
}

/** `targets.spec`'s ten kinds; the ones with a `file` are the committed examples. */
const KINDS: (Case & { file: string | null })[] = [
  {
    file: 'text',
    kind: 'text',
    paper: loadFixture('resnet-cvpr-2col'),
    blockType: 'paragraph',
    range: [10, 90],
  },
  {
    file: null,
    kind: 'equation',
    paper: loadFixture('attention-is-all-you-need'),
    blockType: 'equation',
  },
  {
    file: 'equation-part',
    kind: 'equation_part',
    paper: loadFixture('attention-is-all-you-need'),
    blockType: 'equation',
    subTarget: { kind: 'equation_part', normalisedRect: [0, 0, 0.34, 1] },
  },
  { file: null, kind: 'figure', paper: loadFixture('resnet-cvpr-2col'), blockType: 'figure' },
  {
    file: 'figure-region',
    kind: 'figure_region',
    paper: loadFixture('resnet-cvpr-2col'),
    blockType: 'figure',
    subTarget: { kind: 'figure_region', normalisedRect: [0.25, 0.1, 0.75, 0.6] },
  },
  {
    file: null,
    kind: 'table_row',
    paper: loadFixture('neural-odes-mathheavy'),
    blockType: 'table_row',
  },
  {
    file: 'table-cell',
    kind: 'table_cell',
    paper: loadFixture('neural-odes-mathheavy'),
    blockType: 'table_cell',
  },
  {
    file: null,
    kind: 'algorithm',
    paper: loadFixture('neural-odes-mathheavy'),
    blockType: 'algorithm',
  },
  { file: 'citation', kind: 'citation', paper: CITATION_FIXTURE, blockType: 'citation' },
];

function captureKind(testCase: Case, n: number): Anchor {
  const doc = index(testCase.paper);
  const block = doc.blocks.find((b) => b.type === testCase.blockType);
  if (block === undefined) throw new Error(`no ${testCase.blockType} block in this fixture`);
  return capture(doc, {
    blockId: block.id,
    targetKind: testCase.kind,
    id: uuid(0x100 + n),
    ...(testCase.range === undefined
      ? {}
      : { startOffset: testCase.range[0], endOffset: testCase.range[1] }),
    ...(testCase.subTarget === undefined ? {} : { subTarget: testCase.subTarget }),
  });
}

/** The ShapeSelector of a record, for mutating it. */
function shapeOf(anchor: Record<string, unknown>): Record<string, unknown> {
  return (anchor['selectors'] as Record<string, unknown>[]).find(
    (s) => s['type'] === 'ShapeSelector',
  ) as Record<string, unknown>;
}

describe('anchoring/anchor-schema.spec — captureAnchor output is Anchor v1', () => {
  it('every capture of every block of every fixture paper validates', () => {
    const captures = everyCapture();
    for (const { label, anchor } of captures) {
      expect(validate(anchor), `${label}: ${errorsOf(anchor)}`).toBe(true);
    }
    // Non-vacuous: the fixtures hold 199 + the citation fixture's blocks, most with text.
    expect(captures.length).toBeGreaterThan(400);
    console.log(`[anchor-schema] ${String(captures.length)} captureAnchor() outputs validated`);
  });

  it('the ten target kinds validate', () => {
    KINDS.forEach((testCase, n) => {
      const anchor = captureKind(testCase, n);
      expect(anchor.targetKind).toBe(testCase.kind);
      expect(validate(anchor), `${testCase.kind}: ${errorsOf(anchor)}`).toBe(true);
    });
  });

  it('the schema refuses what the record forbids', () => {
    const good = captureKind(KINDS[0] as Case, 0);
    expect(validate(good)).toBe(true);
    const broken: [string, (a: Record<string, unknown>) => void][] = [
      ['anchorVersion 2', (a) => (a['anchorVersion'] = 2)],
      ['anchorVersion true', (a) => (a['anchorVersion'] = true)],
      [
        'a stored resolution (the T0 cache is never persisted)',
        (a) => (a['resolution'] = { tier: 0 }),
      ],
      ['an unknown key', (a) => (a['colour'] = 'amber')],
      ['no doc', (a) => delete a['doc']],
      ['a bare-hex pdfSha256', (a) => ((a['doc'] as Record<string, unknown>)['pdfSha256'] = 'ab')],
      ['targetKind paragraph', (a) => (a['targetKind'] = 'paragraph')],
      ['a quad of three', (a) => (shapeOf(a)['quads'] = [[1, 2, 3]])],
      ['rotation 45', (a) => (shapeOf(a)['rotation'] = 45)],
      ['a pixel-space string', (a) => (shapeOf(a)['pageWidth'] = '612px')],
      ['an unknown selector', (a) => (a['selectors'] as unknown[]).push({ type: 'XPathSelector' })],
    ];
    for (const [label, mutate] of broken) {
      const anchor = structuredClone(good) as unknown as Record<string, unknown>;
      mutate(anchor);
      expect(validate(anchor), label).toBe(false);
    }
  });

  it('writes, or checks, the committed examples', () => {
    const rewrite = process.env['PAPERTREE_WRITE_ANCHOR_EXAMPLES'] === '1';
    mkdirSync(EXAMPLES_DIR, { recursive: true });
    const stale: string[] = [];
    KINDS.forEach((testCase, n) => {
      if (testCase.file === null) return;
      const anchor = captureKind(testCase, n);
      const path = `${EXAMPLES_DIR}${testCase.file}.json`;
      if (!existsSync(path) || rewrite) {
        writeFileSync(path, `${JSON.stringify(anchor, null, 2)}\n`);
        return;
      }
      const committed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (JSON.stringify(committed) !== JSON.stringify(anchor)) stale.push(testCase.file);
    });
    expect(
      stale,
      'captureAnchor() output changed. Re-run with PAPERTREE_WRITE_ANCHOR_EXAMPLES=1, then ' +
        '`pnpm exec prettier --write contracts/anchor`, and re-run the API test ' +
        'services/api/python/tests/test_anchor_examples.py: the pydantic AnchorV1 must accept them',
    ).toEqual([]);
  });

  it('every committed example validates, the migration-written legacy one included', () => {
    const files = readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.json'));
    expect(files).toContain('legacy-0001.json');
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const name of files) {
      const example: unknown = JSON.parse(readFileSync(`${EXAMPLES_DIR}${name}`, 'utf8'));
      expect(validate(example), `${name}: ${errorsOf(example)}`).toBe(true);
    }
  });
});
