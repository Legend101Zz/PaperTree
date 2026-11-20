/**
 * The text layer's `endOfContent` div is put back after the press is over, not during its pointerup:
 * it can be the pointer's target (it covers the layer while a selection exists), and moving it in the
 * DOM then makes Chrome drop the `click` (e2e image-ask: Shift+click a figure with words selected).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { attachSelectionEnd } from '@/components/reader/textLayerSelection';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('attachSelectionEnd: reset after the click', () => {
  it('leaves endOfContent where it is until the pointerup has been fully dispatched', async () => {
    const layer = document.createElement('div');
    layer.className = 'papertree-text-layer';
    document.body.append(layer);
    const detach = attachSelectionEnd(layer);
    const end = layer.querySelector('.endOfContent') as HTMLElement;
    // Something after it, so putting it back (an `append`) would be a visible move.
    const later = document.createElement('span');
    layer.append(later);
    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(layer.classList.contains('selecting')).toBe(true);

    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(layer.lastElementChild).toBe(later); // not moved during the pointerup
    expect(layer.classList.contains('selecting')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(layer.lastElementChild).toBe(end); // put back once the click has gone
    expect(layer.classList.contains('selecting')).toBe(false);
    detach();
  });
});
