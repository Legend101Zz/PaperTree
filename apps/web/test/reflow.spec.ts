/**
 * reflow.spec — the hyphen rule, pinned against prose the fixtures actually contain.
 *
 * `Block.text` is never de-hyphenated: there are 6 line-break hyphens in `attention`, 13 in
 * `neural-odes` and 61 in `resnet`. Guided view exists to be readable, and "transduc- tion" is not.
 * The cases below are the four the rule has to get right and the one it knowingly gets wrong.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { joinContinuedBlocks, reflow, reflowPreservingLines } from '../src/components/reader/reflow';

interface FixtureBlock {
  readonly block_id: string;
  readonly type: string;
  readonly text?: string;
}

/**
 * Walk up from the working directory for the workspace root.
 *
 * NOT `new URL('../../../packages/…', import.meta.url)`: Vite serves this file from a `/@fs/…`
 * specifier, so that URL resolves to a path with a literal `/@fs` segment and every fixture read
 * fails with ENOENT. Walking up works whether vitest is launched from `apps/web` or from the root.
 */
function workspaceRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found above ' + process.cwd());
    dir = parent;
  }
}

function loadFixture(slug: string): { readonly blocks: readonly FixtureBlock[] } {
  const path = join(workspaceRoot(), 'packages/document-ir/fixtures', `${slug}.paperir.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as { blocks: readonly FixtureBlock[] };
}

const FIXTURES = ['attention-is-all-you-need', 'neural-odes-mathheavy', 'resnet-cvpr-2col'] as const;

describe('reflow', () => {
  it('joins a soft hyphen and drops it', () => {
    expect(reflow('transduc-\ntion')).toBe('transduction');
    // The real occurrence, in context, from `attention`.
    expect(reflow('the tr-\nansduction models')).toBe('the transduction models');
  });

  it('keeps a hyphen between digits — a range is not a broken word', () => {
    expect(reflow('2015-\n2016')).toBe('2015-2016');
    expect(reflow('pages 12-\n14 of the appendix')).toBe('pages 12-14 of the appendix');
  });

  it('keeps a hyphen before a capital — a name is not a broken word', () => {
    expect(reflow('Kaiming-\nHe')).toBe('Kaiming-He');
  });

  it('turns a plain newline into a space', () => {
    expect(reflow('Ashish Vaswani\nGoogle Brain')).toBe('Ashish Vaswani Google Brain');
    expect(reflow('a\n\nb')).toBe('a b');
    expect(reflow('  padded  \n  line  ')).toBe('padded line');
  });

  it('handles consecutive breaks — the second must not be skipped', () => {
    // A lookahead rather than a capture is what makes this pass; consuming the following letter
    // would leave the second `-\n` with no letter in front of it.
    expect(reflow('a-\nb-\nc')).toBe('abc');
  });

  it('is knowingly wrong about a compound broken at its own hyphen', () => {
    // `resnet` contains "d/high-\nlevel". Telling this apart from `transduc-\ntion` needs a lexicon.
    // Documented, not hidden: the paper is one click away in Source.
    expect(reflow('mid/high-\nlevel features')).toBe('mid/highlevel features');
  });

  it('cannot repair a word broken across two BLOCKS, and does not pretend to', () => {
    // `resnet`'s `blk_4hiq3kzukt6azk4x` ends with "In addition, high-" and the next block opens with
    // "way networks…" — the column break fell inside a word. `reflow` sees one block at a time, so
    // the hyphen stays, which is the right answer: it has no evidence about what follows. Guided
    // renders each block in its own `DerivedBlock` and never concatenates them, so nothing
    // downstream turns this into "high- way" either. Repairing it would need the reading order and
    // belongs upstream, in the parser's own de-hyphenation.
    expect(reflow('In addition, high-')).toBe('In addition, high-');
  });

  it('leaves text with no line breaks alone', () => {
    expect(reflow('Deep Residual Learning for Image Recognition')).toBe(
      'Deep Residual Learning for Image Recognition',
    );
  });
});

describe('reflowPreservingLines', () => {
  it('repairs soft hyphens but keeps the layout', () => {
    expect(reflowPreservingLines('Input: parameters\nfor t in steps do\n  compute-\nvalue')).toEqual([
      'Input: parameters',
      'for t in steps do',
      'computevalue',
    ]);
  });
});

describe('against the fixtures', () => {
  for (const slug of FIXTURES) {
    it(`${slug}: no line-break hyphen survives the reflowed reading`, () => {
      const { blocks } = loadFixture(slug);
      // `figure`, `table` and `unknown` blocks have NO `text` key at all — guard before reading it.
      const withText = blocks.filter(
        (block): block is FixtureBlock & { text: string } => typeof block.text === 'string',
      );
      expect(withText.length).toBeGreaterThan(0);

      // The fixture has to actually contain the problem, or this test proves nothing.
      const hyphenated = withText.filter((block) => block.text.includes('-\n'));
      expect(hyphenated.length).toBeGreaterThan(0);

      for (const block of withText) {
        const out = reflow(block.text);
        expect(out, `${block.block_id} (${block.type})`).not.toContain('-\n');
        expect(out, `${block.block_id} (${block.type})`).not.toContain('\n');
      }
    });

    it(`${slug}: no broken word survives as "learn- ing" inside a paragraph`, () => {
      const { blocks } = loadFixture(slug);
      const paragraphs = blocks.filter(
        (block): block is FixtureBlock & { text: string } =>
          block.type === 'paragraph' && typeof block.text === 'string',
      );
      expect(paragraphs.length).toBeGreaterThan(0);

      for (const block of paragraphs) {
        // The two halves must end up adjacent, never separated by the space the line break became.
        // The pattern is ASCII-only and carries no `u` flag: `apps/web/tsconfig.json` sets no
        // `target`, so `tsc` compiles at ES5 and rejects it (TS1501) — the same constraint that
        // pushed `reflow` itself off `\p{L}`.
        expect(reflow(block.text), block.block_id).not.toMatch(/[A-Za-z]- [a-z]/);
      }
    });
  }
});

/**
 * The cross-block seam.
 *
 * Found while running the suite against the fixtures: `reflow` operates on ONE block, and a
 * hyphenated word can straddle a block boundary when a paragraph continues into the next column.
 * The set contains exactly one such case, and it is `resnet`'s single `continues_in_next_column`.
 */
describe('joinContinuedBlocks — de-hyphenation across a block boundary', () => {
  it('repairs the real case in resnet: a block ENDING in "high-"', () => {
    const { blocks } = loadFixture('resnet-cvpr-2col');
    const ending = blocks.find(
      (block): block is FixtureBlock & { text: string } =>
        typeof block.text === 'string' && block.text.trimEnd().endsWith('high-'),
    );
    // If this ever stops being true the fixture changed, and the test should fail loudly rather
    // than quietly stop covering anything.
    expect(ending, 'no block ending in "high-" — has the fixture changed?').toBeDefined();

    const joined = joinContinuedBlocks([ending!.text, 'way networks have not demonstrated']);
    expect(joined).toContain('highway networks');
    expect(joined).not.toMatch(/[A-Za-z]- [a-z]/);
  });

  it('keeps a hyphen that is part of the word', () => {
    expect(joinContinuedBlocks(['published 2015-', '2016 inclusive'])).toContain('2015-2016');
    expect(joinContinuedBlocks(['by Kaiming-', 'He and others'])).toContain('Kaiming-He');
  });

  it('joins ordinary fragments with exactly one space', () => {
    expect(joinContinuedBlocks(['the first part', 'the second part'])).toBe(
      'the first part the second part',
    );
  });

  it('ignores empty fragments rather than emitting double spaces', () => {
    expect(joinContinuedBlocks(['alpha', '', '   ', 'beta'])).toBe('alpha beta');
  });
});
