'use client';

/**
 * board/components/BoardToolbar — frame 06's tools: Select, Add note, Add frame, Thread (L), Fit all
 * and the zoom (− 100% +), with a "More board tools" menu that keeps v0.1's Frame selected cards,
 * Remove frame and Delete within reach. Below 1100 px the words fold to icons (the names stay); on
 * a phone Select and the zoom move into the menu too, so the bar is one row beside the title (the
 * v0.1 defect at 390, GAP-A3 §3). A tool that cannot act now says why (`title`) and stays focusable.
 */
import { useStore } from '@xyflow/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { useWide } from '../hooks/useWide';
import { ZOOM_RANGE, zoomReadout, type ThreadTool } from '../model/chrome';
import { BoardIcon, type BoardIconName } from './BoardIcon';

/** One tool: a named button, maybe a toggle, maybe off with the reason. */
export interface BoardTool {
  readonly label: string;
  readonly icon?: BoardIconName;
  /** The tooltip: what it does, or why it is off. */
  readonly hint?: string;
  readonly enabled?: boolean;
  /** Present makes it a toggle. */
  readonly pressed?: boolean;
  /** Its key on the board (`aria-keyshortcuts`), shown as a key cap. */
  readonly keys?: string;
  /** Red ink (Delete): DESIGN.md §3.1, never a red fill. */
  readonly danger?: boolean;
  readonly run: () => void;
}

/** Props for `BoardToolbar`. */
export interface BoardToolbarProps {
  readonly select: BoardTool;
  readonly addNote: BoardTool;
  readonly addFrame: BoardTool;
  /** Thread (L): what it does with the selection (`threadTool`), and whether a thread is drawn. */
  readonly thread: ThreadTool & { readonly pressed: boolean; readonly run: () => void };
  readonly fitAll: BoardTool;
  readonly zoom: (direction: 'in' | 'out') => void;
  /** v0.1's selection tools, in the menu. */
  readonly more: readonly BoardTool[];
}

function Tool({ tool, icon }: { readonly tool: BoardTool; readonly icon?: boolean }): ReactNode {
  const off = tool.enabled === false;
  return (
    <button
      type="button"
      className={`pt-toolbtn pt-boardtool${icon === true ? ' pt-boardtool--icon' : ''}${
        tool.danger === true ? ' pt-boardtool--danger' : ''
      }`}
      aria-disabled={off ? true : undefined}
      aria-pressed={tool.pressed}
      aria-keyshortcuts={tool.keys}
      title={tool.hint}
      onClick={() => {
        if (!off) tool.run();
      }}
    >
      {tool.icon === undefined ? null : <BoardIcon name={tool.icon} />}
      <span className="pt-boardtool__label">{tool.label}</span>
      {tool.keys === undefined ? null : <kbd aria-hidden="true">{tool.keys}</kbd>}
    </button>
  );
}

/** The zoom out / in tools, off at the ends of `ZOOM_RANGE`; only this reads the live zoom. */
function zoomTools(zoom: number, run: BoardToolbarProps['zoom']): [BoardTool, BoardTool] {
  return [
    {
      label: 'Zoom out',
      icon: 'minus',
      enabled: zoom > ZOOM_RANGE.min + 0.001,
      run: () => run('out'),
    },
    {
      label: 'Zoom in',
      icon: 'plus',
      enabled: zoom < ZOOM_RANGE.max - 0.001,
      run: () => run('in'),
    },
  ];
}

function MoreMenu({ tools }: { readonly tools: readonly BoardTool[] }): ReactNode {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the menu it holds
    <div
      ref={box}
      className="pt-boardmenu"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        className="pt-toolbtn pt-boardtool pt-boardtool--icon"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <BoardIcon name="more" />
        <span className="pt-boardtool__label">More board tools</span>
      </button>
      {open ? (
        <div id={id} className="pt-boardmenu__panel" role="group" aria-label="More board tools">
          {tools.map((tool) => (
            <Tool
              key={tool.label}
              tool={{
                ...tool,
                run: () => {
                  setOpen(false);
                  tool.run();
                },
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The board's tool bar.
 *
 * @example
 * <BoardToolbar select={…} addNote={…} addFrame={…} thread={…} fitAll={…} zoom={zoomBy} more={[…]} />
 */
export function BoardToolbar(props: BoardToolbarProps): ReactNode {
  const { select, addNote, addFrame, thread, fitAll, more } = props;
  const wide = useWide();
  const zoom = useStore((state) => state.transform[2]);
  const [zoomOut, zoomIn] = zoomTools(zoom, props.zoom);
  const threadButton: BoardTool = {
    label: 'Thread',
    icon: 'thread',
    hint: thread.hint,
    enabled: thread.action !== 'none',
    pressed: thread.pressed,
    keys: 'L',
    run: thread.run,
  };
  return (
    <div className="pt-boardtools" role="toolbar" aria-label="Board tools">
      {wide ? <Tool tool={select} /> : null}
      <Tool tool={addNote} />
      <Tool tool={addFrame} />
      <Tool tool={threadButton} />
      <span className="pt-boardtools__rule" aria-hidden="true" />
      <Tool tool={fitAll} />
      {wide ? (
        <>
          <Tool tool={zoomOut} icon />
          <span className="pt-boardtools__zoom">{zoomReadout(zoom)}</span>
          <Tool tool={zoomIn} icon />
        </>
      ) : null}
      <MoreMenu tools={wide ? more : [select, zoomOut, zoomIn, ...more]} />
    </div>
  );
}
