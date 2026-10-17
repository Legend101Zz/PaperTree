'use client';

/**
 * A closed lasso on the page (S5d, #209, frame 05): its dashed loop, drawn over the items, and its
 * menu just under it. Both sit outside the page's scaled layer (the loop is scaled inside its own
 * SVG), so the menu keeps its own size on a small page and never scales with it. A loop in the
 * page's right half hangs its menu from its right edge, so the menu never runs off the page; on a
 * phone the menu sits at the foot of the screen (`notebook.css`).
 */
import { LassoMenu } from './LassoMenu';
import { boundsOf } from '../model/hitTest';
import { loopPath } from '../model/lasso';
import { BINDING, TITLE_BAND } from '../model/layout';
import { PAGE_WIDTH } from '../model/page';

import type { LassoMenuProps } from './LassoMenu';
import type { Vec2 } from '../model/page';
import type { CSSProperties, ReactNode } from 'react';

/** Props for `LassoLayer`. */
export interface LassoLayerProps extends LassoMenuProps {
  /** The loop as drawn, in page units (the items layer's, as shown). */
  readonly path: readonly Vec2[];
  /** Screen px per page unit. */
  readonly scale: number;
}

/** The closed loop and its menu. */
export function LassoLayer({ path, scale, ...menu }: LassoLayerProps): ReactNode {
  const box = boundsOf(path);
  const px = (n: number): string => `${String(n)}px`;
  // Custom properties, not insets: a phone's stylesheet puts the menu at the screen's foot instead.
  const at: CSSProperties & Record<`--pt-lasso-${string}`, string> = {
    '--pt-lasso-top': px((TITLE_BAND + box.y1) * scale + 12),
    ...(box.x0 > PAGE_WIDTH / 2
      ? { '--pt-lasso-right': px(Math.max(0, (PAGE_WIDTH - box.x1) * scale)) }
      : { '--pt-lasso-left': px(BINDING + Math.max(0, box.x0) * scale) }),
  };
  return (
    <>
      <svg
        className="pt-nb-lasso pt-nb-lasso--closed"
        style={{ left: BINDING, top: TITLE_BAND * scale }}
        width={PAGE_WIDTH * scale}
        height={1}
        aria-hidden="true"
      >
        <path d={loopPath(path)} transform={`scale(${String(scale)})`} />
      </svg>
      <div className="pt-nb-lasso-at" style={at}>
        <LassoMenu {...menu} />
      </div>
    </>
  );
}
