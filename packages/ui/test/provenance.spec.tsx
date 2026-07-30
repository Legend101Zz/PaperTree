/**
 * reader/provenance.spec — "No Guided block renders without a visible derived marker and a working
 * source link." (EPIC-02-reader.md, acceptance criteria.)
 *
 * THIS FILE IS THE ENFORCEMENT HALF OF `DESIGN.md` §11.4. The schema tolerates arbitrary strings in
 * `EquationPayload.latex` and `TablePayload.html` on the stated condition that the UI renders them
 * in the "our reading" register — "this holds **only if the UI actually does that**". Everything
 * below is a check that it still does, written so that each failure names which of the four
 * obligations was dropped rather than just "snapshot differs".
 *
 * The inversions being guarded against are all cheap and all tempting:
 *   - render derived content with no `derived_from`, because the caller did not have one handy;
 *   - typeset the LaTeX big and put the crop underneath, because typeset LaTeX looks better;
 *   - render a `DerivedBlock` around an equation that has no transcription, because the wrapper is
 *     where the styling lives;
 *   - `dangerouslySetInnerHTML={{ __html: payload.html }}`, because the payload is already HTML.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DERIVED_MARKER,
  DerivedBlock,
  EquationView,
  FigureView,
  TableView,
} from '../src/provenance.js';
import { IconButton, Panel, SegmentedControl, Sheet, Tabs } from '../src/primitives.js';

afterEach(() => {
  cleanup();
});

const noop = (): void => {};

describe('DerivedBlock — obligation 3: derived_from is not optional', () => {
  it('throws rather than rendering when derivedFrom is empty', () => {
    // React logs the thrown error before rethrowing; silence it so a PASSING run is quiet and a
    // failing one is readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(noop);
    try {
      expect(() =>
        render(
          <DerivedBlock derivedFrom={[]} onShowSource={noop}>
            unattributed
          </DerivedBlock>,
        ),
      ).toThrow(/at least one derived_from block id/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders when given ids, and publishes them as data-derived-from', () => {
    const { container } = render(
      <DerivedBlock derivedFrom={['blk_a', 'blk_b']} onShowSource={noop}>
        our reading
      </DerivedBlock>,
    );

    const derived = container.querySelector('[data-derived="true"]');
    expect(derived).not.toBeNull();
    expect(derived?.getAttribute('data-derived-from')).toBe('blk_a blk_b');
  });
});

describe('DerivedBlock — obligations 2 and 4: the marker and a working show-source', () => {
  it('contains the reserved marker', () => {
    const { container } = render(
      <DerivedBlock derivedFrom={['blk_a']} onShowSource={noop}>
        our reading
      </DerivedBlock>,
    );
    expect(container.textContent).toContain(DERIVED_MARKER);
  });

  it('announces itself as AI-derived to assistive technology, not only visually', () => {
    // The left rule and the ⊙ are both invisible to a screen reader; `reader/a11y.spec` requires
    // "every AI-derived region is announced as AI-derived", so the role and name carry it too.
    const { container } = render(
      <DerivedBlock derivedFrom={['blk_a']} onShowSource={noop} kind="summary">
        our reading
      </DerivedBlock>,
    );
    const derived = container.querySelector('[data-derived="true"]');
    expect(derived?.getAttribute('role')).toBe('note');
    expect(derived?.getAttribute('aria-label')).toContain('AI-derived');
  });

  it('calls onShowSource with exactly the derived_from ids, from the keyboard', () => {
    const shown: (readonly string[])[] = [];
    const { getByRole } = render(
      <DerivedBlock
        derivedFrom={['blk_a', 'blk_b']}
        onShowSource={(ids) => {
          shown.push(ids);
        }}
      >
        our reading
      </DerivedBlock>,
    );

    // `detail: 0` is the click a keyboard synthesises for Enter/Space — the path that must work
    // when there is no pointer at all. `fireEvent.click` defaults to it.
    fireEvent.click(getByRole('button', { name: /show source/i }));
    expect(shown).toEqual([['blk_a', 'blk_b']]);
  });

  it('calls onShowSource from a pointer, and exactly once', () => {
    const shown: (readonly string[])[] = [];
    const { getByRole } = render(
      <DerivedBlock
        derivedFrom={['blk_a']}
        onShowSource={(ids) => {
          shown.push(ids);
        }}
      >
        our reading
      </DerivedBlock>,
    );

    const button = getByRole('button', { name: /show source/i });
    // A real tap fires pointerup AND a click whose detail is non-zero. Both arriving must produce
    // one invocation, or every "show me" scrolls the document twice.
    fireEvent.pointerUp(button);
    fireEvent.click(button, { detail: 1 });
    expect(shown).toEqual([['blk_a']]);
  });
});

describe('EquationView — obligation 1: the crop is the paper, the latex is our reading', () => {
  const CROP = '/fixtures/resnet-cvpr-2col/equations/blk_aqbaozi7u2asflmg@8x.png';

  it('renders the crop OUTSIDE the derived block and BEFORE it, with the latex inside', () => {
    const { container } = render(
      <EquationView
        blockId="blk_aqbaozi7u2asflmg"
        imageSrc={CROP}
        imageAlt="Equation 1"
        latex="\\mathcal{F}(x) := \\mathcal{H}(x) - x"
        onShowSource={noop}
      />,
    );

    const crop = container.querySelector('img.pt-equation__crop');
    const derived = container.querySelector('[data-derived="true"]');
    expect(crop).not.toBeNull();
    expect(derived).not.toBeNull();
    if (crop === null || derived === null) return;

    // Outside: the ground truth must not inherit the derived register.
    expect(derived.contains(crop)).toBe(false);
    // Before: DOCUMENT_POSITION_FOLLOWING means `derived` comes after `crop` in reading order, so
    // the paper is what a screen reader and a scrolling eye reach first.
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(crop.compareDocumentPosition(derived) & following).toBe(following);

    // And the transcription is inside it, attributed to the equation's own block id.
    expect(derived.textContent).toContain('\\mathcal{H}(x)');
    expect(derived.getAttribute('data-derived-from')).toBe('blk_aqbaozi7u2asflmg');
  });

  it('renders NO derived block at all when there is no latex and no mathml', () => {
    // Five of `neural-odes-mathheavy`'s display equations carry no `latex`. A wrapper drawn anyway
    // would put the ⊙ on the paper's own crop — claiming an interpretation nobody made.
    const { container } = render(
      <EquationView
        blockId="blk_izoxetonhyvkprln"
        imageSrc="/fixtures/neural-odes-mathheavy/equations/blk_izoxetonhyvkprln@8x.png"
        imageAlt="Equation 3"
        onShowSource={noop}
      />,
    );

    expect(container.querySelector('[data-derived="true"]')).toBeNull();
    expect(container.textContent ?? '').not.toContain(DERIVED_MARKER);
    expect(container.querySelector('img.pt-equation__crop')).not.toBeNull();
  });

  it('reads the equation number from the payload it was given, never from the crop', () => {
    const { container } = render(
      <EquationView
        blockId="blk_aqbaozi7u2asflmg"
        imageSrc={CROP}
        imageAlt="Equation 1"
        equationNumber="1"
        onShowSource={noop}
      />,
    );
    expect(container.querySelector('.pt-equation__number')?.textContent).toBe('(1)');
  });
});

describe('TableView — the html payload is escaped text, never markup', () => {
  const HOSTILE = '<script>globalThis.__pwned = true;</script><b>bold</b>';

  it('does not inject TablePayload.html as HTML', () => {
    const { container } = render(
      <TableView
        blockId="blk_table"
        rows={[{ id: 'blk_row', cells: [{ id: 'blk_cell', text: 'ResNet-34', isHeader: true }] }]}
        html={HOSTILE}
        onShowSource={noop}
      />,
    );

    // Nothing was parsed into nodes...
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    // ...the payload survives as text...
    expect(container.textContent).toContain(HOSTILE);
    // ...and the serialised DOM proves React escaped it rather than a sanitiser stripping it.
    expect(container.innerHTML).toContain('&lt;script&gt;');
    expect(container.innerHTML).not.toContain('<script>');
    expect((globalThis as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('renders cells from the IR blocks, with no derived block when there is no html payload', () => {
    const { container } = render(
      <TableView
        blockId="blk_table"
        rows={[{ id: 'blk_row', cells: [{ id: 'blk_cell', text: 'ResNet-34' }] }]}
        onShowSource={noop}
      />,
    );
    expect(container.querySelector('td[data-block-id="blk_cell"]')?.textContent).toBe('ResNet-34');
    expect(container.querySelector('[data-derived="true"]')).toBeNull();
  });
});

describe('the ⊙ marker is reserved', () => {
  it('is emitted by nothing in the package except DerivedBlock', () => {
    // The marker means "not the paper" only while it is unique. `provenance.tsx`'s header promises
    // the spec greps for it; this is that grep, over every other component the package exports.
    const cases: readonly { readonly name: string; readonly node: ReactNode }[] = [
      {
        name: 'FigureView',
        node: (
          <FigureView
            blockId="blk_fig"
            imageSrc="/fixtures/resnet-cvpr-2col/figures/blk_3pzzcn4luvb5qmpc@4x.png"
            imageAlt="Figure 2"
            caption="Residual learning: a building block."
          />
        ),
      },
      { name: 'IconButton', node: <IconButton label="Navigator" icon="☰" onPress={noop} /> },
      {
        name: 'Panel',
        node: (
          <Panel title="Inspector" onClose={noop} onTogglePin={noop}>
            selection
          </Panel>
        ),
      },
      {
        name: 'SegmentedControl',
        node: (
          <SegmentedControl
            label="Reading mode"
            options={[
              { value: 'source', label: 'Source' },
              { value: 'guided', label: 'Guided' },
              { value: 'split', label: 'Split' },
            ]}
            value="source"
            onChange={noop}
          />
        ),
      },
      {
        name: 'Tabs',
        node: (
          <Tabs
            label="Navigator"
            tabs={[
              { id: 'outline', label: 'Outline', content: '3.1 Residual Learning' },
              { id: 'pages', label: 'Pages', content: 'thumbnails' },
            ]}
            value="outline"
            onChange={noop}
          />
        ),
      },
      {
        name: 'Sheet',
        node: (
          <Sheet
            open
            title="Inspector"
            detent="peek"
            onDetentChange={noop}
            onDismiss={noop}
          >
            answer
          </Sheet>
        ),
      },
    ];

    for (const { name, node } of cases) {
      const { container, unmount } = render(<>{node}</>);
      expect(`${name}: ${container.innerHTML}`).not.toContain(DERIVED_MARKER);
      unmount();
    }
  });
});
