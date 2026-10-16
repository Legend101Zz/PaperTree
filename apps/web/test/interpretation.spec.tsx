/**
 * interpretation.spec — the model's words are marked as the model's, and an unsupported claim is
 * flagged, not deleted (EPIC-03: "a claim not supported by cited blocks is flagged, not silently
 * emitted"). Rewritten in S6 for the explain panel's `AnswerView` and `RichText`.
 *
 * THE ASSERTIONS COME IN PAIRS, because either half alone is satisfied by a wrong implementation:
 * a chip that is rendered AND says "not verified" (an emit-unchanged build has no word, a
 * filter-it-out build has no chip), a quote that is in the paper's register AND an answer that is in
 * the AI register AND the ⊙ appears on only one of them.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DERIVED_MARKER, PaperText } from '@papertree/ui';

import { AnswerView } from '@/components/explain/AnswerView';
import { RichText } from '@/components/explain/RichText';
import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { Citation } from '@/lib/api/types';

import { citation } from './s6-support';

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
    ...over,
  };
}

const view = (m: ViewMessage) =>
  render(
    <AnswerView message={m} onCite={noop} onRetry={noop} onSendToCanvas={async () => undefined} />,
  );

describe('an unsupported claim is flagged, not deleted', () => {
  it('keeps the claim on screen AND marks its chip "not verified" in words', () => {
    view(message());
    expect(screen.getByText(/It therefore beats every later model/)).toBeTruthy();
    const chips = document.querySelectorAll<HTMLElement>('[data-citation-id]');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.getAttribute('data-supported')).toBe('true');
    expect(chips[1]?.getAttribute('data-supported')).toBe('false');
    expect(chips[1]?.textContent).toContain('not verified');
    expect(chips[1]?.getAttribute('aria-label')).toContain('not verified');
    expect(chips[0]?.textContent).not.toContain('not verified');
  });

  it('an unchecked citation (supported: null) is neither verified nor flagged', () => {
    view(
      message({
        citations: [citation('b1', { supported: null }) as Citation],
        text: 'Claim [b1].',
      }),
    );
    const chip = document.querySelector<HTMLElement>('[data-citation-id]');
    expect(chip?.getAttribute('data-supported')).toBe('unknown');
    expect(chip?.textContent).not.toContain('not verified');
  });
});

describe('the registers stay apart', () => {
  it('the paper is PaperText with no marker; the model is AiText with the marker and the label', () => {
    render(
      <>
        <PaperText as="blockquote">We reframe detection.</PaperText>
        <AnswerView
          message={message()}
          onCite={noop}
          onRetry={noop}
          onSendToCanvas={async () => undefined}
        />
      </>,
    );
    const paper = document.querySelector('[data-register="paper"]');
    const ai = document.querySelector('[data-register="ai"]');
    expect(paper?.textContent).not.toContain(DERIVED_MARKER);
    expect(ai?.textContent).toContain(DERIVED_MARKER);
    expect(within(ai as HTMLElement).getByText('AI interpretation')).toBeTruthy();
    expect(ai?.getAttribute('aria-label')).toMatch(/AI-generated/);
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
