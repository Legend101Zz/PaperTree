'use client';

/**
 * board/hooks/useLinkAs — the board's half of "Link as" (#213): which thread the picker is open
 * for (a new one from a drop, a click-to-connect, the keyboard or the toolbar's Link; or a saved
 * one whose kind is changing), the dashed thread that waits for its kind, the save, and the
 * sentences the live region says ("Linking from …", "Target 2 of 5, evidence in."). A new thread's
 * "Linked as supports." is the controller's Undo toast, its own live region, so it is said once.
 * A request whose thread or cards are gone (deleted, then put back by Undo) is dropped, never
 * reopened.
 */
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';

import { kindLabel, type PtNode } from '../model/flow';
import { endName } from '../model/linkAs';
import { isOutPort } from '../model/pins';
import { useKeyboardLink, type KeyboardLink } from './useKeyboardLink';

import type { BoardController } from './useBoardController';
import type { ThreadDrawing } from './useThreadDrawing';
import type { LinkRequest } from '../components/LinkAsLayer';
import type { ThreadPreviewProps } from '../components/ThreadPreview';
import type { EdgeKind } from '@/lib/api/types';

/** What `useLinkAs` gives the board. */
export interface LinkAs {
  /** The thread the picker is open for, or null. */
  readonly request: LinkRequest | null;
  /** The dashed thread to draw while a kind is awaited or a keyboard target is highlighted. */
  readonly preview: ThreadPreviewProps | null;
  readonly choose: (kind: EdgeKind, label: string | null) => void;
  /** Close the picker with nothing saved (Escape while changing a saved thread's kind). */
  readonly cancel: () => void;
  /** Open the picker for a saved thread; focus returns to `opener`. */
  readonly changeKind: (edgeId: string, opener: HTMLElement) => void;
  readonly keyboard: KeyboardLink;
  /** The live region's sentence. */
  readonly said: string;
}

/**
 * The picker's state, the keyboard link and the announcements.
 *
 * @param ctl The board controller (the only writer).
 * @param drawing The thread drawing.
 * @param nodes The cards as drawn (notebook cards named by their page).
 * @param stage The board's stage, which scopes the keyboard walk.
 * @returns See `LinkAs`.
 */
export function useLinkAs(
  ctl: BoardController,
  drawing: ThreadDrawing,
  nodes: readonly PtNode[],
  stage: RefObject<HTMLElement>,
): LinkAs {
  const [said, say] = useState('');
  const [changing, setChanging] = useState<{ edgeId: string; opener: HTMLElement } | null>(null);
  const nameOf = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      return node === undefined ? 'a card' : endName(node);
    },
    [nodes],
  );
  const keyboard = useKeyboardLink(nodes, drawing, stage, nameOf, say);
  const { pending, setPending, linking } = drawing;

  const saved = ctl.edges.find((e) => e.id === changing?.edgeId)?.data?.edge;
  const gone =
    pending !== null &&
    !(nodes.some((n) => n.id === pending.from) && nodes.some((n) => n.id === pending.to));
  useEffect(() => {
    if (changing !== null && saved === undefined) setChanging(null);
    if (gone) setPending(null);
  }, [changing, saved, gone, setPending]);
  const request = useMemo((): LinkRequest | null => {
    if (pending !== null) return { mode: 'new', ...pending };
    if (saved === undefined || changing === null) return null;
    return {
      mode: 'change',
      from: saved.from_node_id,
      to: saved.to_node_id,
      fromPort: saved.from_port,
      toPort: saved.to_port,
      current: saved.kind,
      returnTo: changing.opener,
    };
  }, [pending, saved, changing]);

  const target = keyboard.target;
  const preview = useMemo((): ThreadPreviewProps | null => {
    if (pending !== null) {
      const { from, fromPort, to, toPort } = pending;
      return { from, fromPort, to, toPort };
    }
    if (target === null || linking === null || !isOutPort(linking.port)) return null;
    return { from: linking.nodeId, fromPort: linking.port, to: target.id, toPort: target.toPort };
  }, [pending, target, linking]);

  const choose = useCallback(
    (kind: EdgeKind, label: string | null) => {
      if (pending === null) {
        // Saved locally at once (the controller's rule); a failed save says so and reloads.
        if (changing !== null && kind !== saved?.kind) {
          ctl.patchEdge(changing.edgeId, { kind });
          say(`Now linked as ${kindLabel(kind)}.`);
        }
        setChanging(null);
        return;
      }
      setPending(null);
      const ports = { from_port: pending.fromPort, to_port: pending.toPort };
      void ctl.connect(pending.from, pending.to, kind, label, ports);
    },
    [pending, changing, saved, ctl, setPending],
  );

  const cancel = useCallback(() => {
    setChanging(null);
    setPending(null);
  }, [setPending]);

  const changeKind = useCallback(
    (edgeId: string, opener: HTMLElement) => setChanging({ edgeId, opener }),
    [],
  );

  return { request, preview, choose, cancel, changeKind, keyboard, said };
}
