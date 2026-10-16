/**
 * s4c-contents: the Contents outline shows headings, not parser types (#177), on the three golden IR
 * fixtures (`packages/document-ir/fixtures/`): each section by its display text with the number
 * dropped, the front matter as the paper's title (plus a heading the parse left outside the tree),
 * and no "Belongs to no section" copy.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { indexDocument, type PaperSource } from '@papertree/anchoring';

import { Navigator } from '@/components/reader/Navigator';
import {
  frontMatterRows,
  headingDisplayTitle,
  isFragmentHeading,
} from '@/features/reader/model/contents';

function fixture(slug: string) {
  const source = JSON.parse(
    readFileSync(
      `${process.cwd()}/../../packages/document-ir/fixtures/${slug}.paperir.json`,
      'utf8',
    ),
  ) as PaperSource;
  return indexDocument(source, `s4c-contents:${slug}`);
}

function outlineOf(slug: string): HTMLElement {
  const doc = fixture(slug);
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

const PARSER_TYPES = ['title', 'author', 'affiliation', 'abstract', 'footnote', 'page_number'];

afterEach(cleanup);

describe('the Contents labels', () => {
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

  it('front matter keeps the title and headings, by their text; else the first block', () => {
    const leaves = [
      { blockId: 'a', type: 'author', label: 'Ashish Vaswani' },
      { blockId: 't', type: 'title', label: 'Attention Is All You Need' },
      { blockId: 'h', type: 'heading', label: '1 Abstract' },
    ];
    expect(frontMatterRows(leaves).map((l) => l.label)).toEqual([
      'Attention Is All You Need',
      'Abstract',
    ]);
    expect(frontMatterRows([leaves[0]!]).map((l) => l.label)).toEqual(['Ashish Vaswani']);
  });

  it('takes the title wherever the parse filed it (the real Attention parse) and drops the banner', () => {
    const front = [{ blockId: 'b', type: 'paragraph', label: 'Provided proper attribution is…' }];
    const title = { blockId: 't', type: 'title', label: 'Attention Is All You Need' };
    expect(frontMatterRows(front, title).map((l) => l.label)).toEqual([
      'Attention Is All You Need',
    ]);
  });

  it('a sentence fragment is not a heading (the rule the explain panel uses)', () => {
    expect(isFragmentHeading('scholarly works.')).toBe(true);
    expect(isFragmentHeading('and the decoder')).toBe(true);
    expect(isFragmentHeading('Introduction')).toBe(false);
    expect(isFragmentHeading('Decoder:')).toBe(false);
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
] as const)('the outline of %s', (slug, title, headings) => {
  it('lists headings by their display text and the front matter as the title', () => {
    const outline = outlineOf(slug);
    const texts = labels(outline);
    expect(within(outline).getByRole('button', { name: /Front matter/ })).toBeTruthy();
    expect(texts).toContain(title);
    for (const heading of headings) expect(texts).toContain(heading);
    // No numbered heading text and no parser type is a row's label, or any text of its own.
    expect(texts.filter((t) => /^\d+(\.\d+)*\.?\s/.test(t))).toEqual([]);
    for (const type of PARSER_TYPES) expect(within(outline).queryByText(type)).toBeNull();
    expect(outline.textContent).not.toMatch(/Belongs to no section/);
  });
});
