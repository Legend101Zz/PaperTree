'use client';

/**
 * board/cards/CardGlance — a card as it reads from far off (#215): below the low-zoom switch
 * (`model/glance`) every card draws as its kind and its first words, large, on plain stock with no
 * texture or in-card buttons, and keeps its pins (drawn, not targets) so its threads stay drawn.
 * `withGlance` wraps each
 * card kind: memoised on its row (a drag does not redraw it), full size while its note is edited.
 */
import { memo, type ComponentType, type ReactNode } from 'react';

import { glanceOf, sameCard } from '../../model/glance';
import { useCanvasActions, useGlance } from '../BoardContext';
import { GlancePins } from '../CardPins';

import type { PtNode } from '../../model/flow';
import type { NodeProps } from '@xyflow/react';

/** A card drawn as a glance. */
export function CardGlance({ data, selected }: NodeProps<PtNode>): ReactNode {
  const node = data.node;
  const glance = glanceOf(node);
  const slip = node.kind === 'explanation' || node.kind === 'diagram';
  return (
    <div
      className={`pt-bc pt-bc--glance${slip ? ' pt-bc--glance-slip' : ''}`}
      data-kind={node.kind}
      data-selected={selected}
      data-glance="true"
    >
      <p className="pt-bc__glance-kind">{glance.kind}</p>
      {glance.words === '' ? null : (
        <p className="pt-bc__glance-words" data-voice={glance.voice ?? undefined}>
          {glance.words}
        </p>
      )}
      <GlancePins kind={node.kind} />
    </div>
  );
}

/**
 * A card kind that draws as a glance when the board is zoomed out, and is redrawn only when its
 * row, its selection or its type changes (`sameCard`).
 *
 * @param Card The full card.
 * @returns The node type xyflow renders.
 * @example
 * const nodeTypes = { note: withGlance(NoteCard) };
 */
export function withGlance(
  Card: ComponentType<NodeProps<PtNode>>,
): ComponentType<NodeProps<PtNode>> {
  const Full = memo(Card, sameCard);
  function Glanced(props: NodeProps<PtNode>): ReactNode {
    const glance = useGlance();
    // A note being typed in keeps its field, whatever the zoom.
    const editing = useCanvasActions().editingId === props.id;
    return glance && !editing ? <CardGlance {...props} /> : <Full {...props} />;
  }
  Glanced.displayName = `withGlance(${Card.displayName ?? Card.name})`;
  return memo(Glanced, sameCard);
}
