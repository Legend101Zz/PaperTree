/**
 * S9-4: a STOPPED (cancelled, partial) answer is stored with an unterminated marker run and with
 * markers that never got a citation. None of it may reach the screen as raw `[b42, ...` text, and
 * none of it is drawn inline: the handles are gathered into the paragraph's source line (#340).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stripPartialTail } from '@/features/explain/model/answer';
import type { Citation } from '@/lib/api/types';

import { Answer } from './answer-render';

const cite = (n: number): Citation => ({
  citation_id: `cit_${String(n)}`,
  ordinal: n,
  marker: `b${String(n)}`,
  page_index: 0,
  anchor: { id: 'a', doc: { paperId: 'p' }, selectors: [] } as never,
});

const text = (content: string, citations: readonly Citation[] = []): string =>
  render(<Answer citations={citations} text={content} status="partial" />).container.textContent ??
  '';

describe('stopped answers never show raw citation markers', () => {
  it.each([
    ['unterminated run at the end', 'It names scattered fragments [b42, b43, b44, b46, b47, b48'],
    ['a bare open bracket', 'It names scattered fragments ['],
    ['half a handle', 'It names scattered fragments [b4'],
    ['a trailing comma', 'It names scattered fragments [b4, '],
  ])('hides %s', (_name, stored) => {
    const shown = text(stored);
    expect(shown).toBe('It names scattered fragments');
    expect(shown).not.toMatch(/\[|\bb\d/);
  });

  it('drops complete markers that have no citation', () => {
    const shown = text('First claim [b1]. Second claim [b2, b3].');
    expect(shown).toBe('First claim. Second claim.');
  });

  it('handles complete markers followed by an unterminated run', () => {
    const shown = text('First claim [b1]. Then more [b2, b3, b');
    expect(shown).toBe('First claim. Then more');
  });

  it('draws no chip or marker for a real citation, only its page, and hides the dangling run', () => {
    const { container } = render(
      <Answer citations={[cite(1)]} text={'Known claim [b1]. Cut off [b2, b'} status="partial" />,
    );
    expect(container.querySelector('.pt-chip, .pt-marker')).toBeNull();
    expect(container.querySelector('.pt-source')?.textContent).toBe('From the paper: p. 1');
    expect(container.textContent).not.toMatch(/\[b/);
  });

  it('does not eat ordinary brackets mid-text', () => {
    expect(text('The set [a, b] is closed.')).toBe('The set [a, b] is closed.');
  });
});

describe('stripPartialTail', () => {
  it('cuts an unfinished handle run and nothing else', () => {
    expect(stripPartialTail('Claim [b1]. More [b2, b')).toBe('Claim [b1]. More');
    expect(stripPartialTail('Done [b1].')).toBe('Done [b1].');
  });
});
