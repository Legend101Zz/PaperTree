/** S9-3: the badge's screen-reader sentence must not begin with stray punctuation. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProcessingBadge } from '@/components/library/primitives';
import { PROCESSING_DETAIL, type ProcessingState } from '@/components/library/types';

describe('ProcessingBadge screen-reader text', () => {
  it.each(Object.keys(PROCESSING_DETAIL) as ProcessingState[])('%s has no leading punctuation', (state) => {
    const { container } = render(<ProcessingBadge state={state} />);
    const hidden = container.querySelector('.sr-only');
    expect(hidden).not.toBeNull();
    expect(hidden?.textContent?.trim()).toBe(PROCESSING_DETAIL[state]);
    expect(hidden?.textContent).not.toMatch(/^\s*[.,;:]/);
    expect(container.textContent).not.toMatch(/\s\.\s/);
  });
});
