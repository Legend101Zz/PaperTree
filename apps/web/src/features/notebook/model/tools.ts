/**
 * The ink tools' state (S5d, #209): which tool is in the hand, each drawing tool's nib and colour,
 * the keys that switch them, the colour TOKEN a stroke stores, and the palm-rejection rule that says
 * what a pointer may do. Pure: the tool bar and the ink surface hold this in React and ask it.
 */
import type { StrokeNib, StrokeTool } from './stroke';

/** A tool that takes the pointer from the page while it is in the hand. */
export type InkTool = StrokeTool | 'eraser';

/** The six ink colours of the tool bar (frame 05), by name; `pen` is the blue-black ink. */
export type InkColour = 'pen' | 'amber' | 'green' | 'blue' | 'pink' | 'purple';

/** The colour row, in the frame's order, with each swatch's accessible name. */
export const INK_COLOURS: readonly { readonly colour: InkColour; readonly label: string }[] = [
  { colour: 'pen', label: 'Blue-black ink' },
  { colour: 'amber', label: 'Amber' },
  { colour: 'green', label: 'Green' },
  { colour: 'blue', label: 'Blue' },
  { colour: 'pink', label: 'Pink' },
  { colour: 'purple', label: 'Purple' },
];

/** What the tool bar holds. */
export interface ToolState {
  /** The tool in the hand; null: the page's own editing (type, drag, select). */
  readonly tool: InkTool | null;
  /** The drawing tool a nib or colour choice goes to when no drawing tool is in the hand. */
  readonly last: StrokeTool;
  readonly nib: Readonly<Record<StrokeTool, StrokeNib>>;
  readonly colour: Readonly<Record<StrokeTool, InkColour>>;
}

/** Something the person did on the tool bar or the keyboard. */
export type ToolAction =
  | { readonly type: 'tool'; readonly tool: InkTool }
  | { readonly type: 'nib'; readonly nib: StrokeNib }
  | { readonly type: 'colour'; readonly colour: InkColour }
  | { readonly type: 'release' };

/** Nothing in the hand; the pen writes blue-black at F, the highlighter amber at F. */
export const INITIAL_TOOLS: ToolState = {
  tool: null,
  last: 'pen',
  nib: { pen: 'F', highlighter: 'F' },
  colour: { pen: 'pen', highlighter: 'amber' },
};

/**
 * The drawing tool in the hand, if any.
 *
 * @param state - The tool state.
 * @returns `pen` or `highlighter`, else null.
 */
export function drawingTool(state: ToolState): StrokeTool | null {
  return state.tool === 'pen' || state.tool === 'highlighter' ? state.tool : null;
}

/**
 * The tool state machine. Choosing the tool in the hand puts it down (the button is a toggle);
 * a nib or colour goes to the drawing tool in the hand, else picks the last one up again, as a
 * pen picked up by its colour would be.
 *
 * @param state - The state before.
 * @param action - What was done.
 * @returns The state after (the same object when nothing changes).
 */
export function toolReducer(state: ToolState, action: ToolAction): ToolState {
  switch (action.type) {
    case 'release':
      return state.tool === null ? state : { ...state, tool: null };
    case 'tool': {
      if (state.tool === action.tool) return { ...state, tool: null };
      const last = action.tool === 'eraser' ? state.last : action.tool;
      return { ...state, tool: action.tool, last };
    }
    case 'nib':
    case 'colour': {
      const target = drawingTool(state) ?? state.last;
      const next =
        action.type === 'nib'
          ? { nib: { ...state.nib, [target]: action.nib } }
          : { colour: { ...state.colour, [target]: action.colour } };
      return { ...state, ...next, tool: target, last: target };
    }
  }
}

/** The keys that pick a tool up (and put it down again). Escape puts any tool down. */
export const TOOL_KEYS: Readonly<Record<string, InkTool>> = {
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
};

/**
 * The tool a key switches to.
 *
 * @param key - `KeyboardEvent.key`.
 * @returns The tool, or null for any other key.
 */
export function toolForKey(key: string): InkTool | null {
  return TOOL_KEYS[key.toLowerCase()] ?? null;
}

/**
 * The colour TOKEN a stroke stores (`--pt-<token>` in notebook.css, both schemes): the pen's inks
 * are solid, the highlighter's translucent washes, so the same swatch stores a different token
 * per tool and the lamp-lit scheme re-maps each.
 *
 * @param tool - The drawing tool.
 * @param colour - The swatch.
 * @returns E.g. `pen`, `pen-amber`, `hl-amber`, `hl-pen`.
 */
export function colourToken(tool: StrokeTool, colour: InkColour): string {
  if (tool === 'pen') return colour === 'pen' ? 'pen' : `pen-${colour}`;
  return `hl-${colour}`;
}

/** What a pointer on the ink surface does. */
export type PointerRole = 'draw' | 'scroll';

/**
 * Palm rejection. A pen draws, a mouse draws, and a finger draws until a pen has been seen on this
 * page; from then on a finger only scrolls, so a palm resting on the glass never inks. The latch
 * lasts until the page is left (a reload is the way back to finger drawing).
 *
 * @param pointerType - `PointerEvent.pointerType`.
 * @param penSeen - Whether a `pen` pointer has touched the ink surface on this page.
 * @returns `draw` or `scroll`.
 */
export function pointerRole(pointerType: string, penSeen: boolean): PointerRole {
  return pointerType === 'touch' && penSeen ? 'scroll' : 'draw';
}

/**
 * Whether a pointer's pressure is real. A mouse reports a constant 0.5 while pressed and some pens
 * report 0 on the first sample (RESEARCH-R2 §4), so only a pen with another value counts; anything
 * else is stored without pressure and simulated on render.
 *
 * @param pointerType - `PointerEvent.pointerType`.
 * @param pressure - The first sample's `PointerEvent.pressure`.
 * @returns True when the stroke should store pressure.
 */
export function hasRealPressure(pointerType: string, pressure: number): boolean {
  return pointerType === 'pen' && pressure > 0 && pressure !== 0.5;
}
