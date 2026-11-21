'use client';

/**
 * reader/ImageLayer — one page's picture picking, drawn in the page's overlay slot (v0.3 #348).
 *
 * Four things live here, all in IR points times the page's scale, like the highlight overlay:
 *  - a button per detected float, in reading order, so Tab walks a page's floats and Enter selects
 *    one (the overlay is `pointer-events: none`, so a mouse never reaches them; they are the
 *    keyboard's way in, and the faint hover outline is theirs too);
 *  - the rectangle being drawn;
 *  - the selection's frame: the outline, eight handles when it can be adjusted, and a chip that
 *    names it and, beside the board, is what to drag across the divider;
 *  - nothing else. Colours are the page's `--pt-pdf-img-*` tokens (Light, Sepia and Dark).
 */
import { useEffect, useRef, type DragEvent, type ReactNode } from 'react';

import { HANDLES } from '../model/imageRegion';
import { pickLabel } from '../model/imagePick';

import type { ImagePicking } from '../hooks/useImagePick';
import type { PageFloat } from '../model/floats';
import type { BBox } from '@papertree/document-ir';
import './imageLayer.css';

/** The chip's drag, when the board is beside the paper. */
export interface FrameDrag {
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
}

/** Props for `ImageLayer`. */
export interface ImageLayerProps {
  readonly pageIndex: number;
  /** IR points to CSS px: `zoom x userUnit`. */
  readonly scale: number;
  readonly floats: readonly PageFloat[];
  readonly picking: ImagePicking;
  /** Set when the board is beside the paper: the chip can be dragged to it. */
  readonly drag?: FrameDrag;
}

function place(box: BBox, scale: number): React.CSSProperties {
  return {
    left: `${box[0] * scale}px`,
    top: `${box[1] * scale}px`,
    width: `${(box[2] - box[0]) * scale}px`,
    height: `${(box[3] - box[1]) * scale}px`,
  };
}

/**
 * The picking layer of one page.
 *
 * @param props The page, its scale, its floats and the picking state.
 * @returns The layer.
 */
export function ImageLayer({
  pageIndex,
  scale,
  floats,
  picking,
  drag,
}: ImageLayerProps): ReactNode {
  const { pick, draft, hover, focusNonce } = picking;
  const mine = pick !== null && pick.page === pageIndex ? pick : null;
  const frame = useRef<HTMLDivElement>(null);
  // A new pick takes focus, so Enter explains it and the arrows move it without a Tab first.
  useEffect(() => {
    if (focusNonce > 0 && mine !== null) frame.current?.focus({ preventScroll: true });
    // Only a NEW pick moves focus; moving the rectangle must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  if (floats.length === 0 && mine === null && (draft === null || draft.page !== pageIndex)) {
    return null;
  }
  const adjustable = mine?.origin === 'area';
  return (
    <div className="pt-imglayer" data-pt-imglayer="">
      {floats.map((float) => {
        const selected = mine?.float?.id === float.id;
        return (
          <button
            key={float.id}
            type="button"
            className="pt-imgfloat"
            data-hover={hover?.id === float.id && hover.page === pageIndex ? '' : undefined}
            data-selected={selected ? '' : undefined}
            data-float={float.kind}
            style={place(float.box, scale)}
            aria-pressed={selected}
            aria-label={`${float.label}, page ${String(pageIndex + 1)}${
              float.caption === null ? '' : `: ${float.caption.slice(0, 80)}`
            }. Press Enter to select it.`}
            onClick={(event) => {
              // A mouse press never lands here (the layer is not a pointer target); this is the
              // keyboard's Enter or Space. Shift keeps the words already selected.
              picking.pickFloat(float, event.shiftKey);
            }}
          />
        );
      })}
      {draft !== null && draft.page === pageIndex ? (
        <div className="pt-imgdraft" style={place(draft.box, scale)} />
      ) : null}
      {mine === null ? null : (
        // The frame is the keyboard's way to move the rectangle, and a mouse's way to move it, so it
        // is focusable and takes keys and presses though its role is a plain group.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          ref={frame}
          className="pt-imgframe"
          data-pt-imgui=""
          data-pt-imgframe=""
          data-origin={mine.origin}
          role="group"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          aria-label={`${pickLabel(mine)} selected on page ${String(pageIndex + 1)}. ${
            adjustable
              ? 'Arrow keys move it; Alt with an arrow resizes it; Shift takes bigger steps. '
              : ''
          }Enter explains it; Escape lets go.`}
          style={place(mine.box, scale)}
          onKeyDown={picking.onFrameKeyDown}
          onPointerDown={adjustable ? (event) => picking.beginAdjust('move', event) : undefined}
        >
          {adjustable
            ? HANDLES.map((handle) => (
                <span
                  key={handle}
                  className="pt-imghandle"
                  data-handle={handle}
                  data-pt-imgui=""
                  onPointerDown={(event) => picking.beginAdjust(handle, event)}
                />
              ))
            : null}
          <span
            className="pt-imgchip"
            data-pt-imgui=""
            draggable={drag !== undefined}
            title={drag === undefined ? undefined : 'Drag this to the board'}
            onDragStart={drag?.onDragStart}
            onDragEnd={drag?.onDragEnd}
          >
            {pickLabel(mine)}
            {drag === undefined ? null : (
              <span className="pt-imgchip__grip"> · drag to the board</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
