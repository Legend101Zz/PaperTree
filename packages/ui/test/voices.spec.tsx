/**
 * ui/voices.spec — the three voices, the numbered marker, the page tab and coverage (v0.2, #190).
 *
 * Behaviour, not snapshots: what a reader or a screen reader meets in the DOM, plus the stylesheet
 * as source (happy-dom applies no CSS) for the claim that the three voices look different in both
 * colour schemes.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AiText,
  CoverageReadout,
  NumberedMarker,
  PageTab,
  PaperText,
  ReflowedText,
  YouText,
  formatCoverage,
} from '../src/index.js';

afterEach(cleanup);

describe('voices carry data-voice', () => {
  it('marks paper, reflowed, ai and you', () => {
    const { container } = render(
      <>
        <PaperText>a</PaperText>
        <ReflowedText blockIds={['b']}>b</ReflowedText>
        <AiText>c</AiText>
        <YouText>d</YouText>
      </>,
    );
    const voices = [...container.querySelectorAll('[data-voice]')].map((n) =>
      n.getAttribute('data-voice'),
    );
    expect(voices).toEqual(['paper', 'paper', 'ai', 'you']);
  });

  it('YouText honours `as`', () => {
    const { container } = render(<YouText as="span">hi</YouText>);
    expect(container.querySelector('span[data-voice="you"]')).not.toBeNull();
  });
});

describe('NumberedMarker', () => {
  it('is a labelled button that flashes on click and Enter, once each', () => {
    const onFlash = vi.fn();
    render(<NumberedMarker n={2} label="p. 2 ¶2" onFlash={onFlash} />);
    const button = screen.getByRole('button', { name: 'Passage 2, p. 2 ¶2' });
    fireEvent.click(button);
    expect(onFlash).toHaveBeenCalledTimes(1);
    // Enter flashes once: the handler runs on keydown AND cancels the native Enter-click that
    // would follow in a browser. happy-dom sends no follow-up click, so "once" is proved by the
    // cancelled default: `fireEvent` returns false when `preventDefault` was called.
    const notCancelled = fireEvent.keyDown(button, { key: 'Enter' });
    expect(onFlash).toHaveBeenCalledTimes(2);
    expect(notCancelled, 'Enter must cancel the native click or it flashes twice').toBe(false);
    // Other keys do nothing (Space reaches `onFlash` through the native click on keyup).
    expect(fireEvent.keyDown(button, { key: 'a' })).toBe(true);
    expect(onFlash).toHaveBeenCalledTimes(2);
  });

  it('reports hover and focus in and out, and exposes the lit state', () => {
    const onLight = vi.fn();
    const { rerender } = render(
      <NumberedMarker n={1} label="p. 1" onFlash={() => undefined} onLight={onLight} />,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('data-lit')).toBeNull();
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    fireEvent.focus(button);
    fireEvent.blur(button);
    expect(onLight.mock.calls.map((c) => c[0])).toEqual([true, false, true, false]);

    rerender(<NumberedMarker n={1} label="p. 1" lit onFlash={() => undefined} />);
    // Lighting is a visual echo, never `aria-current` (it would be announced on every hover).
    expect(screen.getByRole('button').getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button').getAttribute('data-lit')).toBe('true');
  });

  it('says "not verified" in its accessible name when it is', () => {
    render(<NumberedMarker n={2} label="p. 2 ¶2" notVerified onFlash={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Passage 2, p. 2 ¶2, not verified' })).not.toBeNull();
  });

  it('has a touch size and a not-verified variant', () => {
    const { container } = render(
      <NumberedMarker n={1} label="p. 1" size="touch" notVerified onFlash={() => undefined} />,
    );
    expect(container.querySelector('.pt-marker--touch.pt-marker--not-verified')).not.toBeNull();
  });
});

describe('PageTab', () => {
  it('shows page and paragraph, or the page alone', () => {
    const { rerender } = render(<PageTab page={2} para={2} />);
    expect(screen.getByText('p. 2 ¶2')).not.toBeNull();
    rerender(<PageTab page={2} para={null} />);
    expect(screen.getByText('p. 2')).not.toBeNull();
  });

  it('says "not verified" in words for the dashed variant, and only then', () => {
    const { container, rerender } = render(<PageTab page={2} para={2} status="not-verified" />);
    expect(screen.getByText('not verified')).not.toBeNull();
    expect(container.querySelector('.pt-tab--not-verified')).not.toBeNull();
    rerender(<PageTab page={2} para={2} />);
    expect(screen.queryByText('not verified')).toBeNull();
  });
});

describe('CoverageReadout', () => {
  it('formats zero, one and many', () => {
    expect(formatCoverage({ passages: 4, citations: 11, uncitedParagraphs: 1 })).toBe(
      "Stands on 4 passages · 11 citations · 1 paragraph uncited (the AI's own reading)",
    );
    expect(formatCoverage({ passages: 1, citations: 1, uncitedParagraphs: 0 })).toBe(
      'Stands on 1 passage · 1 citation',
    );
    expect(formatCoverage({ passages: 0, citations: 0, uncitedParagraphs: 0 })).toBe(
      'Stands on no passages · 0 citations',
    );
    expect(formatCoverage({ passages: 2, citations: 3, uncitedParagraphs: 2 })).toContain(
      '2 paragraphs uncited',
    );
  });

  it('renders the sentence', () => {
    render(<CoverageReadout passages={1} citations={1} uncitedParagraphs={0} />);
    expect(screen.getByText('Stands on 1 passage · 1 citation')).not.toBeNull();
  });
});

// ─── the stylesheet: the voices look different in both schemes ────────────────────────────────
const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (match === null) throw new Error(`styles.css has no rule for ${selector}`);
  return match[1] ?? '';
}

function token(block: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

describe('styles.css — paper, AI and you differ in family and ground, in both schemes', () => {
  it('sets three different font families', () => {
    const families = [rule('.pt-paper-quote'), rule('.pt-ai'), rule('.pt-you')].map(
      (block) => /font(?:-family)?:[^;]*var\((--pt-font-[a-z]+)\)/.exec(block)?.[1],
    );
    // `.pt-ai` reads the v0.1 alias `--pt-font-derived`, which is `--pt-font-ai`.
    expect(families).toEqual(['--pt-font-paper', '--pt-font-derived', '--pt-font-you']);
    const root = rule(':root');
    const faces = ['--pt-font-paper', '--pt-font-ai', '--pt-font-you'].map((n) => token(root, n));
    expect(new Set(faces).size).toBe(3);
  });

  it('puts them on three different grounds in light and dark', () => {
    const light = rule(':root');
    const dark = rule(":root.dark,\n:root[data-pt-theme='dark']");
    for (const [scheme, block] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const grounds = ['--pt-page', '--pt-ai-slip', '--pt-call-slip'].map(
        (n) => token(block, n) ?? token(light, n),
      );
      expect(new Set(grounds).size, `${scheme} grounds ${grounds.join(' ')}`).toBe(3);
    }
  });
});
