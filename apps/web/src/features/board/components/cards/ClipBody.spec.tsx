import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClipBody } from './ClipBody';

const update = vi.fn();
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  useNodeId: () => 'cn_1',
  useUpdateNodeInternals: () => update,
}));

afterEach(() => {
  cleanup();
  update.mockClear();
  vi.restoreAllMocks();
});

describe('ClipBody and the card’s handles', () => {
  it('never re-measures on mount, even under React’s dev re-run (it would fit the board early)', () => {
    render(
      <StrictMode>
        <ClipBody>
          <p>words</p>
        </ClipBody>
      </StrictMode>,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('re-measures once on each fold and unfold, so threads follow the pins', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
    render(
      <StrictMode>
        <ClipBody>
          <p>long words</p>
        </ClipBody>
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('cn_1');
    fireEvent.click(screen.getByRole('button', { name: 'less' }));
    expect(update).toHaveBeenCalledTimes(2);
  });
});
