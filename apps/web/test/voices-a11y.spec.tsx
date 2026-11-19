/**
 * voices-a11y.spec — axe over the call slip and the AI slip with its quiet source lines (#224, #340).
 *
 * Same limits as a11y.spec.tsx: happy-dom has no layout or stylesheet, so colour-contrast and
 * target-size are not measured here (contrast is covered by packages/ui/test/tokens.spec.ts; real
 * target size is NOT CONFIRMED until S1d's page runs in a browser). Everything else runs.
 */
import axe from 'axe-core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AiParagraph, AiSlip, CallSlip, SourceLine } from '@papertree/ui';

afterEach(cleanup);

const noop = (): void => undefined;

describe('axe over the voices', () => {
  for (const touch of [false, true]) {
    it(`has no serious or critical violations (${touch ? 'touch' : 'desktop'})`, async () => {
      const { container } = render(
        <main>
          <CallSlip quote={{ text: 'A quote.', page: 1, para: 1 }} ask="Why?" time="2:14 pm" />
          <AiSlip model="M3.1 Flash" footer={<span>12 tokens (estimate)</span>}>
            <AiParagraph
              source={
                <SourceLine
                  touch={touch}
                  sources={[
                    { page: 1, passage: 'A quote from the paper.', onShow: noop },
                    { page: 4, passage: 'Another passage.', onShow: noop },
                  ]}
                />
              }
            >
              A claim.
            </AiParagraph>
            <AiParagraph source={<SourceLine sources={[]} />}>An idea of the AI’s own.</AiParagraph>
          </AiSlip>
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
