/**
 * interpretation.spec — the model's words are marked as the model's, and the answer is a tutor, not
 * an auditor (#340, #341): no verdict, chip, marker, readout or margin flag, only one quiet source
 * line under a paragraph ("From the paper: p. 4" or "General knowledge"). Rewritten in S6 for
 * `AnswerView`, in #202 for the exchange and in #340 for the source line.
 *
 * THE ASSERTIONS COME IN PAIRS, because either half alone is satisfied by a wrong implementation:
 * a quote that is in the paper's register AND an answer that is in the AI register AND the ⊙
 * appears on only one of them.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DERIVED_MARKER } from '@papertree/ui';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import { Exchange } from '@/features/explain/components/Exchange';
import { buildExchanges, type Exchange as ExchangeModel } from '@/features/explain/model/exchange';
import type { Citation } from '@/lib/api/types';

import { Answer } from './answer-render';
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
    citations: [citation('b1') as Citation, citation('b2') as Citation],
    usage: null,
    question: 'q',
    createdAt: null,
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
      onStop={noop}
      onRetry={noop}
      onSendToCanvas={async () => undefined}
    />,
  );
};

describe('an answer is a tutor, not an auditor (#340, #341)', () => {
  it('keeps every claim on screen with no verdict, chip, marker, readout or margin flag', () => {
    view(message());
    expect(screen.getByText(/It therefore beats every later model/)).toBeTruthy();
    for (const gone of [
      '.pt-chip',
      '.pt-marker',
      '.pt-ai-slip .pt-tab',
      '.pt-trace-list',
      '.pt-trace-row',
      '.pt-coverage',
      '.pt-ai-slip__aside',
      '.pt-ai-slip__uncited',
      '[data-citation-id]',
    ]) {
      expect(document.querySelector(gone), gone).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(
      /Stands on|not verified|\bverified\b|grounded|not found in the paper|own reading/i,
    );
    // The sources are one quiet line: the page both handles name, once.
    const lines = [...document.querySelectorAll('.pt-source')].map((l) => l.textContent);
    expect(lines).toEqual(['From the paper: p. 4']);
  });

  it('a paragraph with no handle says "General knowledge" in the same quiet line', () => {
    view(message({ text: 'Claim [b1].\n\nAnd something the AI knows.' }));
    const lines = [...document.querySelectorAll('.pt-source')].map((l) => l.textContent);
    expect(lines).toEqual(['From the paper: p. 4', 'General knowledge']);
    expect(document.querySelector('.pt-source--general')?.getAttribute('role')).toBeNull();
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
    expect(ai?.contains(screen.getByRole('button', { name: 'Send to board' }))).toBe(false);
  });
});

describe('handles never reach the screen as text', () => {
  const cites = [citation('b1') as Citation];

  it('a resolved handle becomes a page link; an unknown handle is dropped', () => {
    render(<Answer text="One [b1] two [b9]." citations={cites} />);
    expect(document.body.textContent).not.toMatch(/\[b\d+\]/);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.body.textContent).toContain('One');
    expect(document.body.textContent).toContain('two');
  });

  it('while streaming, handles and a half-typed "[b" are hidden', () => {
    render(<Answer text="Streaming now [b1] and then [b" citations={[]} status="streaming" />);
    expect(document.body.textContent).toContain('and then');
    expect(document.body.textContent).not.toMatch(/\[b/);
  });

  it('a citation the text never mentions is not a source of the paragraph', () => {
    render(<Answer text="No handles here." citations={cites} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a grouped handle [b1, b2] on one page is one page; lists and bold render without raw markup', () => {
    render(
      <Answer
        text={'- **Grid** cells [b1, b2]\n- plain `code`'}
        citations={[citation('b1') as Citation, citation('b2') as Citation]}
      />,
    );
    expect(document.querySelectorAll('li')).toHaveLength(2);
    expect(document.querySelector('strong')?.textContent).toBe('Grid');
    expect(document.querySelector('code')?.textContent).toBe('code');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('**');
  });

  it('a page click reports its citation', () => {
    const onShow = vi.fn();
    render(<Answer text="X [b1]" citations={cites} onShow={onShow} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show p. 4 in the paper' }));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow.mock.calls[0]?.[0].citation).toBe(cites[0]);
  });
});
