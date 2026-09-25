/**
 * ui/registers.spec — the three text registers of ADR-002 §3.6, and the two ground tokens.
 *
 *   PaperText     the paper's own words (a quote in the explain panel, an excerpt card). No mark.
 *   ReflowedText  the paper's own words, re-laid out by Guided. The paper's register PLUS a
 *                 "Reflowed from the PDF" marker — it is verbatim text, so it must not wear ⊙.
 *   AiText        what a model wrote. The derived register and the reserved ⊙, and ONLY this.
 *
 * The brief: "UI distinguishes paper content from AI interpretation". So the assertions are about
 * DISTINGUISHABILITY, from both the DOM (what a screen reader and a test see) and the stylesheet
 * (what an eye sees — happy-dom applies no CSS, which is exactly how #42 shipped a register that
 * existed in the DOM and not on screen, so the CSS is asserted as source).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AiText,
  DERIVED_MARKER,
  PaperText,
  REFLOWED_LABEL,
  ReflowedText,
} from '../src/provenance.js';

afterEach(() => {
  cleanup();
});

const QUOTE = 'We present YOLO, a new approach to object detection.';

describe('PaperText — the paper register', () => {
  it('renders the words verbatim, with no marker and no AI announcement', () => {
    const { container } = render(<PaperText>{QUOTE}</PaperText>);
    const node = container.querySelector('[data-register="paper"]');

    expect(node).not.toBeNull();
    expect(node?.textContent).toBe(QUOTE);
    expect(container.innerHTML).not.toContain(DERIVED_MARKER);
    expect(container.innerHTML).not.toMatch(/AI/);
    expect(node?.className).toContain('pt-paper');
  });

  it('can be a blockquote with a page reference, which is the quote-in-a-panel case', () => {
    const { container } = render(
      <PaperText as="blockquote" pageLabel="p. 1">
        {QUOTE}
      </PaperText>,
    );
    const quote = container.querySelector('blockquote[data-register="paper"]');
    expect(quote).not.toBeNull();
    expect(quote?.querySelector('cite')?.textContent).toBe('p. 1');
    // The reference is attribution, not part of the quoted words.
    expect(quote?.querySelector('.pt-paper__text')?.textContent).toBe(QUOTE);
  });
});

describe('ReflowedText — the paper register, marked as re-laid-out', () => {
  it('says it is reflowed from the PDF, keeps the words verbatim, and carries no ⊙', () => {
    const { container } = render(<ReflowedText blockIds={['blk_a']}>{QUOTE}</ReflowedText>);
    const node = container.querySelector('[data-register="reflowed"]');

    expect(node).not.toBeNull();
    expect(node?.textContent).toContain(REFLOWED_LABEL);
    expect(REFLOWED_LABEL).toBe('Reflowed from the PDF');
    expect(node?.querySelector('.pt-reflowed__text')?.textContent).toBe(QUOTE);
    expect(node?.getAttribute('data-block-ids')).toBe('blk_a');
    expect(container.innerHTML).not.toContain(DERIVED_MARKER);
    // Paper register first: it inherits the paper class, and adds its own.
    expect(node?.className).toContain('pt-paper');
    expect(node?.className).toContain('pt-reflowed');
  });

  it('offers "show in PDF" only when it can act on it, and passes exactly its block ids', () => {
    const shown: (readonly string[])[] = [];
    const { getByRole, rerender, queryByRole } = render(
      <ReflowedText blockIds={['blk_a', 'blk_b']} onShowSource={(ids) => shown.push(ids)}>
        {QUOTE}
      </ReflowedText>,
    );
    fireEvent.click(getByRole('button', { name: /show in pdf/i }));
    expect(shown).toEqual([['blk_a', 'blk_b']]);

    rerender(<ReflowedText blockIds={['blk_a']}>{QUOTE}</ReflowedText>);
    // No inert affordance: a button that does nothing is worse than none.
    expect(queryByRole('button')).toBeNull();
  });
});

describe('AiText — the model register, the only one with ⊙', () => {
  it('carries the reserved marker and announces itself as AI-generated', () => {
    const { container } = render(<AiText model="MiniMax-M3">The block adds its input.</AiText>);
    const node = container.querySelector('[data-register="ai"]');

    expect(node).not.toBeNull();
    expect(node?.textContent).toContain(DERIVED_MARKER);
    expect(node?.getAttribute('role')).toBe('note');
    expect(node?.getAttribute('aria-label')).toMatch(/^AI-generated/);
    expect(node?.textContent).toContain('MiniMax-M3');
    expect(node?.querySelector('.pt-ai__body')?.textContent).toBe('The block adds its input.');
  });
});

describe('the registers are distinguishable', () => {
  it('paper, reflowed and AI text differ in register, class, and marker', () => {
    const { container } = render(
      <>
        <PaperText>{QUOTE}</PaperText>
        <ReflowedText blockIds={['blk_a']}>{QUOTE}</ReflowedText>
        <AiText>An interpretation.</AiText>
      </>,
    );
    const registers = [...container.querySelectorAll('[data-register]')].map((node) =>
      node.getAttribute('data-register'),
    );
    expect(registers).toEqual(['paper', 'reflowed', 'ai']);

    const withMarker = [...container.querySelectorAll('[data-register]')].filter((node) =>
      (node.textContent ?? '').includes(DERIVED_MARKER),
    );
    expect(withMarker.map((node) => node.getAttribute('data-register'))).toEqual(['ai']);
  });
});

// ─── the stylesheet ───────────────────────────────────────────────────────────────────────────

// A string to `fileURLToPath`, never `new URL(...)`: under happy-dom `URL` is the DOM's, which Node's
// `fileURLToPath` rejects ("The URL must be of scheme file").
const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

/** The declarations of the FIRST rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (match === null) throw new Error(`styles.css has no rule for ${selector}`);
  return match[1] ?? '';
}

/** The body of a block that CONTAINS nested rules (a media query), by its opening line. */
function nestedBlock(opening: string): string {
  const start = CSS.indexOf(opening);
  if (start < 0) throw new Error(`styles.css has no block opening with ${opening}`);
  let depth = 0;
  for (let at = CSS.indexOf('{', start); at < CSS.length; at += 1) {
    if (CSS[at] === '{') depth += 1;
    if (CSS[at] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(start, at + 1);
    }
  }
  throw new Error(`unbalanced block after ${opening}`);
}

describe('styles.css — the registers look different, in both themes', () => {
  it('sets the paper and AI registers in different families on different grounds', () => {
    expect(rule('.pt-paper')).toMatch(/font-family:\s*var\(--pt-font-body\)/);
    expect(rule('.pt-ai')).toMatch(/font-family:\s*var\(--pt-font-derived\)/);
    expect(rule('.pt-ai')).toMatch(/background:\s*var\(--pt-derived-ground\)/);
    expect(rule('.pt-ai')).toMatch(/border-inline-start:[^;]*var\(--pt-derived-rule\)/);
    expect(rule('.pt-paper')).not.toMatch(/--pt-derived/);
    expect(rule('.pt-reflowed__marker')).not.toMatch(/--pt-derived/);
  });

  it('defines --pt-page-ground and --pt-panel-ground in light, OS-dark and explicit dark', () => {
    // `ReaderWorkspace` paints `bg-[--pt-page-ground]` and `bg-[--pt-panel-ground]`. Both were
    // referenced and defined NOWHERE, so the reader's ground and the Navigator's panel were
    // transparent in every theme.
    const light = rule(':root');
    const osDark = nestedBlock('@media (prefers-color-scheme: dark)');
    const explicitDark = rule(":root.dark,\n:root[data-pt-theme='dark']");

    for (const [name, block] of [
      ['light :root', light],
      ['prefers-color-scheme: dark', osDark],
      ['explicit dark', explicitDark],
    ] as const) {
      expect(block, `${name} lacks --pt-page-ground`).toMatch(/--pt-page-ground:\s*[^;]+;/);
      expect(block, `${name} lacks --pt-panel-ground`).toMatch(/--pt-panel-ground:\s*[^;]+;/);
    }
    // Dark must actually be dark: not the light value copied into the dark block.
    const lightPage = /--pt-page-ground:\s*([^;]+);/.exec(light)?.[1];
    const darkPage = /--pt-page-ground:\s*([^;]+);/.exec(explicitDark)?.[1];
    expect(lightPage).toBeDefined();
    expect(darkPage).not.toBe(lightPage);
  });

  it('never writes the reserved marker into the stylesheet', () => {
    expect(CSS).not.toContain(DERIVED_MARKER);
  });
});
