/**
 * reader/a11y.spec — axe at WCAG 2.2 AA, full keyboard operation, and the AI-derived announcement.
 *
 * WHAT THIS ENVIRONMENT CAN AND CANNOT CHECK — READ BEFORE QUOTING "ZERO VIOLATIONS".
 *
 * happy-dom builds a DOM and computes the accessibility-relevant ATTRIBUTES faithfully. It does not
 * lay anything out, it loads no stylesheet, and Tailwind's classes have no definitions here. Two
 * families of axe rule therefore cannot run, and both are DISABLED EXPLICITLY below rather than
 * left to fail silently or, worse, to pass vacuously:
 *
 *   - `color-contrast` and `color-contrast-enhanced` (WCAG 1.4.3 / 1.4.6). axe resolves the
 *     computed foreground and background of a text node and needs a canvas to composite them. With
 *     no stylesheet every element here is black-on-transparent, so the rule would either error or
 *     "pass" on a colour scheme that does not exist. NOT COVERED BY THIS FILE.
 *   - `target-size` (WCAG 2.5.8, the 2.2 AA addition). Needs `getBoundingClientRect`, which returns
 *     zeros for everything in happy-dom. Covered instead — and only by declaration, not measurement
 *     — by `test/touch.spec.tsx`, which reads the `min-w-*`/`min-h-*` classes and inline styles.
 *
 * Anything else that depends on geometry is in the same position: `scrollable-region-focusable` and
 * `aria-hidden-focus` reason about visibility, and their verdicts here are weaker than a browser's.
 * The list of rules that actually ran is asserted below, so this claim can be checked rather than
 * believed. Real contrast and real target size need a browser; that is a visual-regression suite
 * this repo does not have, and pretending otherwise would be the exact failure this epic is about.
 */

import axe from 'axe-core';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DerivedBlock } from '@papertree/ui';

import { PaperGrid } from '@/components/library/PaperGrid';
import {
  EmptyLibrary,
  FailureState,
  OfflineState,
  PartialState,
  UncertaintyState,
} from '@/components/library/SystemStates';
import { CASES, PAPERS } from './library-cases';

afterEach(cleanup);

/** The tags the epic brief names, verbatim. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** See the header: these need a layout engine, so they are off HERE and not covered HERE. */
const RULES_REQUIRING_LAYOUT: axe.RuleObject = {
  'color-contrast': { enabled: false },
  'color-contrast-enhanced': { enabled: false },
  'target-size': { enabled: false },
};

async function analyse(container: HTMLElement): Promise<axe.AxeResults> {
  return axe.run(container, {
    runOnly: { type: 'tag', values: WCAG_TAGS },
    rules: RULES_REQUIRING_LAYOUT,
  });
}

function describeViolations(violations: readonly axe.Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes.map((node) => `      ${node.html.slice(0, 160)}`).join('\n');
      return `  [${violation.id}] ${violation.help} (${violation.impact ?? 'n/a'})\n${nodes}`;
    })
    .join('\n');
}

describe('axe: zero violations at WCAG 2.2 AA', () => {
  for (const testCase of CASES) {
    it(`${testCase.name} has no axe violations`, async () => {
      const { container } = render(testCase.element);
      testCase.afterRender?.(container);

      const results = await analyse(container);
      expect(
        results.violations,
        `${testCase.name}:\n${describeViolations(results.violations)}`,
      ).toEqual([]);
    });
  }

  it('the uncertainty disclosure is still clean once expanded', async () => {
    const { container } = render(
      <UncertaintyState
        blockId="blk_abc"
        pageIndex={3}
        confidence={0.42}
        cropSrc="/crop.png"
        cropAlt="Crop of the uncertain region on page 4"
        onReport={() => {}}
      >
        <p>Residual learning reformulates the layers as learning residual functions.</p>
      </UncertaintyState>,
    );
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    const results = await analyse(container);
    expect(results.violations, describeViolations(results.violations)).toEqual([]);
  });

  it('actually ran a meaningful set of rules (guards against a vacuous pass)', async () => {
    // A `runOnly` typo, or an axe that silently found nothing to evaluate, produces "zero
    // violations" too. This asserts the sweep had teeth.
    const { container } = render(<PaperGrid papers={PAPERS} onOpen={() => {}} onRetry={() => {}} />);
    const results = await analyse(container);

    const evaluated = new Set(
      [...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map(
        (result) => result.id,
      ),
    );
    for (const rule of ['button-name', 'aria-valid-attr-value', 'aria-required-attr', 'list']) {
      expect(evaluated.has(rule), `axe did not evaluate ${rule}`).toBe(true);
    }
    expect(results.passes.length).toBeGreaterThan(0);

    // And the two layout-bound rules really are absent from the run, so the header's claim about
    // what is NOT covered stays true if someone later re-enables them without a browser.
    expect(evaluated.has('color-contrast')).toBe(false);
    expect(evaluated.has('target-size')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// keyboard
// ────────────────────────────────────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
].join(', ');

/**
 * The elements a browser would put in the tab order, in the order it would put them.
 *
 * happy-dom implements `focus()` but NOT Tab traversal — pressing Tab moves nothing. So the tab
 * sequence is reconstructed the way the spec defines it (document order for `tabindex >= 0` and
 * natively-focusable elements, minus `-1`, `disabled`, `[hidden]` and `aria-hidden` subtrees) and
 * each member is then proved focusable for real. That is a genuine check of the two things that
 * actually break — an element being excluded from the sequence, or refusing focus — and it is not
 * a simulation of the browser's traversal algorithm. Stated plainly rather than dressed up as one.
 */
function tabSequence(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute('tabindex') === '-1') return false;
    if (element.hasAttribute('disabled')) return false;
    if (element.closest('[hidden]') !== null) return false;
    if (element.closest('[aria-hidden="true"]') !== null) return false;
    return true;
  });
}

describe('keyboard operation', () => {
  for (const testCase of CASES) {
    it(`${testCase.name}: every interactive element takes focus and accepts a key activation`, () => {
      const { container } = render(testCase.element);
      testCase.afterRender?.(container);

      const sequence = tabSequence(container);
      expect(sequence.length, `${testCase.name} rendered nothing focusable`).toBeGreaterThan(0);

      for (const element of sequence) {
        element.focus();
        expect(
          document.activeElement,
          `${testCase.name}: ${element.outerHTML.slice(0, 120)} refused focus`,
        ).toBe(element);

        // `detail === 0` is precisely the click a browser synthesises for Enter and Space on a
        // native control; every handler in this group is wired to accept it.
        expect(() => {
          fireEvent.click(element, { detail: 0 });
        }).not.toThrow();
      }
    });
  }

  it('Enter/Space on a card title opens the paper', () => {
    const onOpen = vi.fn();
    const { container } = render(<PaperGrid papers={PAPERS} onOpen={onOpen} onRetry={() => {}} />);
    const title = container.querySelector<HTMLButtonElement>('h3 button');
    expect(title).not.toBeNull();
    fireEvent.click(title as HTMLButtonElement, { detail: 0 });
    expect(onOpen).toHaveBeenCalledWith('p-pending');
  });

  it('Enter/Space on Retry resumes from the failed step, not from scratch', () => {
    const onRetryFrom = vi.fn();
    const { container } = render(
      <FailureState
        failedStep="equation crops"
        completedSteps={['page images', 'text layer']}
        onRetryFrom={onRetryFrom}
      />,
    );
    const retry = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Retry from'),
    );
    expect(retry).toBeDefined();
    fireEvent.click(retry as HTMLButtonElement, { detail: 0 });
    expect(onRetryFrom).toHaveBeenCalledWith('equation crops');
  });

  it('Enter/Space on a hatched page opens that page', () => {
    const onOpenPage = vi.fn();
    const { container } = render(
      <PartialState partialReason="Pages 12-14 were skipped." affectedPages={[11]} onOpenPage={onOpenPage} />,
    );
    const chip = container.querySelector<HTMLButtonElement>('[data-testid="partial-pages"] button');
    expect(chip).not.toBeNull();
    fireEvent.click(chip as HTMLButtonElement, { detail: 0 });
    expect(onOpenPage).toHaveBeenCalledWith(11);
  });

  it('Enter/Space adds the first paper from the empty library', () => {
    const onAddPaper = vi.fn();
    const { container } = render(<EmptyLibrary onAddPaper={onAddPaper} onOpenSample={() => {}} />);
    const add = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Add your first paper'),
    );
    expect(add).toBeDefined();
    fireEvent.click(add as HTMLButtonElement, { detail: 0 });
    expect(onAddPaper).toHaveBeenCalledTimes(1);
  });

  it('Enter/Space toggles the uncertainty disclosure and exposes its Report button', () => {
    const onReport = vi.fn();
    const { container } = render(
      <UncertaintyState
        blockId="blk_abc"
        pageIndex={3}
        confidence={0.42}
        cropSrc="/crop.png"
        cropAlt="Crop of the uncertain region on page 4"
        onReport={onReport}
      >
        <p>Residual learning.</p>
      </UncertaintyState>,
    );
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle as HTMLButtonElement, { detail: 0 });
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');

    const report = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('Report this region'),
    );
    expect(report).toBeDefined();
    fireEvent.click(report as HTMLButtonElement, { detail: 0 });
    expect(onReport).toHaveBeenCalledWith('blk_abc');
  });

  it('offline AI actions stay in the tab order so their reason is reachable', () => {
    // §19.8: "visibly disabled with the reason, not silently broken". A `disabled` attribute would
    // remove these from the tab sequence entirely, and a keyboard user would never meet the
    // explanation — they would just find three fewer controls than everyone else.
    const { container } = render(<OfflineState />);
    const gated = Array.from(container.querySelectorAll<HTMLElement>('[data-gated="true"]'));
    expect(gated.length).toBeGreaterThan(0);

    for (const element of gated) {
      expect(element.hasAttribute('disabled')).toBe(false);
      expect(element.getAttribute('aria-disabled')).toBe('true');

      const describedBy = element.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      const reason = container.querySelector(`#${CSS.escape(describedBy as string)}`);
      expect(reason?.textContent?.trim().length ?? 0).toBeGreaterThan(0);

      element.focus();
      expect(document.activeElement).toBe(element);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// AI-derived announcement
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every derived region announces itself.
 *
 * The visual register — the left rule, the reserved marker, the different ground — is invisible to
 * a screen reader. Without `role="note"` and a label that says AI-derived, a blind reader gets our
 * paraphrase of a paper in the same voice as the paper, which is `findings.md` §G ("AI output is
 * indistinguishable from source") reproduced exactly, for the users least able to notice.
 */
function assertDerivedRegionsAnnounced(root: HTMLElement, label: string): number {
  const regions = Array.from(root.querySelectorAll<HTMLElement>('[data-derived="true"]'));
  for (const region of regions) {
    expect(region.getAttribute('role'), `${label}: derived region without role="note"`).toBe('note');
    const ariaLabel = region.getAttribute('aria-label') ?? '';
    expect(
      ariaLabel,
      `${label}: derived region's aria-label does not say it is AI-derived (got "${ariaLabel}")`,
    ).toContain('AI-derived');
  }
  return regions.length;
}

describe('AI-derived regions are announced as AI-derived', () => {
  it('DerivedBlock carries role="note" and an AI-derived label', () => {
    const onShowSource = vi.fn();
    const { container } = render(
      <DerivedBlock derivedFrom={['blk_a', 'blk_b']} onShowSource={onShowSource}>
        Attention weights are averaged across heads.
      </DerivedBlock>,
    );
    expect(assertDerivedRegionsAnnounced(container, 'DerivedBlock')).toBe(1);
  });

  it('every derived region rendered by the library obeys the same rule', () => {
    // The library renders NONE today — it shows processing state and page crops, never a reading of
    // the paper. The sweep runs anyway so that the day one of these components starts wrapping a
    // summary, it is this test that notices rather than a reviewer.
    let seen = 0;
    for (const testCase of CASES) {
      const { container } = render(testCase.element);
      testCase.afterRender?.(container);
      seen += assertDerivedRegionsAnnounced(container, testCase.name);
      cleanup();
    }
    expect(seen).toBe(0);
  });
});
