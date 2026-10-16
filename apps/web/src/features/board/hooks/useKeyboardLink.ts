'use client';

/**
 * board/hooks/useKeyboardLink — making a thread without a pointer (#213; ADR-004 §2.8, xyflow has
 * no keyboard linking). L on a focused card starts a click-to-connect from its first brass pin
 * (`useThreadDrawing.startLink`, the same state a pressed pin starts; there is no second link
 * mode); Enter on a brass pin starts one too. Then the highlight walks the cards and pins that can
 * take the thread (`model/keyboardLink`: reading order, starting nearest), focus follows it so the
 * board pans to it, Enter picks it and the "Link as" picker opens, and Escape cancels with nothing
 * saved and focus back where it started.
 *
 * THE WALK IS SCOPED TO THE BOARD: it takes keys only from inside the stage and never from a text
 * field, and it ends (saving nothing) when focus leaves the stage, on a press anywhere but a pin
 * (a pin may still finish it by pointer), or when another thread starts.
 *
 * On a big board a card out of view is not in the page (`bigBoard`, #215): the walk centres the
 * board on its target first and moves focus once xyflow has drawn it, so focus, and the name it
 * announces, always land on a card the reader can see (#215 review S6).
 */
import { useReactFlow } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { linkTargets, nearestTarget, stepTarget, type LinkTarget } from '../model/keyboardLink';
import { stop } from '../model/linkAs';
import { PIN_NAMES, PIN_TABLE, isOutPort } from '../model/pins';

import type { ThreadDrawing } from './useThreadDrawing';
import type { PtNode } from '../model/flow';

/** What `useKeyboardLink` gives the board. */
export interface KeyboardLink {
  /** The highlighted target and the pin the thread would land on, or null. */
  readonly target: LinkTarget | null;
  /** True while the walk runs (the cards then describe the walk's keys, not their own). */
  readonly walking: boolean;
  /** For the stage's `onKeyDown`: L on a focused card starts a thread from it. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /**
   * Start a thread from a card as L does, from outside the board (the toolbar's Thread, #214);
   * Escape gives focus back to whatever had it.
   */
  readonly start: (nodeId: string) => void;
}

/** The targets a keyboard link walks, fixed when it starts, and the highlighted one. */
interface Walk {
  readonly targets: readonly LinkTarget[];
  readonly index: number;
}

const cardElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);

// A field the person types in: its keys are never the walk's (xyflow's `isInputDOMNode` too).
const isTextField = (el: Element): boolean =>
  el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null;

// Focus moved onto a card announces its name, so a step says only where it is and the pin.
const step = (walk: Walk, i: number): string =>
  `Target ${String(i + 1)} of ${String(walk.targets.length)}, ${PIN_NAMES[walk.targets[i]!.toPort]}.`;

/**
 * Keyboard linking over the board's thread drawing.
 *
 * @param nodes The board's cards.
 * @param drawing The thread drawing (`useThreadDrawing`).
 * @param stage The board's stage: the walk takes keys from inside it only.
 * @param nameOf A card's short name, for the announcements.
 * @param say Puts a sentence in the board's live region.
 * @returns The highlighted target, whether a walk runs, and the stage's key handler.
 */
export function useKeyboardLink(
  nodes: readonly PtNode[],
  drawing: ThreadDrawing,
  stage: RefObject<HTMLElement>,
  nameOf: (id: string) => string,
  say: (sentence: string) => void,
): KeyboardLink {
  const { linking, startLink, cancel, refuse, setPending } = drawing;
  const origin = useRef<HTMLElement | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);
  const fromPort = linking?.keyboard === true && isOutPort(linking.port) ? linking.port : null;
  const fromId = fromPort === null ? null : (linking?.nodeId ?? null);
  // The start reads the latest board without re-running when a card re-renders mid-walk.
  const latest = useRef({ nodes, linking, nameOf, say, cancel, refuse });
  latest.current = { nodes, linking, nameOf, say, cancel, refuse };

  useEffect(() => {
    const now = latest.current;
    const from = now.linking;
    if (fromId === null || fromPort === null || from === null) {
      setWalk(null);
      origin.current = null; // ended some other way (a click on an open pin): start afresh
      return;
    }
    origin.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const targets = linkTargets(now.nodes, { nodeId: fromId, kind: from.kind, port: fromPort });
    const first = nearestTarget(now.nodes, targets, fromId);
    if (first < 0) {
      now.cancel();
      // Said once, by the notice (role=alert); the live region stays quiet.
      now.refuse(stop(`Nothing on this board can take a thread from ${now.nameOf(fromId)}`));
      origin.current?.focus();
      origin.current = null;
      return;
    }
    const next = { targets, index: first };
    setWalk(next);
    now.say(
      `Linking from ${stop(now.nameOf(fromId))} ${step(next, first)} Tab or the arrow keys choose, Enter links, Escape cancels.`,
    );
  }, [fromId, fromPort]);

  const target = walk === null ? null : (walk.targets[walk.index] ?? null);

  // Focus follows the highlight, so xyflow pans the board to it and its ring shows.
  const flow = useReactFlow();
  useEffect(() => {
    if (target === null) return undefined;
    const shown = cardElement(target.id);
    if (shown !== null) {
      shown.focus();
      return undefined;
    }
    const node = latest.current.nodes.find((n) => n.id === target.id);
    if (node === undefined) return undefined;
    const w = node.measured?.width ?? node.width ?? node.data.node.w;
    const h = node.measured?.height ?? node.height ?? node.data.node.h;
    void flow.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
      zoom: flow.getZoom(),
    });
    let frame = 0;
    let tries = 0;
    const focusWhenDrawn = (): void => {
      const drawn = cardElement(target.id);
      if (drawn !== null) drawn.focus();
      else if ((tries += 1) < 30) frame = requestAnimationFrame(focusWhenDrawn);
    };
    frame = requestAnimationFrame(focusWhenDrawn);
    return () => cancelAnimationFrame(frame);
  }, [target, flow]);

  useEffect(() => {
    const board = stage.current;
    if (walk === null || fromId === null || fromPort === null || board === null) return undefined;
    const end = (): void => {
      origin.current = null;
      cancel();
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const el = event.target;
      if (!(el instanceof Element) || !board.contains(el) || isTextField(el)) return;
      const next = stepTarget(walk.index, walk.targets.length, event.key, event.shiftKey);
      if (next === null && event.key !== 'Enter' && event.key !== 'Escape') return;
      // Ahead of xyflow's own keys: no arrow may move the card, no Enter may select it.
      event.preventDefault();
      event.stopPropagation();
      if (next !== null) {
        setWalk({ ...walk, index: next });
        say(step(walk, next));
        return;
      }
      const back = origin.current;
      end();
      if (event.key === 'Escape') {
        say('Cancelled. Nothing was saved.');
        back?.focus();
        return;
      }
      const to = walk.targets[walk.index]!;
      setPending({ from: fromId, to: to.id, fromPort, toPort: to.toPort, returnTo: back });
    };
    const onPress = (event: PointerEvent): void => {
      const el = event.target;
      if (!(el instanceof Element) || el.closest('.react-flow__handle') === null) end();
    };
    const onLeave = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !board.contains(next)) end();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    board.addEventListener('focusout', onLeave);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPress, true);
      board.removeEventListener('focusout', onLeave);
    };
  }, [walk, fromId, fromPort, stage, cancel, setPending, say]);

  /** A thread from the card's first brass pin; `from` gets focus back on Escape. */
  const startFrom = useCallback(
    (id: string, from: HTMLElement | null) => {
      const node = nodes.find((n) => n.id === id);
      const port = node === undefined ? undefined : PIN_TABLE[node.data.node.kind].out[0];
      if (port === undefined) {
        refuse(stop(`${nameOf(id)} has no brass pin to start a thread from`));
        return;
      }
      origin.current = from;
      startLink(id, port);
    },
    [nodes, nameOf, refuse, startLink],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const card = event.target as HTMLElement;
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
      // `code` as well as `key`, so L works on a layout whose L key types another letter.
      const isL = event.code === 'KeyL' || event.key === 'l' || event.key === 'L';
      if (!isL || !plain || linking !== null) return;
      if (!card.classList.contains('react-flow__node')) return; // typing in a card, not on it
      event.preventDefault();
      startFrom(card.getAttribute('data-id') ?? '', card);
    },
    [linking, startFrom],
  );

  const start = useCallback(
    (nodeId: string) => {
      if (linking !== null) return;
      startFrom(
        nodeId,
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      );
    },
    [linking, startFrom],
  );

  return { target, walking: walk !== null, onKeyDown, start };
}
