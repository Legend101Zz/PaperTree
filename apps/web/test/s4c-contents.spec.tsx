/**
 * s4c-contents: the Contents outline shows headings, not parser types (#177). On the three golden IR
 * fixtures (`packages/document-ir/fixtures/`) and on pages 1-2 of two REAL parses from the demo
 * library (`test/fixtures/real-*.ir.json`, trimmed copies of `GET /papers/{id}/ir`):
 * - each section by its display text with the number dropped;
 * - the front matter as the paper's title, listed once (the real ResNet parse heads a section with it);
 * - a scrap of body text the parser made a heading ("scholarly works.") is not listed, while real
 *   headings that start in lowercase or end with a full stop are;
 * - blocks outside the tree read in plain words; no "Belongs to no section" copy.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { indexDocument, type PaperSource } from '@papertree/anchoring';

import { Navigator } from '@/components/reader/Navigator';
import {
  frontMatterRows,
  headingDisplayTitle,
  isFragmentHeading,
  outsideLabel,
} from '@/features/reader';

const GOLDEN = `${process.cwd()}/../../packages/document-ir/fixtures`;
const REAL = `${process.cwd()}/test/fixtures`;

function load(path: string): PaperSource {
  return JSON.parse(readFileSync(path, 'utf8')) as PaperSource;
}

/** Renders the Contents panel on a parse and returns its outline. */
function outlineOf(source: PaperSource, name: string): HTMLElement {
  const doc = indexDocument(source, `s4c-contents:${name}`);
  render(
    <Navigator
      doc={doc}
      pages={doc.pages.map((p) => ({ index: p.index, width: p.width, height: p.height }))}
      open
      onClose={() => undefined}
      onNavigateToBlock={() => undefined}
      onNavigateToPage={() => undefined}
    />,
  );
  return screen.getByRole('navigation', { name: 'Document outline' });
}

/** Every row's label in the outline: a section's title, or a front-matter row's text. */
function labels(outline: HTMLElement): string[] {
  return Array.from(outline.querySelectorAll('button .truncate')).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

/** A golden fixture with one heading's text replaced, as a parse of another paper might give. */
function retitled(slug: string, from: string, to: string): PaperSource {
  const source = load(`${GOLDEN}/${slug}.paperir.json`) as unknown as {
    blocks: { text?: string }[];
  };
  const block = source.blocks.find((b) => b.text === from);
  if (block === undefined) throw new Error(`no block reads ${from}`);
  block.text = to;
  return source as unknown as PaperSource;
}

const PARSER_TYPES = ['title', 'author', 'affiliation', 'abstract', 'footnote', 'page_number'];

afterEach(cleanup);

describe('the Contents rules', () => {
  it('drops the section number, as the explain panel names sections', () => {
    expect(headingDisplayTitle('1 Introduction')).toBe('Introduction');
    expect(headingDisplayTitle('3.2.1 Scaled Dot-Product Attention')).toBe(
      'Scaled Dot-Product Attention',
    );
    expect(headingDisplayTitle('1. Introduction')).toBe('Introduction');
    expect(headingDisplayTitle('IV. Results')).toBe('Results');
    expect(headingDisplayTitle('Abstract')).toBe('Abstract');
    expect(headingDisplayTitle('3')).toBe('3');
  });

  it('a heading is body text only by its block type, or as a short lowercase sentence tail', () => {
    expect(isFragmentHeading('scholarly works.', 'heading')).toBe(true);
    expect(isFragmentHeading('Recurrence is sequential.', 'paragraph')).toBe(true);
    for (const real of [
      't-SNE background',
      'word2vec embeddings',
      'Background.',
      'k-NN.  baselines compared',
      'Decoder:',
      'xt, x′',
      'Introduction',
    ])
      expect(isFragmentHeading(real, 'heading'), real).toBe(false);
  });

  it('front matter is the title and headings by their text; never an author in their place', () => {
    const leaves = [
      { blockId: 'a', type: 'author', label: 'Ashish Vaswani' },
      { blockId: 't', type: 'title', label: 'Attention Is All You Need' },
      { blockId: 'h', type: 'heading', label: '1 Abstract' },
    ];
    expect(frontMatterRows(leaves).map((l) => l.label)).toEqual([
      'Attention Is All You Need',
      'Abstract',
    ]);
    expect(frontMatterRows([leaves[0]!])).toEqual([]);
    const banner = [{ blockId: 'b', type: 'paragraph', label: 'Provided proper attribution…' }];
    const title = { blockId: 't', type: 'title', label: 'Attention Is All You Need' };
    expect(frontMatterRows(banner, title).map((l) => l.label)).toEqual([
      'Attention Is All You Need',
    ]);
  });

  it('a block outside the tree says what it is in plain words', () => {
    expect(outsideLabel('page_number', '7')).toBe('Page number 7');
    expect(outsideLabel('footnote', '∗Equal contribution.')).toBe('Footnote: ∗Equal contribution.');
    expect(outsideLabel('caption', 'Figure 1: The Transformer')).toBe('Figure 1: The Transformer');
  });
});

describe.each([
  [
    'attention-is-all-you-need',
    'Attention Is All You Need',
    ['Introduction', 'Scaled Dot-Product Attention'],
  ],
  [
    'resnet-cvpr-2col',
    'Deep Residual Learning for Image Recognition',
    ['Introduction', 'Residual Learning'],
  ],
  ['neural-odes-mathheavy', 'Neural Ordinary Differential Equations', ['Introduction', 'Abstract']],
] as const)('the outline of the golden %s', (slug, title, headings) => {
  it('lists headings by their display text and the front matter as the title', () => {
    const outline = outlineOf(load(`${GOLDEN}/${slug}.paperir.json`), slug);
    const texts = labels(outline);
    expect(within(outline).getByRole('button', { name: /Front matter/ })).toBeTruthy();
    expect(texts.filter((t) => t === title)).toHaveLength(1);
    for (const heading of headings) expect(texts).toContain(heading);
    expect(texts.filter((t) => /^\d+(\.\d+)*\.?\s/.test(t))).toEqual([]);
    for (const type of PARSER_TYPES) expect(within(outline).queryByText(type)).toBeNull();
    expect(outline.textContent).not.toMatch(/Belongs to no section/);
  });
});

describe('real headings that look odd stay listed (review S3)', () => {
  it.each(['2 t-SNE background', '2 word2vec embeddings', '2 Background.'])(
    '"%s" keeps its section',
    (heading) => {
      const outline = outlineOf(
        retitled('attention-is-all-you-need', '2 Background', heading),
        heading,
      );
      expect(labels(outline)).toContain(headingDisplayTitle(heading));
    },
  );
});

describe('the real Attention parse, pages 1-2', () => {
  const source = load(`${REAL}/real-attention-p1-2.ir.json`);

  it('does not list the banner\'s "scholarly works." as a section, and lists the title once', () => {
    const outline = outlineOf(source, 'real-attention');
    const texts = labels(outline);
    // Fails if the fragment rule is switched off: the parse makes this a section heading.
    expect(texts).not.toContain('scholarly works.');
    expect(texts.filter((t) => t === 'Attention Is All You Need')).toHaveLength(1);
    expect(texts).toEqual(expect.arrayContaining(['Abstract', 'Introduction']));
    expect(texts.some((t) => t.startsWith('Provided proper attribution'))).toBe(false);
  });

  it('names a page number outside the tree as one, not as a bare digit', () => {
    const outline = outlineOf(source, 'real-attention-outside');
    fireEvent.click(within(outline).getByRole('button', { name: /Outside the section tree/ }));
    const texts = labels(outline);
    expect(texts.some((t) => /^Page number \d+$/.test(t))).toBe(true);
    expect(texts.filter((t) => /^\d+$/.test(t))).toEqual([]);
  });
});

describe('the real ResNet parse, pages 1-2 (its first section is headed by the title block)', () => {
  it('lists the title once, as that section, not again under Front matter', () => {
    const outline = outlineOf(load(`${REAL}/real-resnet-p1-2.ir.json`), 'real-resnet');
    const texts = labels(outline);
    expect(texts.filter((t) => t === 'Deep Residual Learning for Image Recognition')).toHaveLength(
      1,
    );
    expect(texts).toContain('Abstract');
  });
});
