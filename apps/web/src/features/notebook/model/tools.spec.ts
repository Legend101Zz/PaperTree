/** tools.spec — the ink tool state machine, its keys, colour tokens and palm rejection (#209). */
import { describe, expect, it } from 'vitest';

import {
  INITIAL_TOOLS,
  colourToken,
  drawingTool,
  hasRealPressure,
  pointerRole,
  stepAlong,
  toolForKey,
  toolReducer,
} from './tools';

import type { ToolAction, ToolState } from './tools';

const run = (...actions: ToolAction[]): ToolState => actions.reduce(toolReducer, INITIAL_TOOLS);

describe('the tool state machine', () => {
  it('starts with nothing in the hand, so the page keeps its own editing', () => {
    expect(INITIAL_TOOLS.tool).toBeNull();
    expect(drawingTool(INITIAL_TOOLS)).toBeNull();
  });

  it('picks a tool up, switches between tools, and puts the one in the hand down again', () => {
    expect(run({ type: 'tool', tool: 'pen' }).tool).toBe('pen');
    expect(run({ type: 'tool', tool: 'pen' }, { type: 'tool', tool: 'eraser' }).tool).toBe(
      'eraser',
    );
    expect(run({ type: 'tool', tool: 'pen' }, { type: 'tool', tool: 'pen' }).tool).toBeNull();
    expect(run({ type: 'tool', tool: 'highlighter' }, { type: 'release' }).tool).toBeNull();
  });

  it('returns the same state when Escape has nothing to put down', () => {
    expect(toolReducer(INITIAL_TOOLS, { type: 'release' })).toBe(INITIAL_TOOLS);
  });

  it('gives each drawing tool its own nib and colour', () => {
    const s = run(
      { type: 'tool', tool: 'pen' },
      { type: 'nib', nib: 'EF' },
      { type: 'colour', colour: 'green' },
      { type: 'tool', tool: 'highlighter' },
      { type: 'nib', nib: 'M' },
    );
    expect(s.nib).toEqual({ pen: 'EF', highlighter: 'M' });
    expect(s.colour).toEqual({ pen: 'green', highlighter: 'amber' });
  });

  it('picks the last drawing tool up again when a nib or colour is chosen without one', () => {
    const s = run(
      { type: 'tool', tool: 'highlighter' },
      { type: 'tool', tool: 'lasso' },
      { type: 'tool', tool: 'eraser' },
      { type: 'colour', colour: 'pink' },
    );
    expect(s.tool).toBe('highlighter');
    expect(s.colour.highlighter).toBe('pink');
    expect(run({ type: 'nib', nib: 'M' })).toMatchObject({ tool: 'pen', nib: { pen: 'M' } });
  });

  it('switches by key: P, H, E and L, in either case; other keys are not tools', () => {
    expect(['p', 'H', 'e', 'L'].map(toolForKey)).toEqual(['pen', 'highlighter', 'eraser', 'lasso']);
    expect(toolForKey('x')).toBeNull();
    expect(toolForKey('Escape')).toBeNull();
  });
});

describe('colour tokens', () => {
  it('stores solid inks for the pen and washes for the highlighter', () => {
    expect(colourToken('pen', 'pen')).toBe('pen');
    expect(colourToken('pen', 'amber')).toBe('pen-amber');
    expect(colourToken('highlighter', 'amber')).toBe('hl-amber');
    expect(colourToken('highlighter', 'pen')).toBe('hl-pen');
  });
});

describe('palm rejection', () => {
  it('lets a pen and a mouse draw, and a finger until a pen is seen; then a finger scrolls', () => {
    expect(pointerRole('pen', false)).toBe('draw');
    expect(pointerRole('mouse', true)).toBe('draw');
    expect(pointerRole('touch', false)).toBe('draw');
    expect(pointerRole('touch', true)).toBe('scroll');
    expect(pointerRole('pen', true)).toBe('draw');
  });

  it('stores pressure only for a pen that reports it', () => {
    expect(hasRealPressure('pen', 0.37)).toBe(true);
    expect(hasRealPressure('pen', 0)).toBe(false);
    expect(hasRealPressure('pen', 0.5)).toBe(false);
    expect(hasRealPressure('mouse', 0.37)).toBe(false);
    expect(hasRealPressure('touch', 0.37)).toBe(false);
  });
});

describe("stepAlong (S5e: the bar's arrow keys)", () => {
  it("steps along the orientation's own arrows and wraps; Home and End go to the ends", () => {
    expect(stepAlong('ArrowDown', 'vertical', 0, 11)).toBe(1);
    expect(stepAlong('ArrowUp', 'vertical', 0, 11)).toBe(10);
    expect(stepAlong('ArrowDown', 'vertical', 10, 11)).toBe(0);
    expect(stepAlong('ArrowRight', 'horizontal', 3, 11)).toBe(4);
    expect(stepAlong('ArrowLeft', 'horizontal', 3, 11)).toBe(2);
    expect(stepAlong('Home', 'vertical', 5, 11)).toBe(0);
    expect(stepAlong('End', 'horizontal', 5, 11)).toBe(10);
  });

  it("leaves the other orientation's arrows, other keys and a focus outside the bar alone", () => {
    expect(stepAlong('ArrowRight', 'vertical', 0, 11)).toBeNull();
    expect(stepAlong('ArrowDown', 'horizontal', 0, 11)).toBeNull();
    expect(stepAlong('Enter', 'vertical', 0, 11)).toBeNull();
    expect(stepAlong('ArrowDown', 'vertical', -1, 11)).toBeNull();
  });
});
