/**
 * qa/interpretation.spec — "A claim not supported by cited blocks is flagged, not silently
 * emitted." (EPIC-03-grounded-ai.md, acceptance criteria.)
 *
 * THE THREE OUTCOMES, AND WHY THE TEST HAS TO DISTINGUISH ALL THREE
 *
 * The epic's rule has two halves that pull in opposite directions: *"unsupported claims are
 * FLAGGED, not deleted"* and *"not silently emitted"*. An implementation can satisfy either one
 * alone trivially, and both of the trivial satisfactions are wrong:
 *
 *   * emit the claim unchanged  -> satisfies "not deleted", violates "not silently emitted"
 *   * filter the claim out      -> satisfies "not silently emitted", violates "not deleted"
 *
 * So the assertions below always come in pairs: the claim's text IS in the document, AND it is
 * marked. Testing only the mark would pass against an implementation that renders the flag next to
 * a dropped claim; testing only the text would pass against one that emits it bare. This is the
 * same shape as AGENTS.md §2's "a green test may assert less than it appears to", and it is the
 * reason this file is longer than it looks like it needs to be.
 *
 * SEPARATION OF REGISTERS is the second criterion here. The epic's hard rule is that
 * "interpretation is separated from what the paper states — in the schema *and* in the UI". The
 * schema half is `types.ts` (two fields, not one). This file is the UI half.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnswerView } from '../src/components/inspector/AnswerView';
import type { Citation, GroundedAnswer } from '../src/components/inspector/types';

afterEach(() => {
  cleanup();
});

const noop = (): void => {};

/** A citation that resolved, so the chip renders enabled and the test is not about orphans. */
function citation(label: string, blockId: string): Citation {
  return {
    label,
    targetType: 'text',
    anchor: {
      anchorVersion: 1,
      offsetUnit: 'unicode',
      id: `anchor-${label}`,
      doc: { paperId: 'ppr_x', pdfSha256: '', parserVersion: 'v1', textStreamId: 't' },
      targetKind: 'citation',
      provenanceClass: 'ai_generated',
      selectors: [],
      created: { mode: 'source', at: '1970-01-01T00:00:00.000Z', client: 'test' },
    },
    resolution: {
      tier: 1,
      score: 1,
      state: 'anchored',
      blockIds: [blockId],
      polygons: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      ],
      quads: [[0, 0, 10, 10]],
      pageIndex: 3,
      approximate: false,
    },
  } as Citation;
}

const SUPPORTED = 'The model uses eight parallel attention heads.';
const UNSUPPORTED = 'The model therefore outperforms every subsequent architecture.';

function answerWithOneUnsupportedClaim(): GroundedAnswer {
  return {
    states: SUPPORTED,
    interpretation: 'Read practically, the head count is a width knob rather than a depth knob.',
    supportingBlockIds: ['blk_aaaaaaaaaaaaaaaa'],
    sourcePages: [3],
    sourceRegions: [citation('1', 'blk_aaaaaaaaaaaaaaaa')],
    confidence: 0.62,
    unresolvedAmbiguities: ['Whether "heads" refers to encoder or decoder attention here.'],
    claims: [
      { text: SUPPORTED, supportedBy: ['blk_aaaaaaaaaaaaaaaa'], supported: true, reason: null },
      {
        text: UNSUPPORTED,
        supportedBy: [],
        supported: false,
        reason: 'No cited block mentions a comparison with later architectures.',
      },
    ],
  };
}

describe('qa/interpretation.spec — an unsupported claim is flagged, not deleted', () => {
  it('renders the unsupported claim AND marks it — both halves, because either alone is wrong', () => {
    render(
      <AnswerView answer={answerWithOneUnsupportedClaim()} onNavigate={noop} onShowSource={noop} />,
    );

    // Half one: NOT DELETED. The text is on screen.
    const claim = screen.getByText(UNSUPPORTED);
    expect(claim, 'the unsupported claim must still be rendered — flagged, not deleted').not.toBeNull();

    // Half two: NOT SILENTLY EMITTED. It carries the machine-readable mark...
    const marked = claim.closest('[data-grounded="false"]');
    expect(marked, 'the unsupported claim must be marked as ungrounded').not.toBeNull();

    // ...and the reason is shown to the reader rather than swallowed into a log.
    expect(
      screen.getByText('No cited block mentions a comparison with later architectures.'),
    ).not.toBeNull();
  });

  it('announces the flag to a screen reader, not only to a stylesheet', () => {
    render(
      <AnswerView answer={answerWithOneUnsupportedClaim()} onNavigate={noop} onShowSource={noop} />,
    );

    // A colour is not an announcement. `reader/a11y.spec` treats visual-only state as a real
    // failure, and "this sentence is not supported by its sources" is the least decorative piece
    // of state in the product.
    const region = screen.getByRole('note', {
      name: /1 claim not supported by the cited sources/i,
    });
    expect(region).not.toBeNull();
  });

  it('a fully supported answer renders no flag region at all — the non-vacuity control', () => {
    // Without this, every assertion above would also pass against a component that renders the
    // flag unconditionally.
    const answer = answerWithOneUnsupportedClaim();
    const allSupported: GroundedAnswer = {
      ...answer,
      claims: answer.claims.map((claim) => ({ ...claim, supported: true, reason: null })),
    };

    render(<AnswerView answer={allSupported} onNavigate={noop} onShowSource={noop} />);

    expect(screen.queryByRole('note', { name: /not supported by the cited sources/i })).toBeNull();
    expect(document.querySelector('[data-grounded="false"]')).toBeNull();
  });

  it('keeps interpretation in a different region from what the paper states', () => {
    render(
      <AnswerView answer={answerWithOneUnsupportedClaim()} onNavigate={noop} onShowSource={noop} />,
    );

    const states = document.querySelector('[data-answer-states]');
    const interpretation = document.querySelector('[data-answer-interpretation]');
    expect(states).not.toBeNull();
    expect(interpretation).not.toBeNull();

    // The load-bearing assertion: they are not the same node, and neither contains the other. A
    // single field rendered as two paragraphs would pass a "both strings are present" check and
    // fail this one.
    expect(states).not.toBe(interpretation);
    expect(states?.contains(interpretation ?? null)).toBe(false);
    expect(interpretation?.contains(states ?? null)).toBe(false);
  });

  it('omits the interpretation region entirely when there is no interpretation', () => {
    // An extractive answer has none, and inventing a paragraph to fill the slot is exactly the
    // failure the separation exists to prevent.
    const answer = { ...answerWithOneUnsupportedClaim(), interpretation: null };
    render(<AnswerView answer={answer} onNavigate={noop} onShowSource={noop} />);

    expect(document.querySelector('[data-answer-states]')).not.toBeNull();
    expect(document.querySelector('[data-answer-interpretation]')).toBeNull();
  });

  it('refuses to render an answer that cannot name a source block', () => {
    // `DerivedBlock` throws on an empty `derivedFrom`. Relied upon rather than guarded around:
    // ungrounded derived content must not reach the screen at all (DESIGN.md §11.4).
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ungrounded: GroundedAnswer = {
      ...answerWithOneUnsupportedClaim(),
      supportingBlockIds: [],
    };

    expect(() =>
      render(<AnswerView answer={ungrounded} onNavigate={noop} onShowSource={noop} />),
    ).toThrow(/derived_from/i);

    spy.mockRestore();
  });
});
