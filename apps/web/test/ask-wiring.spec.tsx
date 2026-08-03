/**
 * inspector/ask-wiring.spec — the Inspector talks to a real endpoint, and refuses honestly (#76).
 *
 * WHAT `qa/interpretation.spec` DOES NOT COVER, SAID HERE BECAUSE IT IS OFTEN ASSUMED IT DOES
 *
 * It is repeatedly claimed that `interpretation.spec` "measures against the fixture answer source".
 * It does not. `git grep createFixtureAnswerSource` returns three hits and all three are source
 * files; that spec builds `GroundedAnswer` objects BY HAND and exercises `AnswerView` alone. So it
 * passes unchanged whatever happens to the wiring, and it is NOT a regression test for this swap.
 * This file is. Three things it asserts that nothing else does:
 *
 *   1. `createLiveAnswerSource` POSTs to `/papers/{id}/ask` with the seed block ids, and turns the
 *      wire ADDRESSES back into anchored `Citation`s against the parse on screen.
 *   2. `onPartial` is called before the promise resolves — `types.ts`'s stated obligation, which
 *      an implementation can silently skip and nothing else would notice.
 *   3. An answer with an empty `supportingBlockIds` reaches a DESIGNED failure state instead of
 *      the `DerivedBlock` throw, and the throw is confirmed to still be there. Both halves: a
 *      guard around a throw that no longer throws is a guard nobody can trust.
 *
 * The document is the committed `resnet-cvpr-2col` fixture, indexed by the real `indexDocument`,
 * so the anchors these tests mint are minted against a real parse. `fetch` is the only stub.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type PaperSource } from '@papertree/anchoring';

import { Inspector, isRenderable } from '@/components/inspector';
import { AnswerView } from '@/components/inspector/AnswerView';
import { createLiveAnswerSource } from '@/components/inspector/liveAnswerSource';
import type { GroundedAnswer } from '@/components/inspector/types';

const FIXTURE = join(
  process.cwd(),
  '../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json',
);
const paper = JSON.parse(readFileSync(FIXTURE, 'utf8')) as PaperSource & { ir_version?: string };
const doc = indexDocument(paper, `fixture/${paper.ir_version ?? 'unknown'}`);

const noop = (): void => {};

/** A real block out of the real parse. Never an id this file made up. */
function realBlock() {
  const block = doc.blocks.find((candidate) => candidate.type === 'paragraph');
  if (block === undefined) throw new Error('the fixture has no paragraph; this file is vacuous');
  return block;
}

/** The wire shape `services/api` returns: camelCase, and `sourceRegions` as ADDRESSES. */
function wireResponse(blockId: string, overrides: Record<string, unknown> = {}) {
  const block = doc.byId.get(blockId);
  return {
    answer: {
      states: 'Deep networks are more difficult to train.',
      interpretation: null,
      supportingBlockIds: [blockId],
      sourcePages: [block?.pageIndex ?? 0],
      sourceRegions: [
        {
          blockId,
          pageIndex: block?.pageIndex ?? 0,
          bbox: block?.bbox ?? [0, 0, 1, 1],
          targetType: 'text',
          label: 'p1 · paragraph',
        },
      ],
      confidence: 0.8,
      unresolvedAmbiguities: [],
      claims: [
        { text: 'deep networks are hard to train', supportedBy: [blockId], supported: true, reason: null },
      ],
      ...overrides,
    },
    meta: {
      model: 'MiniMax-M3',
      steps: 2,
      inputTokens: 1700,
      outputTokens: 60,
      toolCalls: [{ tool: 'get_block', status: 'ok' }],
      evidenceBlockIds: [blockId],
      systemPromptHash: 'sha256:deadbeef',
    },
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respondWith(payload: unknown, status = 200): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'stubbed',
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  });
}

describe('inspector/ask-wiring.spec — the live answer source (#76)', () => {
  it('the fixture is real, so nothing below is measuring a stub', () => {
    expect(doc.blocks.length).toBeGreaterThan(50);
    expect(doc.byId.size).toBe(doc.blocks.length);
  });

  it('POSTs the question and the seed block ids to /papers/{id}/ask', async () => {
    const block = realBlock();
    respondWith(wireResponse(block.id));
    const source = createLiveAnswerSource({ doc, at: () => '1970-01-01T00:00:00.000Z' });

    await source.ask(
      {
        question: 'Explain this selection',
        context: { kind: 'selection', blockIds: [block.id], quote: 'x' },
        paperId: 'ppr_live',
      },
      noop,
      new AbortController().signal,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/papers/ppr_live/ask');
    expect(init.method).toBe('POST');
    // snake_case on the wire: it is the SERVER's field name. `ask.py`'s `Ask` model declares it.
    expect(JSON.parse(String(init.body))).toEqual({
      question: 'Explain this selection',
      block_ids: [block.id],
    });
  });

  it('mints an anchored Citation from the wire address, against the parse on screen', async () => {
    const block = realBlock();
    respondWith(wireResponse(block.id));
    const source = createLiveAnswerSource({ doc, at: () => '1970-01-01T00:00:00.000Z' });

    const answer = await source.ask(
      {
        question: 'q',
        context: { kind: 'selection', blockIds: [block.id], quote: 'x' },
        paperId: 'ppr_live',
      },
      noop,
      new AbortController().signal,
    );

    // THE POINT OF THE CONVERSION. The server sent an address; what came back is an `Anchor` with
    // selectors and a `Resolution` — neither of which crossed the wire, because Python cannot mint
    // them (#72: a bare block_id survives a re-parse 3.3 % of the time, an Anchor 100 %).
    expect(answer.sourceRegions).toHaveLength(1);
    const citation = answer.sourceRegions[0]!;
    expect(citation.anchor.selectors.length).toBeGreaterThan(0);
    expect(citation.anchor.provenanceClass).toBe('ai_generated');
    expect(citation.resolution.state).not.toBe('orphan');
    expect(citation.resolution.blockIds).toContain(block.id);
    expect(citation.label).toBe('p1 · paragraph');
  });

  it('calls onPartial before it resolves, which types.ts requires and nothing else checks', async () => {
    const block = realBlock();
    respondWith(wireResponse(block.id));
    const order: string[] = [];
    const source = createLiveAnswerSource({ doc, at: () => '1970-01-01T00:00:00.000Z' });

    await source
      .ask(
        {
          question: 'q',
          context: { kind: 'selection', blockIds: [block.id], quote: 'x' },
          paperId: 'ppr_live',
        },
        (text) => order.push(`partial:${text.slice(0, 10)}`),
        new AbortController().signal,
      )
      .then(() => order.push('resolved'));

    expect(order).toEqual(['partial:Deep netwo', 'resolved']);
  });

  it('drops a citation to a block that is not in THIS parse rather than crashing the panel', async () => {
    const block = realBlock();
    const payload = wireResponse(block.id);
    payload.answer.sourceRegions.push({
      blockId: 'blk_from_a_stale_generation',
      pageIndex: 0,
      bbox: [0, 0, 1, 1],
      targetType: 'text',
      label: 'p1 · paragraph',
    });
    respondWith(payload);

    const answer = await createLiveAnswerSource({ doc, at: () => 'x' }).ask(
      {
        question: 'q',
        context: { kind: 'selection', blockIds: [block.id], quote: 'x' },
        paperId: 'ppr_live',
      },
      noop,
      new AbortController().signal,
    );

    // The chip is gone; the CLAIM is not. `captureAnchor` throws for a block it cannot find, and
    // one stale id must not take the whole answer down with it.
    expect(answer.sourceRegions).toHaveLength(1);
    expect(answer.claims).toHaveLength(1);
  });

  it('is the source ReaderWorkspace gives the Inspector for an API paper', () => {
    /*
     * A SOURCE-TEXT ASSERTION, and the reason it is one rather than a render.
     *
     * The swap is one expression inside `ReaderWorkspaceView`, and reaching it in a test means
     * mounting pdf.js, the Navigator, the overlay and a real PDF — a fixture larger than the
     * behaviour, in an environment (happy-dom) that does no layout. Every OTHER link in this chain
     * is covered by a real test: `createLiveAnswerSource` above, `Inspector`/`AnswerView` below,
     * the citation click in `citation-scroll.spec`. What is left uncovered by all of them is
     * exactly one decision — WHICH source gets constructed — and a reverted swap is invisible to
     * every one of them, because the fixture source satisfies the same interface and the panel
     * keeps working. That is #58/#59's defect shape: built, tested, and reached by nothing.
     *
     * `reachable.spec` does not catch it either: `liveAnswerSource.ts` is exported from the
     * inspector barrel, so it stays in the import graph whether or not anything constructs it.
     *
     * So this reads the file, as `reachable.spec` reads the import graph and
     * `test_runtime_swappable.py` reads `services/**` for provider constants. Crude, and it fails
     * the moment the swap is undone.
     */
    const source = readFileSync(
      join(process.cwd(), 'src/app/paper/[id]/read/ReaderWorkspace.tsx'),
      'utf8',
    );
    expect(source).toContain('createLiveAnswerSource');
    expect(source).toMatch(/paper\.kind === 'api'\s*\n?\s*\?\s*createLiveAnswerSource/);
    // The real `paper_id`, not `paperRefKey`'s `api:ppr_…` cache key, which would 404 every ask.
    expect(source).toContain("paperId={paper.kind === 'api' ? paper.paperId : paperRefKey(paper)}");
    // The fixture path SURVIVES: it is the offline path, not a fallback to be cleaned up.
    expect(source).toContain('createFixtureAnswerSource');
  });

  it("surfaces the server's refusal verbatim instead of degrading to a made-up answer", async () => {
    respondWith('no model credential is configured: set PAPERTREE_LLM_API_KEY', 503);
    const block = realBlock();

    await expect(
      createLiveAnswerSource({ doc }).ask(
        {
          question: 'q',
          context: { kind: 'selection', blockIds: [block.id], quote: 'x' },
          paperId: 'ppr_live',
        },
        noop,
        new AbortController().signal,
      ),
    ).rejects.toThrow('PAPERTREE_LLM_API_KEY');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The empty-`derivedFrom` designed failure state.
 *
 * `provenance.tsx:81` throws on an empty `derivedFrom` and `AnswerView` uses `DerivedBlock` on the
 * answer render path. A live agent will eventually produce an answer citing nothing. THE THROW IS
 * CORRECT — an ungrounded answer must not render at all — so it is not guarded away with `?? []`,
 * `|| []`, or a try/catch that renders anyway. It is CONVERTED into a state that was designed.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

const UNGROUNDED: GroundedAnswer = {
  states: 'The paper says something.',
  interpretation: null,
  supportingBlockIds: [],
  sourcePages: [],
  sourceRegions: [],
  confidence: 0.5,
  unresolvedAmbiguities: [],
  claims: [{ text: 'something', supportedBy: [], supported: false, reason: 'nothing cited' }],
};

describe('inspector/ask-wiring.spec — an answer that cites nothing (§11.4, §19.8)', () => {
  it('AnswerView still THROWS for it — the guard is protecting a live throw, not a dead one', () => {
    // If this ever stops throwing, the check in `Inspector` becomes decorative and the next
    // refactor deletes it. Asserted first, deliberately, so the order of these two tests reads as
    // the argument they make together.
    expect(() =>
      render(<AnswerView answer={UNGROUNDED} onNavigate={noop} onShowSource={noop} />),
    ).toThrow(/at least one derived_from block id/);
  });

  it('the Inspector shows a designed state naming the reason, not a blank panel or a crash', () => {
    render(
      <Inspector
        context={{ kind: 'answer', answer: UNGROUNDED }}
        answerSource={{ ask: async () => UNGROUNDED }}
        paperId="ppr_live"
        onNavigate={noop}
        onShowSource={noop}
      />,
    );

    const alert = screen.getByRole('alert');
    // `hasAttribute` rather than `toHaveAttribute`: `@testing-library/jest-dom` is not a
    // dependency of this app and adding one for a matcher would move the lockfile.
    expect(alert.hasAttribute('data-inspector-ungrounded')).toBe(true);
    expect(alert.textContent).toContain('named no source block');
    // NOT a blank panel: the reader is told why, in the answer's own slot.
    expect(alert.textContent).toContain('must not render');
    // And the answer body is genuinely absent rather than rendered unattributed.
    expect(document.querySelector('[data-answer-states]')).toBeNull();
    expect(document.querySelector('[data-derived]')).toBeNull();
  });

  it('a grounded answer still renders, so the guard is not simply refusing everything', async () => {
    const block = realBlock();
    respondWith(wireResponse(block.id));
    const answer = await createLiveAnswerSource({ doc, at: () => 'x' }).ask(
      {
        question: 'q',
        context: { kind: 'selection', blockIds: [block.id], quote: 'x' },
        paperId: 'ppr_live',
      },
      noop,
      new AbortController().signal,
    );

    expect(isRenderable(answer)).toBe(true);
    render(
      <Inspector
        context={{ kind: 'answer', answer }}
        answerSource={{ ask: async () => answer }}
        paperId="ppr_live"
        onNavigate={noop}
        onShowSource={noop}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-answer-states]')).not.toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
