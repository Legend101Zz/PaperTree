'use client';

/**
 * board/cards/NotebookCard and DiagramCard — the two cards that stand for a page elsewhere.
 *
 * A notebook card (DESIGN.md §7) is one index card with a miniature of the page drawn from the
 * page's own items, its title, its counts from the board read ("4 quotes · 1 sticky") and "Open
 * page". A diagram card is the AI slip with the plate drawn small from its stored parts (#217) and
 * the plate's counts; no part is drawn and no count claimed before the plate is read.
 */
import { AiSlip } from '@papertree/ui';
import { type NodeProps } from '@xyflow/react';

import { PlateMiniature } from '@/features/diagram/components/PlateMiniature';
import { plateReadout } from '@/features/diagram/model/plate';

import { countsLine, miniature } from '../../model/cards';
import { useCanvasActions } from '../BoardContext';
import { CardShell } from './CardShell';

import type { ReactNode } from 'react';
import type { PtNode } from '../../model/flow';

/** The miniature's size in card pixels (frame 06: a 200 × 96 dot-grid page). */
const MINI_W = 200;
const MINI_H = 96;

/** A notebook page card: a `notebook` row. */
export function NotebookCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
  const node = data.node;
  const pageId = node.source_page_id ?? '';
  const read = ctx.sources?.pages.get(pageId);
  const title = read?.page.title ?? node.title ?? 'Notebook page';
  const counts = countsLine(node.counts);
  return (
    <CardShell id={id} selected={selected} kind="notebook" stock="card">
      <div className="pt-bc__mini" aria-hidden="true">
        {miniature(read?.items ?? [], MINI_W, MINI_H).map((box) => (
          <span
            key={box.id}
            className="pt-bc__mini-item"
            data-kind={box.kind}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
        ))}
      </div>
      <p className="pt-bc__title">{title}</p>
      {counts === null ? null : <p className="pt-bc__meta">{counts}</p>}
      <a
        className="pt-btn pt-btn--outline pt-bc__btn nodrag"
        href={`/paper/${encodeURIComponent(data.paperId)}/notebook/${encodeURIComponent(pageId)}`}
      >
        Open page
      </a>
    </CardShell>
  );
}

/**
 * A diagram card: a `diagram` row. Its plate is read from the stored parts (#217) and drawn as a
 * miniature with its counts; until that read lands (or if it fails) the frame stays empty and no
 * count is claimed.
 */
export function DiagramCard({ id, data, selected }: NodeProps<PtNode>): ReactNode {
  const ctx = useCanvasActions();
  const plate = ctx.sources?.diagrams.get(data.node.source_diagram_id ?? '');
  const title = (plate?.title ?? data.node.title ?? '').trim();
  const counts = plate === undefined ? null : plateReadout(plate.parts, false, false);
  return (
    <CardShell id={id} selected={selected} kind="diagram" stock="bare">
      <AiSlip>
        <div className="pt-bc__plate">
          {plate === undefined || plate.parts.length === 0 ? null : (
            <PlateMiniature plate={plate} />
          )}
        </div>
        <p className="pt-bc__title">{title === '' ? 'Untitled diagram' : title}</p>
        {counts === null ? null : <p className="pt-bc__meta">{counts}</p>}
      </AiSlip>
    </CardShell>
  );
}
