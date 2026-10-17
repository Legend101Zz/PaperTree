/**
 * A sideways row's numbers and its stylesheet agree (#196, review S3 and N10): the row window
 * counts with `ROW_GAP` and `ROW_BOOKEND`, and a spine the arrows focus must scroll clear of the
 * sticky "+n more" bookend (WCAG 2.4.11, Focus Not Obscured). Read from the real `library.css`, as
 * `library-gilt.spec.ts` does, so a change on one side alone fails here. axe cannot see a focus
 * hidden under a sticky element, which is why this test exists.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROW_BOOKEND, ROW_GAP, ROW_SCROLL_PADDING } from '@/features/library/model/states';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/library/components/library.css'),
  'utf8',
);

/** A declaration's px value inside the first rule whose selector is exactly `selector`. */
function px(selector: string, property: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\n)${escaped} \\{([^}]+)\\}`).exec(css)?.[1];
  if (rule === undefined) throw new Error(`${selector} is not in library.css`);
  const value = new RegExp(`(?:^|\\s)${property}:\\s*([\\d.]+)px`).exec(rule)?.[1];
  if (value === undefined) throw new Error(`${selector} has no ${property} in px`);
  return Number(value);
}

describe('a sideways row at scale', () => {
  it('counts with the gap and the bookend the stylesheet draws', () => {
    expect(px('.pt-rows__spines', 'gap')).toBe(ROW_GAP);
    expect(px('.pt-rows__more', 'inline-size') + px('.pt-rows__more', 'margin-inline-start')).toBe(
      ROW_BOOKEND,
    );
  });

  it('scrolls a focused spine clear of the sticky bookend', () => {
    expect(px('.pt-rows__spines', 'scroll-padding-inline-end')).toBe(ROW_SCROLL_PADDING);
    expect(ROW_SCROLL_PADDING).toBeGreaterThan(ROW_BOOKEND);
  });
});
