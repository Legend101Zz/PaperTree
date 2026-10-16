import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { kindChoices } from '../model/linkAs';
import { LinkAsPicker } from './LinkAsPicker';

afterEach(cleanup);

const OK = kindChoices(
  { kind: 'diagram', port: 'claim_out' },
  { kind: 'excerpt', port: 'evidence_in' },
);
const REFUSED = kindChoices(
  { kind: 'question', port: 'claim_out' },
  { kind: 'excerpt', port: 'evidence_in' },
);

function picker(extra: Partial<Parameters<typeof LinkAsPicker>[0]> = {}) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  render(
    <LinkAsPicker
      from="Diagram ‘Scaled dot-product attention’"
      to="Passage p. 1"
      choices={OK}
      mode="new"
      at={{ x: 64, y: 696 }}
      onChoose={onChoose}
      onCancel={onCancel}
      {...extra}
    />,
  );
  const group = screen.getByRole('group', { name: /link as/i });
  return { onChoose, onCancel, group };
}
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

describe('the "Link as" picker', () => {
  it('names both ends, lists the seven kinds 4 + 3 with keys 1–7, and focuses the first', () => {
    const { group } = picker();
    expect(group.textContent).toContain('Diagram ‘Scaled dot-product attention’ → Passage p. 1');
    expect(group.textContent).toContain('1–7 · Esc = plain link');
    const options = within(group).getAllByRole('option');
    expect(
      options.map((o) => [o.getAttribute('aria-label'), o.getAttribute('aria-keyshortcuts')]),
    ).toEqual([
      ['supports', '1'],
      ['contradicts', '2'],
      ['derives from', '3'],
      ['answers', '4'],
      ['compares with', '5'],
      ['references', '6'],
      ['plain link', '7'],
    ]);
    // Each option draws its thread with the second cue (ThreadSwatch), not a word alone.
    expect(within(options[1]!).getByRole('img').getAttribute('aria-label')).toBe(
      'contradicts: dashed with crosses',
    );
    expect(document.activeElement).toBe(options[0]);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull(); // not a modal
  });

  it('chooses a kind by its number key, by Enter on the focused option, or by a click', () => {
    const { onChoose, group } = picker();
    press('2');
    expect(onChoose).toHaveBeenLastCalledWith('contradicts', null);
    press('7');
    expect(onChoose).toHaveBeenLastCalledWith('relates', null);
    fireEvent.click(within(group).getByRole('option', { name: 'answers' }));
    expect(onChoose).toHaveBeenLastCalledWith('answers', null);
  });

  it('walks the grid with the arrows; Tab moves grid ↔ label as two stops, inside the picker', () => {
    const { group } = picker();
    const options = within(group).getAllByRole('option');
    press('ArrowDown');
    expect(document.activeElement).toBe(options[4]);
    press('ArrowRight');
    expect(document.activeElement).toBe(options[5]);
    expect(options[5]!.getAttribute('aria-selected')).toBe('true');
    expect(options.map((o) => o.getAttribute('tabindex'))).toEqual(
      ['-1', '-1', '-1', '-1', '-1', '0', '-1'], // a roving grid: one stop
    );
    press('Tab');
    expect(document.activeElement?.textContent).toBe('Add a label');
    press('Tab');
    expect(document.activeElement).toBe(options[5]); // back to the option focused last
    press('Tab', { shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Add a label');
  });

  it('Enter in the label saves the kind focused last, never one Tab passed over', () => {
    const { onChoose } = picker();
    press('ArrowRight'); // contradicts
    press('Tab');
    press('Enter'); // "Add a label" is a button: Enter presses it
    fireEvent.click(document.activeElement!);
    const field = screen.getByRole('textbox', { name: 'Label on the thread (optional)' });
    fireEvent.change(field, { target: { value: 'see 1 2 7' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('contradicts', 'see 1 2 7');
  });

  it('no key pressed inside reaches the board: Delete never deletes a card or a thread', () => {
    const { group } = picker();
    const board = vi.fn();
    document.addEventListener('keydown', board); // where xyflow's Delete key listens
    try {
      for (const key of ['Delete', 'Backspace', 'a', 'ArrowLeft', '2']) press(key);
      fireEvent.keyDown(within(group).getByRole('option', { name: 'answers' }), { key: 'Delete' });
      expect(board).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', board);
    }
    expect(group.classList.contains('nokey')).toBe(true); // xyflow's own opt-out, too
  });

  it('Escape keeps a plain link on a new thread (v0.1’s Escape saved nothing)', () => {
    const { onChoose, onCancel } = picker();
    press('Escape');
    expect(onChoose).toHaveBeenCalledWith('relates', null);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a press outside the picker closes it with nothing saved, new or changing', () => {
    const fresh = picker();
    fireEvent.pointerDown(document.body);
    expect(fresh.onCancel).toHaveBeenCalled();
    expect(fresh.onChoose).not.toHaveBeenCalled();
    cleanup();
    const change = picker({ mode: 'change', initial: 'answers' });
    fireEvent.pointerDown(document.body);
    expect(change.onCancel).toHaveBeenCalled();
    expect(change.onChoose).not.toHaveBeenCalled();
  });

  it('changing a saved thread starts on its kind, and Escape changes nothing', () => {
    const { onChoose, onCancel, group } = picker({ mode: 'change', initial: 'derives_from' });
    expect(document.activeElement).toBe(
      within(group).getByRole('option', { name: 'derives from' }),
    );
    expect(group.textContent).toContain('Esc = no change');
    expect(screen.queryByText('Add a label')).toBeNull();
    press('Escape');
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('keeps the optional label reachable, and its digits are typed, not chosen', () => {
    const { onChoose } = picker();
    fireEvent.click(screen.getByRole('button', { name: 'Add a label' }));
    const field = screen.getByRole('textbox', { name: 'Label on the thread (optional)' });
    fireEvent.change(field, { target: { value: 'see §3 2017' } });
    fireEvent.keyDown(field, { key: '2' });
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('supports', 'see §3 2017');
  });

  it('a kind the pins do not take is disabled, says why on focus, and its key does nothing', () => {
    const { onChoose, group } = picker({ choices: REFUSED });
    const supports = within(group).getByRole('option', { name: 'supports' });
    expect(supports.getAttribute('aria-disabled')).toBe('true');
    const why = document.getElementById(supports.getAttribute('aria-describedby')!);
    expect(why?.textContent).toBe('That pin does not take that thread.');
    expect(why?.hidden).toBe(false); // it is the focused option, so the reason shows
    press('1');
    fireEvent.click(supports);
    press('Escape'); // not even the plain link: the server would refuse it
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('has no axe violations (layout-bound rules are a browser’s job)', async () => {
    const { group } = picker();
    const results = await axe.run(group, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
