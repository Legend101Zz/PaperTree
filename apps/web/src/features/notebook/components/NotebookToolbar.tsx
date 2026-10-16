'use client';

/**
 * The notebook's floating tool bar (S5c, #208, frame 05). It holds only the tools this slice makes
 * work: Text and Sticky note, then Undo and Redo. The pen, highlighter, eraser, lasso, nibs and
 * colours are S5d's (#209) and arrive through `inkTools`, a named slot that renders nothing until
 * S5d fills it, so no control is ever shown that does nothing.
 */
import { ToolbarButton } from '@papertree/ui';
import { Redo2, StickyNote, Type, Undo2 } from 'lucide-react';

import type { ReactNode } from 'react';

/** Props for `NotebookToolbar`. */
export interface NotebookToolbarProps {
  /** Add a typed note and start typing in it. */
  readonly onText: () => void;
  /** Add a sticky and start typing on it. */
  readonly onSticky: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** S5d's slot: the ink tools group (pen, highlighter, eraser, lasso, nibs, colours). */
  readonly inkTools?: ReactNode;
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
