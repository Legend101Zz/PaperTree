'use client';

/**
 * reader/useImageTool — whether the "Select area" tool is armed (v0.3 #348, item 2).
 *
 * The reader bar's button and the page share it, and they are far apart in the tree, so it is a
 * context the workspace mounts once. Armed, a drag on a page draws a rectangle (Alt+drag does the
 * same without arming). A press by KEYBOARD also asks for a starter rectangle (`starter` counts
 * them), because a keyboard has no drag: the page puts one in the middle and the arrow keys take
 * it from there.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** The tool as the bar and the page see it. */
export interface ImageTool {
  readonly armed: boolean;
  /** Counts keyboard arming presses; the page puts a starter rectangle in for each. */
  readonly starter: number;
  /** The bar's button: arms or disarms. `byKeyboard` (a press with no pointer) asks for a rectangle. */
  readonly toggle: (byKeyboard: boolean) => void;
  readonly disarm: () => void;
}

const Context = createContext<ImageTool | null>(null);

/** Mounts the tool's state for a reader. */
export function ImageToolProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [state, setState] = useState({ armed: false, starter: 0 });
  const toggle = useCallback(
    (byKeyboard: boolean): void =>
      setState((s) =>
        s.armed
          ? { ...s, armed: false }
          : { armed: true, starter: s.starter + (byKeyboard ? 1 : 0) },
      ),
    [],
  );
  const disarm = useCallback((): void => setState((s) => ({ ...s, armed: false })), []);
  const { armed, starter } = state;
  const value = useMemo<ImageTool>(
    () => ({ armed, starter, toggle, disarm }),
    [armed, starter, toggle, disarm],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * The area tool, or null where no provider mounted one (a surface with no reader bar).
 *
 * @returns The tool or null.
 */
export function useImageTool(): ImageTool | null {
  return useContext(Context);
}
