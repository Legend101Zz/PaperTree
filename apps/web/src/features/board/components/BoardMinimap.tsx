'use client';

/**
 * board/components/BoardMinimap — frame 06's "Map · 100%": xyflow's `MiniMap` restyled to the tokens
 * (cards as ruled stock, AI cards as slip, frames as dashed outlines, the view as a navy box; both
 * schemes, `chrome.css`). It sits bottom-right, beside the legend and above nothing. On a phone it
 * folds behind a "Map" button at the top right, clear of the legend and the Undo toast below.
 * Dragging inside it pans the board.
 */
import { MiniMap, Panel, useStore } from '@xyflow/react';
import { useId, useState, type ReactNode } from 'react';

import { useWide } from '../hooks/useWide';
import { mapLabel } from '../model/chrome';
import { BoardIcon } from './BoardIcon';

import type { PtNode } from '../model/flow';

/** The stock a node is drawn in on the map; the classes are `chrome.css`'s. */
function mapClass(node: PtNode): string {
  if (node.type === 'frame') return 'pt-map__frame';
  return node.type === 'explanation' || node.type === 'diagram' ? 'pt-map__slip' : 'pt-map__card';
}

/**
 * The board's minimap and its caption; `empty` (nothing on the board) makes it "Map · empty".
 *
 * @example
 * <BoardMinimap empty={nodes.length === 0} />
 */
export function BoardMinimap({ empty }: { readonly empty: boolean }): ReactNode {
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const zoom = useStore((state) => state.transform[2]);
  const bodyId = useId();
  const shown = wide || open;
  return (
    <Panel
      position={wide ? 'bottom-right' : 'top-right'}
      className="pt-map"
      role="region"
      aria-label="Minimap"
    >
      {wide ? null : (
        <button
          type="button"
          className="pt-toolbtn pt-map__toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((was) => !was)}
        >
          <BoardIcon name="map" />
          Map
        </button>
      )}
      {shown ? (
        <div id={bodyId} className="pt-map__body">
          <MiniMap<PtNode>
            className="pt-map__view"
            style={{ width: 140, height: 98 }}
            nodeClassName={mapClass}
            nodeBorderRadius={1}
            maskStrokeWidth={2}
            pannable
            ariaLabel="Map of the board"
          />
          <p className="pt-map__label">{mapLabel(zoom, empty)}</p>
        </div>
      ) : null}
    </Panel>
  );
}
