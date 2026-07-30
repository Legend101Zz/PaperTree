/**
 * The primitives' two acceptance criteria, checked at the component level.
 *
 *   `reader/touch.spec` — "Every interactive element ≥44×44pt. Zero hover-only actions."
 *   `reader/a11y.spec`  — "Full keyboard operation."
 *
 * Both are asserted here rather than only in `apps/web`, because a screen-level audit tells you
 * that SOMETHING is 20px and a component-level one tells you which control — and because a
 * primitive that is correct here is correct on every screen that uses it, which is the only reason
 * to have primitives at all.
 *
 * The 44px assertion reads `element.style.minWidth`, the INLINE style. That is deliberate and is
 * the same reason `primitives.tsx` writes it inline: happy-dom applies no stylesheet, so a check
 * against a CSS class would pass while measuring nothing. See the note at the top of that file
 * about Tailwind purging.
 *
 * Hover is not testable here — there is no pointer. What IS testable is the property that makes
 * hover-only impossible: every affordance below is reachable by key and by pointer, and the label
 * that hover reveals is in the DOM (and in `aria-label`) whether or not it is revealed.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  IconButton,
  Panel,
  SegmentedControl,
  Sheet,
  Tabs,
  TOUCH_TARGET_MIN_PX,
  type SheetDetent,
} from '../src/primitives.js';

afterEach(cleanup);
const noop = (): void => {};

function ModeSwitch(): JSX.Element {
  const [value, setValue] = useState<'source' | 'guided' | 'split'>('source');
  return (
    <SegmentedControl
      label="Reading mode"
      options={[
        { value: 'source', label: 'Source' },
        { value: 'guided', label: 'Guided' },
        { value: 'split', label: 'Split' },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

function Nav({ activation }: { activation: 'automatic' | 'manual' }): JSX.Element {
  const [value, setValue] = useState('outline');
  return (
    <Tabs
      label="Navigator"
      activation={activation}
      tabs={[
        { id: 'outline', label: 'Outline', content: 'outline body' },
        { id: 'pages', label: 'Pages', content: 'pages body' },
        { id: 'highlights', label: 'Highlights', content: 'highlights body' },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

describe('touch minimum', () => {
  it('is inline on every interactive element', () => {
    const { container } = render(
      <>
        <IconButton label="Navigator" icon="X" onPress={noop} />
        <ModeSwitch />
        <Nav activation="automatic" />
        <Sheet open title="Inspector" detent="peek" onDetentChange={noop} onDismiss={noop}>
          body
        </Sheet>
        <Panel title="P" onClose={noop} onTogglePin={noop}>
          b
        </Panel>
      </>,
    );
    const interactive = container.querySelectorAll<HTMLElement>('button,[role="slider"]');
    expect(interactive.length).toBeGreaterThan(8);
    for (const el of interactive) {
      expect(`${el.getAttribute('aria-label') ?? el.textContent ?? ''}: ${el.style.minWidth}`).toBe(
        `${el.getAttribute('aria-label') ?? el.textContent ?? ''}: ${String(TOUCH_TARGET_MIN_PX)}px`,
      );
      expect(el.style.minHeight).toBe(`${String(TOUCH_TARGET_MIN_PX)}px`);
    }
  });
});

describe('IconButton press semantics', () => {
  it('fires once for a pointerdown+pointerup pair, and not for pointerup alone', () => {
    let n = 0;
    const { getByRole } = render(
      <IconButton
        label="Audio"
        icon="A"
        onPress={() => {
          n += 1;
        }}
      />,
    );
    const b = getByRole('button');
    fireEvent.pointerUp(b, { pointerId: 1 });
    expect(n).toBe(0); // press began elsewhere
    fireEvent.pointerDown(b, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(b, { pointerId: 1 });
    expect(n).toBe(1);
    fireEvent.click(b, { detail: 1 }); // the click that follows the tap
    expect(n).toBe(1);
    fireEvent.click(b, { detail: 0 }); // Enter/Space
    expect(n).toBe(2);
  });

  it('does not fire when disabled, but stays focusable and names the reason', () => {
    let n = 0;
    const { getByRole } = render(
      <IconButton
        label="Ask"
        icon="?"
        disabled
        disabledReason="Offline"
        onPress={() => {
          n += 1;
        }}
      />,
    );
    const b = getByRole('button');
    fireEvent.pointerDown(b, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(b, { pointerId: 1 });
    fireEvent.click(b, { detail: 0 });
    expect(n).toBe(0);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.hasAttribute('disabled')).toBe(false);
    const describedBy = b.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(b.querySelector(`[id="${describedBy ?? ''}"]`)?.textContent).toBe('Offline');
  });
});

describe('SegmentedControl radio semantics', () => {
  it('has one tab stop and arrow keys move + select, with wrap', () => {
    const { getAllByRole } = render(<ModeSwitch />);
    const radios = getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
    expect(getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(document.activeElement).toBe(radios[1]);

    fireEvent.keyDown(radios[1]!, { key: 'ArrowLeft' });
    fireEvent.keyDown(radios[0]!, { key: 'ArrowLeft' }); // wraps to the end
    expect(getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ]);

    fireEvent.keyDown(radios[2]!, { key: 'Home' });
    expect(getAllByRole('radio')[0]?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Tabs', () => {
  it('wires role/aria-selected/aria-controls and mounts only the selected panel', () => {
    const { getAllByRole, getByRole, container } = render(<Nav activation="automatic" />);
    const tabs = getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    const panel = getByRole('tabpanel');
    expect(panel.textContent).toBe('outline body');
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    // Unselected tabs point at nothing, because their panel is not mounted.
    expect(tabs[1]?.hasAttribute('aria-controls')).toBe(false);
    expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(1);
  });

  it('roving tabindex follows arrows, wraps, and Home/End jump (automatic activation)', () => {
    const { getAllByRole } = render(<Nav activation="automatic" />);
    const list = getAllByRole('tab')[0]!;
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    let tabs = getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);

    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    tabs = getAllByRole('tab');
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowRight' }); // wraps
    expect(getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('manual activation moves focus without selecting until pressed', () => {
    const { getAllByRole } = render(<Nav activation="manual" />);
    const tabs = getAllByRole('tab');
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('false');
    expect(getAllByRole('tab')[1]?.getAttribute('tabindex')).toBe('0');
    fireEvent.click(tabs[1]!, { detail: 0 });
    expect(getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('Sheet', () => {
  function Host({ initial }: { initial: SheetDetent }): JSX.Element {
    const [detent, setDetent] = useState<SheetDetent>(initial);
    const [open, setOpen] = useState(true);
    return (
      <div>
        <button type="button">outside</button>
        <Sheet
          open={open}
          title="Inspector"
          detent={detent}
          onDetentChange={setDetent}
          onDismiss={() => {
            setOpen(false);
          }}
        >
          <button type="button">inside-first</button>
          <button type="button">inside-last</button>
        </Sheet>
      </div>
    );
  }

  it('renders three detents as heights and exposes them on the slider', () => {
    const { container, rerender } = render(
      <Sheet open title="I" detent="peek" onDetentChange={noop} onDismiss={noop}>
        b
      </Sheet>,
    );
    const sheet = container.querySelector<HTMLElement>('.pt-sheet');
    expect(sheet?.style.height).toBe('120px');
    expect(sheet?.getAttribute('data-detent')).toBe('peek');
    const grip = container.querySelector('[role="slider"]');
    expect(grip?.getAttribute('aria-valuenow')).toBe('0');
    expect(grip?.getAttribute('aria-valuetext')).toBe('peek');

    rerender(
      <Sheet open title="I" detent="half" onDetentChange={noop} onDismiss={noop}>
        b
      </Sheet>,
    );
    expect(container.querySelector<HTMLElement>('.pt-sheet')?.style.height).toBe('50%');
    rerender(
      <Sheet open title="I" detent="full" onDetentChange={noop} onDismiss={noop}>
        b
      </Sheet>,
    );
    expect(container.querySelector<HTMLElement>('.pt-sheet')?.style.height).toBe('100%');
  });

  it('grip arrows and Home/End walk the detents', () => {
    const { container } = render(<Host initial="peek" />);
    const grip = container.querySelector('[role="slider"]')!;
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(container.querySelector('.pt-sheet')?.getAttribute('data-detent')).toBe('half');
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(container.querySelector('.pt-sheet')?.getAttribute('data-detent')).toBe('full');
    fireEvent.keyDown(grip, { key: 'ArrowUp' }); // clamps
    expect(container.querySelector('.pt-sheet')?.getAttribute('data-detent')).toBe('full');
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(container.querySelector('.pt-sheet')?.getAttribute('data-detent')).toBe('peek');
    fireEvent.keyDown(grip, { key: 'End' });
    expect(container.querySelector('.pt-sheet')?.getAttribute('data-detent')).toBe('full');
  });

  it('drags up a detent and dismisses on a downward drag from peek', () => {
    const { container } = render(<Host initial="peek" />);
    const grip = container.querySelector<HTMLElement>('[role="slider"]')!;
    grip.setPointerCapture = () => {};
    grip.hasPointerCapture = () => false;
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 440 });
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 440 });
    expect(container.querySelector('.pt-sheet')?.getAttribute('data-detent')).toBe('half');

    const grip2 = container.querySelector<HTMLElement>('[role="slider"]')!;
    grip2.setPointerCapture = () => {};
    grip2.hasPointerCapture = () => false;
    fireEvent.pointerDown(grip2, { pointerId: 2, button: 0, clientY: 400 });
    fireEvent.pointerUp(grip2, { pointerId: 2, clientY: 460 });
    expect(container.querySelector('.pt-sheet')?.getAttribute('data-detent')).toBe('peek');

    const grip3 = container.querySelector<HTMLElement>('[role="slider"]')!;
    grip3.setPointerCapture = () => {};
    grip3.hasPointerCapture = () => false;
    fireEvent.pointerDown(grip3, { pointerId: 3, button: 0, clientY: 400 });
    fireEvent.pointerUp(grip3, { pointerId: 3, clientY: 460 });
    expect(container.querySelector('.pt-sheet')).toBeNull(); // dismissed
  });

  it('Escape dismisses', () => {
    const { container } = render(<Host initial="half" />);
    fireEvent.keyDown(container.querySelector('.pt-sheet')!, { key: 'Escape' });
    expect(container.querySelector('.pt-sheet')).toBeNull();
  });

  it('is modal at full: scrim, aria-modal, focus taken, Tab wrapped', () => {
    const { container, getByText } = render(<Host initial="full" />);
    const sheet = container.querySelector<HTMLElement>('.pt-sheet')!;
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.pt-sheet__scrim')).not.toBeNull();
    expect(document.activeElement).toBe(sheet);

    const first = getByText('inside-first');
    const dismiss = container.querySelector<HTMLElement>('.pt-sheet__close')!;
    const focusables = Array.from(sheet.querySelectorAll<HTMLElement>('button,[tabindex="0"]'));
    const last = focusables[focusables.length - 1]!;
    expect(last.textContent).toBe('inside-last');

    last.focus();
    fireEvent.keyDown(sheet, { key: 'Tab' });
    // The grip is the first focusable (tabindex 0), not the close button.
    expect(document.activeElement).toBe(container.querySelector('[role="slider"]'));
    (document.activeElement as HTMLElement).focus();
    fireEvent.keyDown(sheet, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(first).not.toBe(dismiss);
  });

  it('is not modal at peek — no scrim, no trap, focus left in the document', () => {
    const { container, getByText } = render(<Host initial="peek" />);
    getByText('outside').focus();
    expect(container.querySelector('.pt-sheet')?.getAttribute('aria-modal')).toBe('false');
    expect(container.querySelector('.pt-sheet__scrim')).toBeNull();
    expect(document.activeElement).toBe(getByText('outside'));
  });
});
