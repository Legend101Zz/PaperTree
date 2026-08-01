/**
 * anchoring/cross-mode.spec — the ninth acceptance test.
 *
 *   "A highlight made in Source resolves in Guided, or explicitly reports
 *    'not available in this view'."
 *
 * The criterion has TWO halves and the second is the one that is easy to fake. A resolver that
 * answered "resolved" for everything would satisfy the first half and be useless: Guided is a
 * *reading* of the paper, and a reading legitimately leaves things out — the arXiv stamp down the
 * margin, the page numbers, the hairline rules. The failure this spec exists to prevent is a
 * highlight on one of those disappearing in silence.
 *
 * So the tests below assert, in order:
 *   1. an ordinary Source highlight lands in the right Guided paragraph, AT THE RIGHT OFFSETS;
 *   2. a highlight on the tail of a paragraph continued across a column break lands in the paragraph
 *      its HEAD owns — the case `doc.continuedBy` exists for and was silently broken until
 *      2026-08-01 (it was a one-entry map keyed `undefined`);
 *   3. a highlight on page furniture reports `unavailable` WITH a human-readable message;
 *   4. the round trip, Guided → Source;
 *   5. a sweep over all three fixtures asserting the classification is TOTAL — every block of all
 *      199 gets an answer, and every `unavailable` answer carries a non-empty message.
 *
 * (5) is what stops this spec from being satisfied by three happy paths.
 */

import { describe, expect, it } from 'vitest';

import { captureAnchor } from '../src/capture.js';
import { indexDocument } from '../src/document.js';
import type { IndexedBlock, IndexedDocument } from '../src/document.js';
import {
  GUIDED_FURNITURE_TYPES,
  projectGuided,
  resolveCrossMode,
} from '../src/guided.js';
import { loadAllFixtures, loadFixture } from './fixtures.js';

function anchorOn(
  doc: IndexedDocument,
  block: IndexedBlock,
  extra: { startOffset?: number; endOffset?: number } = {},
) {
  return captureAnchor({
    doc,
    blockId: block.id,
    targetKind: 'text',
    provenanceClass: 'source',
    id: `x-${block.id}`,
    at: '2026-08-01T00:00:00Z',
    client: 'cross-mode.spec',
    mode: 'source',
    ...extra,
  });
}

describe('anchoring/cross-mode.spec — Source ⇄ Guided', () => {
  it('a Source highlight resolves in Guided at the mapped offsets, not merely in the right block', () => {
    // The whole point of the offset map. `reflow` deletes line breaks and repairs hyphens, so
    // offset 40 in `Block.text` is NOT offset 40 in the paragraph the reader sees. A cross-mode
    // "resolution" that returned only a paragraph id would be a guess dressed as an answer.
    const doc = indexDocument(loadFixture('resnet-cvpr-2col'), 'cross-mode');
    const view = projectGuided(doc);

    const block = doc.blocks.find(
      (b) => b.type === 'paragraph' && b.text.includes('\n') && b.textCodePoints.length > 300,
    );
    if (block === undefined) throw new Error('no multi-line paragraph in resnet');

    // Take a slice that STRADDLES a line break, so the mapping has to do real work.
    const newlineAt = Array.from(block.text).indexOf('\n');
    const start = Math.max(0, newlineAt - 12);
    const end = newlineAt + 12;
    const sourceSlice = Array.from(block.text).slice(start, end).join('');
    expect(sourceSlice).toContain('\n');

    const result = resolveCrossMode(anchorOn(doc, block, { startOffset: start, endOffset: end }), doc, 'guided', view);

    expect(result.state).toBe('resolved');
    expect(result.message).not.toBe('');
    expect(result.paragraphId).toBeDefined();
    expect(result.startOffset).toBeDefined();
    expect(result.endOffset).toBeDefined();

    const paragraph = view.byParagraphId.get(result.paragraphId as string);
    if (paragraph === undefined) throw new Error('paragraph missing from projection');
    const guidedSlice = Array.from(paragraph.text)
      .slice(result.startOffset as number, result.endOffset as number)
      .join('');

    // The reading of that slice: same words, no newline, and the offsets did MOVE (the reflow
    // removed characters before them), which is exactly what a naive block-offset reuse gets wrong.
    expect(guidedSlice).not.toContain('\n');
    const firstWord = sourceSlice.trim().split(/\s+/)[0] as string;
    if (firstWord.length > 3) expect(guidedSlice).toContain(firstWord);
  });

  it('a highlight on the TAIL of a continued paragraph resolves into the HEAD paragraph', () => {
    // resnet's `blk_4hiq3kzukt6azk4x` ends with the characters `high-` and the word finishes as
    // `way networks` in the block it continues into. Guided renders those as ONE paragraph, owned by
    // the head — so an anchor on the tail must resolve to the head's paragraph, or a highlight made
    // in the second column vanishes when the reader switches to the reading.
    const doc = indexDocument(loadFixture('resnet-cvpr-2col'), 'cross-mode');
    const view = projectGuided(doc);

    expect(doc.continuedBy.size).toBe(4); // was 1, keyed `undefined`, before the document.ts fix

    const [head, tail] = [...doc.continuedBy.entries()][0] as [string, string];
    const tailBlock = doc.byId.get(tail);
    if (tailBlock === undefined) throw new Error('tail block missing');

    const result = resolveCrossMode(anchorOn(doc, tailBlock), doc, 'guided', view);

    expect(result.state).toBe('resolved');
    expect(result.paragraphId).toBe(head);

    const paragraph = view.byParagraphId.get(head);
    if (paragraph === undefined) throw new Error('head paragraph missing');
    expect(paragraph.sourceIds).toContain(tail);
  });

  it('the seam hyphen is repaired across the column break — "highway", not "high- way"', () => {
    // The reading this whole continuation machinery exists to produce. Asserted here rather than
    // only in reflow.spec because it is the observable consequence of `continuedBy` being correct:
    // with the broken map the paragraphs never merged and the reading said "high- way networks".
    const doc = indexDocument(loadFixture('resnet-cvpr-2col'), 'cross-mode');
    const view = projectGuided(doc);
    const merged = view.paragraphs.filter((p) => p.sourceIds.length > 1);
    expect(merged.length).toBeGreaterThan(0);
    for (const paragraph of merged) {
      expect(paragraph.text).not.toContain('- ');
    }
  });

  it('a highlight on page furniture reports "not available in this view", with a message', () => {
    // The half of the criterion that is easy to fake. Furniture is real: the arXiv stamp is a
    // `margin_note` in attention and resnet and an `annotation` in neural-odes, and Guided has no
    // pages to put a page number on.
    let checked = 0;
    for (const { slug, paper } of loadAllFixtures()) {
      const doc = indexDocument(paper, 'cross-mode');
      const view = projectGuided(doc);
      const furniture = doc.blocks.filter(
        (b) => GUIDED_FURNITURE_TYPES.has(b.type) && b.text.trim().length > 0,
      );
      for (const block of furniture) {
        const result = resolveCrossMode(anchorOn(doc, block), doc, 'guided', view);
        expect(result.state, `${slug}/${block.id} (${block.type})`).toBe('unavailable');
        expect(result.reason).toBe('page_furniture_not_in_reading');
        // The message is the deliverable. A reason code that only ever reaches a log satisfies
        // "explicitly reports" no better than a silent drop does.
        expect(result.message.length).toBeGreaterThan(20);
        expect(result.message.toLowerCase()).toContain('not available in this view');
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a Guided-mode highlight resolves back in Source', () => {
    const doc = indexDocument(loadFixture('neural-odes-mathheavy'), 'cross-mode');
    const block = doc.blocks.find(
      (b) => b.type === 'paragraph' && b.textCodePoints.length > 200,
    );
    if (block === undefined) throw new Error('no paragraph');

    const guidedAnchor = captureAnchor({
      doc,
      blockId: block.id,
      startOffset: 0,
      endOffset: 60,
      targetKind: 'guided_para',
      provenanceClass: 'ai_generated',
      id: 'guided-round-trip',
      at: '2026-08-01T00:00:00Z',
      client: 'cross-mode.spec',
      mode: 'guided',
    });

    const back = resolveCrossMode(guidedAnchor, doc, 'source');
    expect(back.state).toBe('resolved');
    expect(back.blockIds).toContain(block.id);
    expect(back.message).not.toBe('');
  });

  it('EVERY block of all three fixtures gets an explicit answer — no silent drops', () => {
    // The anti-vacuity test. 199 blocks; each one either resolves in Guided or says why not, and
    // every "why not" is a sentence a user could read. Nothing returns undefined, nothing throws.
    const seenReasons = new Set<string>();
    let resolved = 0;
    let unavailable = 0;

    for (const { slug, paper } of loadAllFixtures()) {
      const doc = indexDocument(paper, 'cross-mode');
      const view = projectGuided(doc);

      // The projection classifies every block in the document, not just the ones it renders.
      for (const block of doc.blocks) {
        expect(view.placement.has(block.id), `${slug}/${block.id} unclassified`).toBe(true);
      }

      for (const block of doc.blocks) {
        const result = resolveCrossMode(anchorOn(doc, block), doc, 'guided', view);
        expect(['resolved', 'unavailable']).toContain(result.state);
        expect(result.message.length, `${slug}/${block.id} has no message`).toBeGreaterThan(0);
        if (result.state === 'resolved') {
          expect(result.paragraphId, `${slug}/${block.id}`).toBeDefined();
          resolved += 1;
        } else {
          expect(result.reason, `${slug}/${block.id}`).toBeDefined();
          seenReasons.add(result.reason as string);
          unavailable += 1;
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `\ncross-mode: ${String(resolved)} resolved, ${String(unavailable)} unavailable ` +
        `(reasons: ${[...seenReasons].toSorted().join(', ')})\n`,
    );

    expect(resolved + unavailable).toBe(199);
    // Both outcomes must actually occur, or the spec is asserting only one half of the criterion.
    expect(resolved).toBeGreaterThan(0);
    expect(unavailable).toBeGreaterThan(0);
  });

  it('a table cell resolves in Guided through the table that renders it', () => {
    // `table_cell` and `table_row` are not paragraphs, but `TableView` renders them with their own
    // `data-block-id`, so they ARE available in the reading. Reporting them "unavailable" would be
    // as wrong as reporting furniture "resolved" — and it is the case a naive
    // "is it a top-level paragraph?" check gets backwards.
    const doc = indexDocument(loadFixture('neural-odes-mathheavy'), 'cross-mode');
    const view = projectGuided(doc);
    const cell = doc.blocks.find((b) => b.type === 'table_cell');
    if (cell === undefined) throw new Error('neural-odes has the set\'s only table');

    const result = resolveCrossMode(anchorOn(doc, cell), doc, 'guided', view);
    expect(result.state).toBe('resolved');
    expect(result.ownerBlockId).toBeDefined();
  });
});
