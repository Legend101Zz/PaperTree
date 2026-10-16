/**
 * interpretation.spec — the model's words are marked as the model's, and an unsupported claim is
 * flagged, not deleted (EPIC-03: "a claim not supported by cited blocks is flagged, not silently
 * emitted"). Rewritten in S6 for `AnswerView` and `RichText`, and in #202 for the exchange
 * (call slip, AI slip with numbered markers, trace) that replaced `AnswerView`.
 *
 * THE ASSERTIONS COME IN PAIRS, because either half alone is satisfied by a wrong implementation:
 * a chip that is rendered AND says "not verified" (an emit-unchanged build has no word, a
 * filter-it-out build has no chip), a quote that is in the paper's register AND an answer that is in
 * the AI register AND the ⊙ appears on only one of them.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DERIVED_MARKER } from '@papertree/ui';

import { RichText } from '@/components/explain/RichText';
import type { ViewMessage } from '@/components/explain/useExplainActions';
import { Exchange } from '@/features/explain/components/Exchange';
import { buildExchanges, type Exchange as ExchangeModel } from '@/features/explain/model/exchange';
import type { Citation } from '@/lib/api/types';

import { anchorFixture, citation } from './s6-support';

afterEach(cleanup);
const noop = (): void => {};

function message(over: Partial<ViewMessage> = {}): ViewMessage {
  return {
    key: 'm1',
    role: 'assistant',
    text: 'The model uses eight heads [b1]. It therefore beats every later model [b2].',
    messageId: 'msg_1',
    runId: 'run_1',
    status: 'complete',
    stopped: false,
    label: null,
    failure: null,
    citations: [citation('b1') as Citation, citation('b2', { supported: false }) as Citation],
    usage: null,
    question: 'q',
    createdAt: null,
    coverage: null,
    generation: null,
    ...over,
  };
}

/** One exchange as the panel draws it: the ask, then this answer (#202). */
const view = (m: ViewMessage) => {
  const ask: ViewMessage = { ...m, key: 'u1', role: 'user', text: 'Explain this passage.' };
  const [exchange] = buildExchanges([ask, m], {
    anchor: anchorFixture('sel'),
    quote: 'We reframe detection.',
  });
  return render(
    <Exchange
      exchange={exchange as ExchangeModel<ViewMessage>}
      initial="M"
      onShow={noop}
      onRetry={noop}
      onSendToCanvas={async () => undefined}
    />,
  );
};

describe('an unsupported claim is flagged, not deleted', () => {
  it('keeps the claim on screen AND marks its marker and trace row "not verified" in words', () => {
    view(message());
    expect(screen.getByText(/It therefore beats every later model/)).toBeTruthy();
    const markers = document.querySelectorAll<HTMLElement>('[data-citation-id] button');
    expect(markers).toHaveLength(2);
    expect(markers[0]?.getAttribute('aria-label')).not.toContain('not verified');
    expect(markers[1]?.getAttribute('aria-label')).toContain('not verified');
    const rows = document.querySelectorAll<HTMLElement>('.pt-trace-row');
    expect(rows[1]?.textContent).toContain('not verified');
    expect(rows[0]?.textContent).not.toContain('not verified');
  });

  it('an unchecked citation (supported: null) is neither verified nor flagged', () => {
    view(
      message({
        citations: [citation('b1', { supported: null }) as Citation],
        text: 'Claim [b1].',
      }),
    );
    const marker = document.querySelector<HTMLElement>('[data-citation-id] button');
    expect(marker?.getAttribute('aria-label')).not.toContain('not verified');
    expect(document.body.textContent).not.toMatch(/not verified|\bverified\b/);
  });
});

describe('the voices stay apart', () => {
  it('the ask is yours, the quote the paper’s, the answer the AI’s; the interface sits outside', () => {
    view(message());
    const you = document.querySelector('[data-voice="you"]');
    const paper = document.querySelector('[data-voice="paper"]');
    const ai = document.querySelector('[data-voice="ai"]');
    expect(you?.textContent).toBe('Explain this passage.');
    expect(paper?.textContent).toContain('We reframe detection.');
    expect(ai?.textContent).toContain('eight heads');
    expect(ai?.contains(paper as Node)).toBe(false);
    expect(ai?.getAttribute('aria-label')).toMatch(/not the paper's words/);
    // The model's words never carry the paper's register, and the paper's never the AI's mark.
    expect(paper?.textContent).not.toContain(DERIVED_MARKER);
    // The status, error, usage and actions are the interface's own voice, outside the AI block.
    expect(ai?.contains(screen.getByRole('button', { name: 'Send to canvas' }))).toBe(false);
  });
});

describe('handles never reach the screen as text', () => {
  const cites = [citation('b1') as Citation];

  it('resolved handles become chips; an unknown handle is dropped', () => {
    render(<RichText text="One [b1] two [b9]." citations={cites} onCite={noop} />);
    expect(document.body.textContent).not.toMatch(/\[b\d+\]/);
    expect(document.querySelectorAll('[data-citation-id]')).toHaveLength(1);
    expect(document.body.textContent).toContain('One');
    expect(document.body.textContent).toContain('two');
  });

  it('while streaming, handles and a half-typed "[b" are hidden', () => {
    render(
      <RichText text="Streaming now [b1] and then [b" citations={[]} streaming onCite={noop} />,
    );
    expect(document.body.textContent).toContain('and then');
    expect(document.body.textContent).not.toMatch(/\[b/);
  });

  it('a citation the text never mentions is appended, not lost', () => {
    render(<RichText text="No handles here." citations={cites} onCite={noop} />);
    expect(document.querySelectorAll('[data-citation-id]')).toHaveLength(1);
  });

  it('a grouped handle [b1, b2] makes two chips; lists and bold render without raw markup', () => {
    render(
      <RichText
        text={'- **Grid** cells [b1, b2]\n- plain `code`'}
        citations={[citation('b1') as Citation, citation('b2') as Citation]}
        onCite={noop}
      />,
    );
    expect(document.querySelectorAll('li')).toHaveLength(2);
    expect(document.querySelector('strong')?.textContent).toBe('Grid');
    expect(document.querySelector('code')?.textContent).toBe('code');
    expect(document.querySelectorAll('[data-citation-id]')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('**');
  });

  it('a chip click reports its citation', () => {
    const onCite = vi.fn();
    render(<RichText text="X [b1]" citations={cites} onCite={onCite} />);
    fireEvent.click(document.querySelector('[data-citation-id]') as Element);
    expect(onCite).toHaveBeenCalledWith(cites[0]);
  });
});
