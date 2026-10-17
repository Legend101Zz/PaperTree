/**
 * placePanel (#197): a row's popover or "…" menu goes under its button, over it when the viewport
 * has no room below (the last rows on a phone), and never past the viewport's sides.
 */
import { describe, expect, it } from 'vitest';

import { placePanel } from './usePanelPlace';

const PHONE = { width: 390, height: 844 };
const MENU = { width: 180, height: 190 };
const at = (top: number, left: number) => ({ top, bottom: top + 44, left, right: left + 44 });

describe('placePanel', () => {
  it('opens under the button, its right edge on the button’s for "end"', () => {
    expect(placePanel(at(300, 300), MENU, PHONE, 'end')).toEqual({ top: 352, left: 164 });
  });

  it('opens over the button when the viewport has no room below', () => {
    expect(placePanel(at(780, 300), MENU, PHONE, 'end')).toEqual({ top: 582, left: 164 });
  });

  it('stays under the button when there is no room above either', () => {
    const tall = { width: 180, height: 900 };
    expect(placePanel(at(100, 300), tall, PHONE, 'end').top).toBe(152);
  });

  it('keeps inside the viewport’s sides', () => {
    expect(placePanel(at(300, 10), MENU, PHONE, 'end').left).toBe(8);
    expect(placePanel(at(300, 330), MENU, PHONE, 'start').left).toBe(202);
    expect(placePanel(at(300, 40), MENU, PHONE, 'start').left).toBe(40);
  });
});
