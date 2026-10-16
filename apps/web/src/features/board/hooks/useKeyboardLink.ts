'use client';

/**
 * board/hooks/useKeyboardLink — making a thread without a pointer (#213; ADR-004 §2.8, xyflow has
 * no keyboard linking). L on a focused card starts a click-to-connect from its first brass pin
 * (`useThreadDrawing.startLink`, the same state a pressed pin starts; there is no second link
 * mode); Enter on a brass pin starts one too. Then the highlight walks the cards that can take
 * the thread (`model/keyboardLink`: reading order, starting nearest), focus follows it so the
 * board pans to it, Enter picks it and the "Link as" picker opens, and Escape cancels with nothing
 * saved and focus back where it started. Every step is said in the board's live region.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { linkTargets, nearestTarget, stepTarget, type LinkTarget } from '../model/keyboardLink';
import { PIN_TABLE, isOutPort } from '../model/pins';

import type { ThreadDrawing } from './useThreadDrawing';
import type { PtNode } from '../model/flow';

/** What `useKeyboardLink` gives the board. */
export interface KeyboardLink {
  /** The highlighted target and the pin the thread would land on, or null. */
  readonly target: LinkTarget | null;
  /** For the stage's `onKeyDown`: L on a focused card starts a thread from it. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** The cards a keyboard link walks, fixed when it starts, and the highlighted one. */
interface Walk {
  readonly targets: readonly LinkTarget[];
  readonly index: number;
}

const cardElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);

const of = (n: number, count: number): string => `${String(n + 1)} of ${String(count)}`;

/**
 * Keyboard linking over the board's thread drawing.
 *
 * @param nodes The board's cards.
 * @param drawing The thread drawing (`useThreadDrawing`).
 * @param nameOf A card's short name, for the announcements.
 * @param say Puts a sentence in the board's live region.
 * @returns The highlighted target and the stage's key handler.
 */
export function useKeyboardLink(
  nodes: readonly PtNode[],
  drawing: ThreadDrawing,
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
      const sentence = `Nothing on this board can take a thread from ${now.nameOf(fromId)}.`;
      now.cancel();
      now.refuse(sentence);
      now.say(sentence);
      origin.current?.focus();
      origin.current = null;
      return;
    }
    setWalk({ targets, index: first });
    now.say(
      `Linking from ${now.nameOf(fromId)}. Target: ${now.nameOf(targets[first]!.id)}, ${of(first, targets.length)}. Tab or the arrow keys choose, Enter links, Escape cancels.`,
    );
  }, [fromId, fromPort]);

  const target = walk === null ? null : (walk.targets[walk.index] ?? null);

  // Focus follows the highlight, so xyflow pans the board to it and its ring shows.
  useEffect(() => {
    if (target !== null) cardElement(target.id)?.focus();
  }, [target]);

  useEffect(() => {
    if (walk === null || fromId === null || fromPort === null) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const next = stepTarget(walk.index, walk.targets.length, event.key, event.shiftKey);
      if (next === null && event.key !== 'Enter' && event.key !== 'Escape') return;
      // Ahead of xyflow's own keys: no arrow may move the card, no Enter may select it.
      event.preventDefault();
      event.stopPropagation();
      if (next !== null) {
        setWalk({ ...walk, index: next });
        say(`Target: ${nameOf(walk.targets[next]!.id)}, ${of(next, walk.targets.length)}.`);
        return;
      }
      const back = origin.current;
      origin.current = null;
      cancel();
      if (event.key === 'Escape') {
        say('Cancelled. Nothing was saved.');
        back?.focus();
        return;
      }
      const to = walk.targets[walk.index]!;
      setPending({ from: fromId, to: to.id, fromPort, toPort: to.toPort, returnTo: back });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [walk, fromId, fromPort, cancel, setPending, nameOf, say]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const card = event.target as HTMLElement;
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
      if ((event.key !== 'l' && event.key !== 'L') || !plain || linking !== null) return;
      if (!card.classList.contains('react-flow__node')) return; // typing in a card, not on it
      const id = card.getAttribute('data-id') ?? '';
      const node = nodes.find((n) => n.id === id);
      const port = node === undefined ? undefined : PIN_TABLE[node.data.node.kind].out[0];
      event.preventDefault();
      if (port === undefined) {
        const sentence = `${nameOf(id)} has no brass pin to start a thread from.`;
        refuse(sentence);
        say(sentence);
        return;
      }
      origin.current = card;
      startLink(id, port);
    },
    [linking, nodes, nameOf, refuse, say, startLink],
  );

  return { target, onKeyDown };
}
