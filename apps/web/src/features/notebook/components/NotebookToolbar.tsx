'use client';

/**
 * The notebook's floating tool bar (S5c, #208, frame 05). It holds only the tools this slice makes
 * work: Shapes, Text and Sticky note, then Undo and Redo. The pen, highlighter, eraser, lasso, nibs and
 * colours are S5d's (#209) and arrive through `inkTools`, a named slot that renders nothing until
 * S5d fills it, so no control is ever shown that does nothing.
 */
import { ToolbarButton } from '@papertree/ui';
import { Circle, MoveRight, Redo2, Shapes, Square, StickyNote, Type, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';

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
  /** S5d's slot: the ink tools group (pen, highlighter, eraser, lasso, nibs, colours). */
  readonly inkTools?: ReactNode;
}

/** The Shapes tool: a button that opens the three shapes; Escape closes it. */
function ShapesTool({ onShape }: { onShape: NotebookToolbarProps['onShape'] }): ReactNode {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLSpanElement>(null);
  const close = (): void => {
    setOpen(false);
    trigger.current?.querySelector('button')?.focus();
  };
  return (
    <span className="pt-nb-tools__shapes" ref={trigger}>
      <ToolbarButton
        label="Shapes"
        icon={<Shapes size={20} />}
        iconOnly
        aria-expanded={open}
        aria-controls="pt-nb-shape-menu"
        onClick={() => setOpen(!open)}
      />
      {open ? (
        // A group of three buttons, not a menu: Tab reaches them, Escape on any of them closes.
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
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
              }}
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
    <div className="pt-nb-tools" role="toolbar" aria-label="Notebook tools">
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
