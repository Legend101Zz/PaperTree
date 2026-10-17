'use client';

/**
 * The notebook's floating tool bar (S5c, #208, frame 05): the ink tools, Shapes, Text and Sticky
 * note, the nibs and colours, then Undo and Redo. The ink controls are S5d's (#209) and arrive
 * through two named slots, `inkTools` and `inkOptions`, so the bar reads in the frame's order and
 * no control is ever shown that does nothing.
 */
import { ToolbarButton } from '@papertree/ui';
import { Circle, MoveRight, Redo2, Shapes, Square, StickyNote, Type, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ShapeItem } from '../model/page';
import type { ReactNode } from 'react';

const SHAPES: readonly { shape: ShapeItem['shape']; label: string; icon: ReactNode }[] = [
  { shape: 'rect', label: 'Add a rectangle', icon: <Square size={20} /> },
  { shape: 'ellipse', label: 'Add an ellipse', icon: <Circle size={20} /> },
  { shape: 'arrow', label: 'Add an arrow', icon: <MoveRight size={20} /> },
];

/** Props for `NotebookToolbar`. */
export interface NotebookToolbarProps {
  /** Add a typed note and start typing in it. */
  readonly onText: () => void;
  /** Add a sticky and start typing on it. */
  readonly onSticky: () => void;
  /** Add a shape and select it. */
  readonly onShape: (shape: ShapeItem['shape']) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** S5d's first slot: the ink tools (pen, highlighter, eraser, lasso). */
  readonly inkTools?: ReactNode;
  /** S5d's second slot, after Sticky note: the nibs and the colours. */
  readonly inkOptions?: ReactNode;
  /** `vertical` is the tablet's left rail (frame 05b, S5e); the same tools in the same order. */
  readonly orientation?: 'horizontal' | 'vertical';
}

/** The Shapes tool: a button that opens the three shapes; Escape or a press elsewhere closes it. */
function ShapesTool({ onShape }: { onShape: NotebookToolbarProps['onShape'] }): ReactNode {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLSpanElement>(null);
  const close = (): void => {
    setOpen(false);
    trigger.current?.querySelector('button')?.focus();
  };
  // Escape closes the menu and nothing else: the ink tool in the hand stays (`useInkTools`).
  const escape = (e: { key: string; preventDefault: () => void }): void => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    close();
  };
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent): void => {
      if (!(e.target instanceof Node) || trigger.current?.contains(e.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <span className="pt-nb-tools__shapes" ref={trigger}>
      <ToolbarButton
        label="Shapes"
        icon={<Shapes size={20} />}
        iconOnly
        aria-expanded={open}
        aria-controls="pt-nb-shape-menu"
        onClick={() => setOpen(!open)}
        onKeyDown={escape}
      />
      {open ? (
        // A group of three buttons, not a menu: Tab reaches them; Escape on them or on the Shapes
        // button closes it.
        <span id="pt-nb-shape-menu" className="pt-nb-tools__pop" role="group" aria-label="Shapes">
          {SHAPES.map((s) => (
            <ToolbarButton
              key={s.shape}
              label={s.label}
              icon={s.icon}
              iconOnly
              onClick={() => {
                setOpen(false);
                onShape(s.shape);
              }}
              onKeyDown={escape}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** The tool bar above the page. */
export function NotebookToolbar(props: NotebookToolbarProps): ReactNode {
  return (
    <div
      className={`pt-nb-tools${props.orientation === 'vertical' ? ' pt-nb-tools--rail' : ''}`}
      role="toolbar"
      aria-label="Notebook tools"
      aria-orientation={props.orientation ?? 'horizontal'}
    >
      {props.inkTools === undefined ? null : (
        <div className="pt-nb-tools__group" data-slot="ink-tools">
          {props.inkTools}
        </div>
      )}
      <ShapesTool onShape={props.onShape} />
      <ToolbarButton label="Text" icon={<Type size={20} />} iconOnly onClick={props.onText} />
      <ToolbarButton
        label="Sticky note"
        icon={<StickyNote size={20} />}
        iconOnly
        onClick={props.onSticky}
      />
      {props.inkOptions}
      <span className="pt-nb-tools__rule" aria-hidden="true" />
      <ToolbarButton
        label="Undo"
        icon={<Undo2 size={20} />}
        iconOnly
        disabled={!props.canUndo}
        aria-keyshortcuts="Control+Z Meta+Z"
        onClick={props.onUndo}
      />
      <ToolbarButton
        label="Redo"
        icon={<Redo2 size={20} />}
        iconOnly
        disabled={!props.canRedo}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        onClick={props.onRedo}
      />
    </div>
  );
}
