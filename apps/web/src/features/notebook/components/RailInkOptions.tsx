'use client';

/**
 * The tablet rail's nib and colour (S5e, #210, frame 05b): one button each, showing what the drawing
 * tool holds, opening a flyout beside the rail with S5d's choices (`NibSet`, `ColourSet`). A choice,
 * Escape or a press elsewhere closes it and gives the keyboard back to its button; Escape closes
 * only the flyout, never puts the tool down (`useInkTools` skips a handled Escape). Tabbing out of
 * it closes it too.
 */
import { useEffect, useRef, useState } from 'react';

import { ColourSet, InkOptions, NibSet } from './InkTools';
import { INK_COLOURS, drawingTool } from '../model/tools';

import type { InkToolsProps } from './InkTools';
import type { CSSProperties, ReactNode } from 'react';

/** Props for `Flyout`. */
interface FlyoutProps {
  readonly id: string;
  readonly label: string;
  /** What the closed button shows. */
  readonly face: ReactNode;
  /** The choices; `close` is called after one is made. */
  readonly children: (close: () => void) => ReactNode;
}

function Flyout({ id, label, face, children }: FlyoutProps): ReactNode {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  const close = (): void => {
    setOpen(false);
    holder.current?.querySelector('button')?.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent): void => {
      if (!(e.target instanceof Node) || holder.current?.contains(e.target) !== true) {
        setOpen(false);
      }
    };
    // Heard on the document, before `useInkTools`' window listener, which skips a handled Escape.
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !(e.target instanceof Node)) return;
      if (holder.current?.contains(e.target) !== true) return;
      e.preventDefault();
      setOpen(false);
      holder.current?.querySelector('button')?.focus();
    };
    // The keyboard leaving it closes it. A press inside does not count: Safari does not focus a
    // pressed button, so the focus a press takes away would otherwise close it under the press.
    const el = holder.current;
    let pressing = false;
    const press = (): void => {
      pressing = true;
    };
    const release = (): void => {
      pressing = false;
    };
    const leave = (e: FocusEvent): void => {
      const to = e.relatedTarget;
      if (pressing || (to instanceof Node && el?.contains(to) === true)) return;
      setOpen(false);
    };
    el?.addEventListener('pointerdown', press);
    el?.addEventListener('click', release);
    el?.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      el?.removeEventListener('pointerdown', press);
      el?.removeEventListener('click', release);
      el?.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <span className="pt-nb-tools__shapes" ref={holder}>
      <button
        type="button"
        className="pt-nb-rail__pick"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {face}
      </button>
      {open ? (
        <span id={id} className="pt-nb-tools__pop" role="group" aria-label={label}>
          {children(close)}
        </span>
      ) : null}
    </span>
  );
}

/** The rail's nib button and colour button, each with its flyout. */
export function RailInkOptions({ state, onAction }: InkToolsProps): ReactNode {
  const target = drawingTool(state) ?? state.last;
  const nib = state.nib[target];
  const colour = state.colour[target];
  const name = INK_COLOURS.find((c) => c.colour === colour)?.label ?? colour;
  const ink = { '--pt-swatch': colour === 'pen' ? 'var(--pt-pen)' : `var(--pt-pen-${colour})` };
  const then =
    (close: () => void): InkToolsProps['onAction'] =>
    (action) => {
      onAction(action);
      close();
    };
  return (
    <>
      <span className="pt-nb-tools__rule" aria-hidden="true" />
      <Flyout id="pt-nb-rail-nib" label={`Nib: ${nib}`} face={<span data-nib-face>{nib}</span>}>
        {(close) => <NibSet state={state} onAction={then(close)} />}
      </Flyout>
      <Flyout
        id="pt-nb-rail-colour"
        label={`Colour: ${name}`}
        face={<span className="pt-nb-rail__swatch" style={ink as CSSProperties} />}
      >
        {(close) => <ColourSet state={state} onAction={then(close)} />}
      </Flyout>
    </>
  );
}

/**
 * The ink options a layout draws in the tool bar's second slot: the rail's two flyouts on a
 * tablet, S5d's nib and colour rows on the desktop bar.
 *
 * @param props - The tool state and its dispatcher, and whether the bar is the tablet's rail.
 * @param props.rail - True on the tablet.
 * @returns The options.
 */
export function LayoutInkOptions({
  rail,
  ...props
}: InkToolsProps & { readonly rail: boolean }): ReactNode {
  return rail ? <RailInkOptions {...props} /> : <InkOptions {...props} />;
}
