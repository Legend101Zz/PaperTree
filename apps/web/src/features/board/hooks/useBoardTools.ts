'use client';

/**
 * board/hooks/useBoardTools — what each of the board's tools does now (#214): from the selection,
 * the thread being drawn and the view. Every write still goes through the controller; the view
 * (fit, zoom, the middle of the view for Add frame) goes through xyflow.
 */
import { useReactFlow, type FitViewOptions } from '@xyflow/react';
import { type RefObject } from 'react';

import { threadTool } from '../model/chrome';

import type { BoardController } from './useBoardController';
import type { BoardHistory } from './useBoardHistory';
import type { BoardSelection } from './useBoardSelection';
import type { LinkAs } from './useLinkAs';
import type { ThreadDrawing } from './useThreadDrawing';
import type { BoardTool, BoardToolbarProps } from '../components/BoardToolbar';
import type { PtEdge, PtNode } from '../model/flow';

/** What the tools act on. */
export interface BoardToolsInput {
  readonly ctl: BoardController;
  readonly selection: BoardSelection;
  readonly drawing: ThreadDrawing;
  readonly link: LinkAs;
  readonly stage: RefObject<HTMLElement>;
  readonly areaMode: boolean;
  readonly setAreaMode: (next: boolean) => void;
  readonly fitOptions: FitViewOptions<PtNode>;
}

/** The history's keys, said in a tool's tooltip and given to assistive technology. */
const HISTORY_KEYS = {
  Undo: { said: 'Cmd/Ctrl+Z', aria: 'Meta+Z Control+Z' },
  Redo: { said: 'Shift+Cmd/Ctrl+Z', aria: 'Shift+Meta+Z Shift+Control+Z Control+Y' },
} as const;

/**
 * Undo or Redo, named by the step it would take back ("Undo move of 3 cards"), off when there is
 * none.
 *
 * @param verb Which of the two.
 * @param history The board's history.
 * @returns The tool.
 */
export function historyTool(verb: 'Undo' | 'Redo', history: BoardHistory): BoardTool {
  const name = verb === 'Undo' ? history.undoName : history.redoName;
  const keys = HISTORY_KEYS[verb];
  return {
    label: name === null ? verb : `${verb} ${name}`,
    icon: verb === 'Undo' ? 'undo' : 'redo',
    enabled: name !== null,
    hint: name === null ? `Nothing to ${verb.toLowerCase()}.` : `${verb} ${name} (${keys.said})`,
    shortcuts: keys.aria,
    run: () => void (verb === 'Undo' ? history.undo() : history.redo()),
  };
}

/**
 * The toolbar's tools for the board as it stands.
 *
 * @param input The controller, the selection, the thread drawing and the view's state.
 * @returns The props for `BoardToolbar`.
 */
export function useBoardTools(input: BoardToolsInput): BoardToolbarProps {
  const { ctl, selection, drawing, link, stage, areaMode, setAreaMode, fitOptions } = input;
  const flow = useReactFlow<PtNode, PtEdge>();
  const ready = ctl.status === 'ready';
  const kindOf = (id: string) => ctl.nodes.find((n) => n.id === id)?.data.node.kind;
  const cards = selection.nodes.filter((id) => kindOf(id) !== undefined && kindOf(id) !== 'group');
  const frames = selection.nodes.filter((id) => kindOf(id) === 'group');
  const thread = threadTool(cards.length, drawing.linking !== null);

  const viewCentre = (): { x: number; y: number } => {
    const r = stage.current?.getBoundingClientRect();
    if (r === undefined) return { x: 0, y: 0 };
    return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  return {
    select: {
      label: 'Select',
      icon: 'select',
      pressed: areaMode,
      hint: 'Drag across the board to select several cards. Shift, Ctrl or Cmd plus click adds a card.',
      run: () => setAreaMode(!areaMode),
    },
    addNote: { label: 'Add note', icon: 'note', enabled: ready, run: () => void ctl.addNote() },
    addFrame: {
      label: 'Add frame',
      icon: 'frame',
      enabled: ready,
      hint: 'An empty frame in the middle of the view; drop cards in it.',
      run: () => void ctl.addFrame(viewCentre()),
    },
    thread: {
      ...thread,
      pressed: drawing.linking !== null,
      run: () => {
        if (thread.action === 'cancel') drawing.cancel();
        if (thread.action === 'walk' && cards[0] !== undefined) link.keyboard.start(cards[0]);
        if (thread.action === 'link' && cards[0] !== undefined && cards[1] !== undefined)
          drawing.link(cards[0], cards[1]);
      },
    },
    undo: historyTool('Undo', ctl.history),
    redo: historyTool('Redo', ctl.history),
    fitAll: {
      label: 'Fit all',
      icon: 'fit',
      enabled: ready && ctl.nodes.length > 0,
      run: () => void flow.fitView(fitOptions),
    },
    zoom: (direction) => void (direction === 'in' ? flow.zoomIn() : flow.zoomOut()),
    more: [
      {
        label: 'Frame selected cards',
        enabled: cards.length >= 2,
        hint: 'Put a frame round the selected cards. Select two or more first.',
        run: () => void ctl.groupNodes(cards),
      },
      {
        label: 'Remove frame',
        enabled: frames.length > 0,
        hint: 'Remove the selected frame. Its cards stay on the board.',
        run: () => ctl.deleteNodes(frames),
      },
      {
        label: 'Delete',
        danger: true,
        enabled: selection.nodes.length + selection.edges.length > 0,
        hint: 'Delete what is selected. Undo brings it back.',
        run: () => ctl.deleteSelection(selection.nodes, selection.edges),
      },
    ],
  };
}
