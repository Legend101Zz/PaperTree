'use client';

/**
 * The phone notebook's bottom bar (S5e, #210, frame 08c): Text, Sticky, Highlight and the pen's
 * opt-in ("Pen: off" until switched on), under the honest line that says what the phone leaves to
 * a tablet or a computer. Its four tools are the ones `model/layoutMode`'s `allows` gives the
 * phone (the pen behind its switch); the eraser, lasso, shapes and templates are not drawn. With a drawing tool in the hand the page itself is shown
 * and drawing works as on a tablet; Undo joins the bar then, for the strokes just drawn.
 */
import { ToolbarButton } from '@papertree/ui';
import { Highlighter, PenLine, StickyNote, Type, Undo2 } from 'lucide-react';

import { PHONE_LEAVES_OUT } from '../model/layoutMode';

import './phone.css';

import type { ToolAction, ToolState } from '../model/tools';
import type { ReactNode } from 'react';

/**
 * The room the bar takes at the foot of the screen, in px: its line, its 56 px buttons and its
 * padding. The desk keeps it free (`--pt-nb-bar-space`, set by the screen) and toasts sit above it.
 */
export const PHONE_BAR_SPACE = 136;

/** Props for `PhoneBar`. */
export interface PhoneBarProps {
  readonly tools: ToolState;
  readonly onTool: (action: ToolAction) => void;
  readonly onText: () => void;
  readonly onSticky: () => void;
  readonly onUndo: () => void;
  readonly canUndo: boolean;
}

/** The bar at the foot of the phone notebook. */
export function PhoneBar({
  tools,
  onTool,
  onText,
  onSticky,
  onUndo,
  canUndo,
}: PhoneBarProps): ReactNode {
  const pen = tools.tool === 'pen';
  return (
    <div className="pt-nb-phonebar">
      <p className="pt-nb-phonebar__note">{PHONE_LEAVES_OUT}</p>
      <div className="pt-nb-phonebar__tools" role="toolbar" aria-label="Notebook tools">
        <ToolbarButton label="Text" icon={<Type size={20} />} size="touch" onClick={onText} />
        <ToolbarButton
          label="Sticky"
          icon={<StickyNote size={20} />}
          size="touch"
          onClick={onSticky}
        />
        <ToolbarButton
          label="Highlight"
          icon={<Highlighter size={20} />}
          size="touch"
          pressed={tools.tool === 'highlighter'}
          onClick={() => onTool({ type: 'tool', tool: 'highlighter' })}
        />
        <ToolbarButton
          label={pen ? 'Pen: on' : 'Pen: off'}
          icon={<PenLine size={20} />}
          size="touch"
          pressed={pen}
          onClick={() => onTool({ type: 'tool', tool: 'pen' })}
        />
        {tools.tool === null ? null : (
          <ToolbarButton
            label="Undo"
            icon={<Undo2 size={20} />}
            size="touch"
            disabled={!canUndo}
            onClick={onUndo}
          />
        )}
      </div>
    </div>
  );
}
