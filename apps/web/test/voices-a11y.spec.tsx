/**
 * voices-a11y.spec — axe over the v0.2 trace, AI slip and call slip together (#224).
 *
 * Same limits as a11y.spec.tsx: happy-dom has no layout or stylesheet, so colour-contrast and
 * target-size are not measured here (contrast is covered by packages/ui/test/tokens.spec.ts; real
 * target size is NOT CONFIRMED until S1d's page runs in a browser). Everything else runs.
 */
import axe from 'axe-core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AiSlip, CallSlip, CoverageReadout, NumberedMarker, TraceList } from '@papertree/ui';

afterEach(cleanup);

const ROWS = [
  { n: 1, page: 1, para: 1, where: 'Abstract', citedCount: 1, quote: 'A quote.', status: 'cited' },
  {
    n: 2,
    page: 2,
    para: 2,
    where: 'Introduction',
    citedCount: 2,
    quote: 'Another quote.',
    status: 'not-verified',
  },
] as const;

describe('axe over the voices', () => {
  for (const layout of ['desktop', 'touch'] as const) {
    it(`has no serious or critical violations (${layout})`, async () => {
      const { container } = render(
        <main>
          <CallSlip quote={{ text: 'A quote.', page: 1, para: 1 }} ask="Why?" time="2:14 pm" />
          <AiSlip
            model="M3.1 Flash"
            source="from the paper"
            aside={<NumberedMarker n={1} label="p. 1 ¶1" onFlash={() => undefined} />}
            footer={<CoverageReadout passages={2} citations={3} uncitedParagraphs={1} />}
            uncited={<p>My own reading.</p>}
          >
            <p>A claim.</p>
          </AiSlip>
          <TraceList rows={ROWS} lit={2} layout={layout} onShowInPaper={() => undefined} />
        </main>,
      );
      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
          region: { enabled: false },
        },
      });
      const bad = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120) ?? ''}`)).toEqual([]);
      expect(results.passes.length).toBeGreaterThan(5);
    });
  }
});
