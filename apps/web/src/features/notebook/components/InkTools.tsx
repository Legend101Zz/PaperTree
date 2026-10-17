'use client';

/**
 * The tool bar's ink controls (S5d, #209, frame 05), for `NotebookToolbar`'s two slots: the tools
 * (pen, highlighter, stroke eraser, lasso; each a toggle with `aria-pressed` and its key), and the nibs
 * (EF / F / M) and the six colours of the drawing tool in the hand, or of the last one held.
 */
import { ToolbarButton } from '@papertree/ui';
import { Eraser, Highlighter, LassoSelect, PenLine } from 'lucide-react';

import { INK_COLOURS, drawingTool } from '../model/tools';

import type { StrokeNib } from '../model/stroke';
import type { InkColour, InkTool, ToolAction, ToolState } from '../model/tools';
import type { CSSProperties, ReactNode } from 'react';

/** Props for `InkToolButtons` and `InkOptions`. */
export interface InkToolsProps {
  readonly state: ToolState;
  readonly onAction: (action: ToolAction) => void;
}

const TOOLS: readonly { tool: InkTool; label: string; key: string; icon: ReactNode }[] = [
  { tool: 'pen', label: 'Pen', key: 'P', icon: <PenLine size={20} /> },
  { tool: 'highlighter', label: 'Highlighter', key: 'H', icon: <Highlighter size={20} /> },
  { tool: 'eraser', label: 'Stroke eraser', key: 'E', icon: <Eraser size={20} /> },
  { tool: 'lasso', label: 'Lasso', key: 'L', icon: <LassoSelect size={20} /> },
];

/** Each nib with the diameter of its dot in the frame, in px. */
const NIBS: readonly { nib: StrokeNib; label: string; dot: number }[] = [
  // Each name starts with the letters shown, so "click EF" works by voice (WCAG 2.5.3).
  { nib: 'EF', label: 'EF, extra fine nib', dot: 3 },
  { nib: 'F', label: 'F, fine nib', dot: 5 },
  { nib: 'M', label: 'M, medium nib', dot: 8 },
];

/** A swatch shows the pen's solid ink of its colour (notebook.css tokens, both schemes). */
const swatch = (c: InkColour): CSSProperties =>
  ({ '--pt-swatch': c === 'pen' ? 'var(--pt-pen)' : `var(--pt-pen-${c})` }) as CSSProperties;

/** The pen, highlighter, stroke eraser and lasso: pressing the one in the hand puts it down. */
export function InkToolButtons({ state, onAction }: InkToolsProps): ReactNode {
  return TOOLS.map((t) => (
    <ToolbarButton
      key={t.tool}
      label={t.label}
      icon={t.icon}
      iconOnly
      pressed={state.tool === t.tool}
      data-ink-tool={t.tool}
      title={`${t.label} (${t.key})`}
      aria-keyshortcuts={t.key}
      onClick={() => onAction({ type: 'tool', tool: t.tool })}
    />
  ));
}

/** The nib widths and the colour row; a choice picks the drawing tool up if none is held. */
export function InkOptions({ state, onAction }: InkToolsProps): ReactNode {
  const target = drawingTool(state) ?? state.last;
  return (
    <>
      <span className="pt-nb-tools__rule" aria-hidden="true" />
      <span className="pt-nb-tools__set" role="group" aria-label="Nib width">
        {NIBS.map((n) => (
          <button
            key={n.nib}
            type="button"
            className="pt-nb-nib"
            data-nib={n.nib}
            aria-label={n.label}
            aria-pressed={state.nib[target] === n.nib}
            onClick={() => onAction({ type: 'nib', nib: n.nib })}
          >
            <span
              className="pt-nb-nib__dot"
              style={{ inlineSize: n.dot, blockSize: n.dot }}
              aria-hidden="true"
            />
            <span aria-hidden="true">{n.nib}</span>
          </button>
        ))}
      </span>
      <span className="pt-nb-tools__rule" aria-hidden="true" />
      <span className="pt-nb-tools__set" role="group" aria-label="Ink colour">
        {INK_COLOURS.map((c) => (
          <button
            key={c.colour}
            type="button"
            className="pt-nb-swatch"
            aria-label={c.label}
            aria-pressed={state.colour[target] === c.colour}
            style={swatch(c.colour)}
            onClick={() => onAction({ type: 'colour', colour: c.colour })}
          />
        ))}
      </span>
    </>
  );
}
