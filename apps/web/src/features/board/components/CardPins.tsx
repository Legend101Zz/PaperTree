'use client';

/**
 * board/components/CardPins — a card's brass port pins as xyflow handles (DESIGN.md §3.10): open
 * circle = evidence in, open diamond = question in, brass circle = claim out, brass diamond =
 * answer out. The handle id is the port name, so a thread is saved with the pins it was drawn
 * between. Threads leave from brass pins only and arrive at open pins only.
 *
 * While a thread is being drawn, every pin it could land on lights (navy ring); the check is
 * `canConnect`, the server's own table. Each pin is a named, focusable button; Enter or Space
 * presses it, which is xyflow's click-to-connect (press a brass pin, then an open pin).
 */
import { Handle, Position } from '@xyflow/react';

import {
  FALLBACK_IN,
  FALLBACK_OUT,
  PIN_NAMES,
  PIN_SIDE,
  PIN_TABLE,
  canConnect,
  isOutPort,
  type Port,
} from '../model/pins';
import { useLinking } from './BoardContext';

import type { KeyboardEvent, ReactNode } from 'react';
import type { CanvasNode } from '@/lib/api/types';

const POSITION = {
  left: Position.Left,
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
} as const;

/** Enter and Space press a pin the way a click does. */
function press(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.stopPropagation(); // the card around it must not take Enter as "select me"
  event.currentTarget.click();
}

/** Props for `CardPins`. */
export interface CardPinsProps {
  readonly nodeId: string;
  readonly kind: CanvasNode['kind'];
}

/**
 * The two hidden handles every card and frame carries, so a stored thread whose pins cannot be
 * named still draws (`edgeHandles`). Not connectable, not focusable, not announced.
 */
export function FallbackHandles(): ReactNode {
  return (
    <>
      <Handle
        id={FALLBACK_OUT}
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="pt-pin-fallback"
        aria-hidden="true"
      />
      <Handle
        id={FALLBACK_IN}
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="pt-pin-fallback"
        aria-hidden="true"
      />
    </>
  );
}

/** Every pin a card kind offers, on the side it sits, and the hidden fallback handles. */
export function CardPins({ nodeId, kind }: CardPinsProps): ReactNode {
  const linking = useLinking();
  const pins: readonly Port[] = [...PIN_TABLE[kind].into, ...PIN_TABLE[kind].out];
  const drawn = pins.map((port) => {
    const out = isOutPort(port);
    const lit =
      linking !== null &&
      linking.nodeId !== nodeId &&
      canConnect({ kind: linking.kind, port: linking.port }, { kind, port });
    return (
      <Handle
        key={port}
        id={port}
        type={out ? 'source' : 'target'}
        position={POSITION[PIN_SIDE[port]]}
        isConnectableStart={out}
        isConnectableEnd={!out}
        className={`pt-pin pt-pin--${port}`}
        data-port={port}
        data-lit={lit}
        role="button"
        tabIndex={0}
        aria-label={PIN_NAMES[port]}
        onKeyDown={press}
      />
    );
  });
  return (
    <>
      {drawn}
      <FallbackHandles />
    </>
  );
}
