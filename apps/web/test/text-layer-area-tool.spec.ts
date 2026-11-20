/**
 * An Alt drag, or any drag while the area tool is armed, is the picture tool's: the text layer's
 * blank-space snapping must stand down, or its pointerup builds a text selection from the press and
 * the reader drops the rectangle just drawn (v0.3 #348, e2e image-ask "Alt+drag a rectangle").
 */
import { describe, expect, it } from 'vitest';

import { pressIsAreaTool } from '@/components/reader/textLayerSelection';

describe('pressIsAreaTool', () => {
  it('is true with Alt held', () => {
    const el = document.createElement('div');
    expect(pressIsAreaTool({ altKey: true, target: el })).toBe(true);
  });

  it('is true on a page whose scroller has the area tool armed', () => {
    const root = document.createElement('div');
    root.setAttribute('data-pt-areatool', '');
    const span = document.createElement('span');
    root.append(span);
    expect(pressIsAreaTool({ altKey: false, target: span })).toBe(true);
  });

  it('is false for a plain press on text', () => {
    const root = document.createElement('div');
    const span = document.createElement('span');
    root.append(span);
    expect(pressIsAreaTool({ altKey: false, target: span })).toBe(false);
    expect(pressIsAreaTool({ altKey: false, target: null })).toBe(false);
  });
});
