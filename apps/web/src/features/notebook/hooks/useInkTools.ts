'use client';

/**
 * useInkTools — the tool in the hand and its keys (S5d, #209): P pen, H highlighter, E stroke
 * eraser, L lasso (the same key again puts the tool down), Escape puts any tool down. Keys typed
 * into a note, a sticky or a field are the field's, a key with Ctrl, Cmd or Alt is a shortcut's, and
 * an Escape something else took (the Shapes menu closing) is not ours. It also holds palm
 * rejection's latch (`penSeen`), which belongs to the page: putting the tool down must not reset it.
 */
import { useEffect, useReducer, useRef } from 'react';

import { inField } from './usePageEditing';
import { INITIAL_TOOLS, colourToken, drawingTool, toolForKey, toolReducer } from '../model/tools';

import type { InkInHand } from './useInkInput';
import type { ToolAction, ToolState } from '../model/tools';
import type { MutableRefObject } from 'react';

/** What `useInkTools` returns. */
export interface InkTools {
  readonly state: ToolState;
  readonly dispatch: (action: ToolAction) => void;
  /** Set once a pen has touched this page (`pointerRole`); kept until the page is left. */
  readonly penSeen: MutableRefObject<boolean>;
}

/**
 * The tool bar's ink state, with its keyboard shortcuts on the window.
 *
 * @returns The state and its dispatcher.
 */
export function useInkTools(): InkTools {
  const [state, dispatch] = useReducer(toolReducer, INITIAL_TOOLS);
  const penSeen = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (inField(e.target)) return;
      if (e.key === 'Escape') {
        dispatch({ type: 'release' });
        return;
      }
      const tool = toolForKey(e.key);
      if (tool === null) return;
      e.preventDefault();
      dispatch({ type: 'tool', tool });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { state, dispatch, penSeen };
}

/**
 * The page's `ink` prop for the tool in the hand: the tool, and the pen's nib and colour token.
 *
 * @param state - The tool state.
 * @param on - What the page does with a stroke, an erase and a lasso.
 * @returns The prop, or null while no tool is held.
 */
export function inkInHand(
  state: ToolState,
  on: Pick<InkInHand, 'onStroke' | 'onErase' | 'onLasso' | 'penSeen' | 'onRefused'>,
): InkInHand | null {
  if (state.tool === null) return null;
  const pen = drawingTool(state);
  const nibbed =
    pen === null
      ? null
      : { tool: pen, nib: state.nib[pen], color: colourToken(pen, state.colour[pen]) };
  return { tool: state.tool, pen: nibbed, ...on };
}
