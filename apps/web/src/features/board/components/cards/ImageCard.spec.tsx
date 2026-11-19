/**
 * The image card (v0.3 #348, item 5): the crop (asked of `crop-url`), its caption, the quiet source
 * "Fig. 4 · p. 6" that opens the paper on it, the Ask edge every card has, and alt text that is the
 * caption plus the first answer's TL;DR. A passage's anchor still draws the passage.
 */
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cropQuery } from '@/lib/api/crops';
import { clearCropCache } from '@/lib/useCropUrl';

import { branchActions } from '../../../../../test/branch-harness';
import { toFlowNode, type PtNode } from '../../model/flow';
import { askAnchorFixture } from '../../model/imageFixtures';
import { node, resetClock } from '../../model/treeFixtures';
import { CanvasActionsProvider, type CanvasActions } from '../BoardContext';
import { BranchProvider } from '../BranchContext';
import { PassageCard } from './PassageCard';

import type { CanvasNode } from '@/lib/api/types';

const crops = vi.hoisted(() => ({ url: vi.fn() }));
vi.mock('@/lib/api/crops', async (original) => ({
  ...(await original<typeof import('@/lib/api/crops')>()),
  cropsApi: crops,
}));

const CAPTION = 'Figure 4. Training on CIFAR-10. Dashed lines denote training error.';
const ACTIONS: CanvasActions = {
  editingId: null,
  setEditingId: vi.fn(),
  commitBody: vi.fn(),
  commitTitle: vi.fn(),
  commitSize: vi.fn(),
};
const CROP = {
  url: 'https://crops.example/f4.png?sig=1',
  expires_at: '2999-01-01T00:00:00+00:00',
  dpi: 400,
  width: 1400,
  height: 900,
};

const props = (row: CanvasNode): NodeProps<PtNode> =>
  ({
    ...toFlowNode(row, 'ppr_1'),
    selected: false,
    dragging: false,
  }) as unknown as NodeProps<PtNode>;

function image(over: Partial<CanvasNode> = {}): CanvasNode {
  return { ...node({ id: 'img', body: CAPTION }), source_anchor: askAnchorFixture(5), ...over };
}

/** The loaded picture: while it loads the place is held by a `role=img` placeholder of its own. */
async function picture(): Promise<HTMLImageElement> {
  await waitFor(() => expect(document.querySelector('img')).not.toBeNull());
  return document.querySelector('img') as HTMLImageElement;
}

function mount(root: CanvasNode, rows: readonly CanvasNode[] = [root]) {
  const branch = branchActions(rows);
  render(
    <ReactFlowProvider>
      <CanvasActionsProvider value={ACTIONS}>
        <BranchProvider value={branch}>
          <PassageCard {...props(root)} />
        </BranchProvider>
      </CanvasActionsProvider>
    </ReactFlowProvider>,
  );
  return branch;
}

beforeEach(() => {
  resetClock();
  clearCropCache();
  crops.url.mockReset();
  crops.url.mockResolvedValue(CROP);
});
afterEach(cleanup);

describe('an excerpt whose anchor is a picture', () => {
  it('shows the crop of its page and rectangle, its caption, and "Fig. 4 · p. 6"', async () => {
    mount(image());
    const img = await picture();
    expect(img.getAttribute('src')).toBe(CROP.url);
    expect(img.getAttribute('width')).toBe('1400');
    expect(crops.url).toHaveBeenCalledWith('ppr_test', { page: 5, box: [100, 120, 400, 300] });
    expect(cropQuery({ page: 5, box: [100, 120, 400, 300] })).toBe(
      'page=5&x0=100.00&y0=120.00&x1=400.00&y1=300.00',
    );
    expect(screen.getByText(CAPTION)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Show Fig. 4 · p. 6 in the paper' }).textContent,
    ).toBe('Fig. 4 · p. 6');
    expect(screen.getByRole('group', { name: 'Picture from the paper' })).toBeTruthy();
  });

  it('the source opens the paper on it, and the Ask edge opens the ask box, as on a passage', async () => {
    const branch = mount(image());
    await picture();
    fireEvent.click(screen.getByRole('button', { name: /Show Fig\. 4/ }));
    expect(branch.openSource).toHaveBeenCalledWith('img');
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this card' }));
    expect(branch.control.openAsk).toHaveBeenCalledWith('img');
  });

  it('alt text is the caption and the first answer’s TL;DR once there is an answer', async () => {
    const answer = node({
      id: 'a',
      parent: 'img',
      branch: 'right',
      finalText: '## TL;DR\nDepth hurts the plain net.\n\n## In plain words\nMore.',
    });
    mount(image(), [image(), answer]);
    const img = await picture();
    expect(img.getAttribute('alt')).toBe(`${CAPTION} Depth hurts the plain net.`);
  });

  it('says so in words when the crop cannot be made, and keeps the caption', async () => {
    crops.url.mockRejectedValue(new Error('404'));
    mount(image());
    await waitFor(() => expect(screen.getByText(/The picture could not be loaded/)).toBeTruthy());
    expect(screen.getByText(CAPTION)).toBeTruthy();
  });

  it('asks the server once for one rectangle, however many cards draw it', async () => {
    mount(image());
    await picture();
    cleanup();
    mount(image());
    await picture();
    expect(crops.url).toHaveBeenCalledTimes(1);
  });
});

describe('a passage', () => {
  it('still draws its words, not a picture', () => {
    render(
      <ReactFlowProvider>
        <CanvasActionsProvider value={ACTIONS}>
          <BranchProvider value={branchActions()}>
            <PassageCard {...props(node({ id: 'p', body: 'Residual learning.' }))} />
          </BranchProvider>
        </CanvasActionsProvider>
      </ReactFlowProvider>,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/Residual learning\./)).toBeTruthy();
    expect(crops.url).not.toHaveBeenCalled();
  });
});
