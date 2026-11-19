/**
 * #204's summary view model on the REAL cached summary of frame 04d ("Attention Is All You Need":
 * 8 bullets, 11 citations over 7 blocks on 6 pages), as #340/#341 draw it: each bullet with the
 * pages it draws on, once each in page order, and the footer's facts. No readout, no passage list.
 */
import { describe, expect, it } from 'vitest';

import { buildSummary, shortModelName, summaryDay } from './summary';
import raw from '../../../../test/fixtures/attention-summary.json';

import type { Summary } from '@/lib/api/types';

const SUMMARY = (raw as unknown as { summary: Summary }).summary;

describe('the summary as an exchange (frame 04d, #340)', () => {
  it('gives each bullet the pages it cites, once each, in page order', () => {
    const model = buildSummary(SUMMARY);
    expect(model.bullets.map((b) => b.sources.map((s) => s.page))).toEqual([
      [1],
      [1],
      [2],
      [3],
      [7],
      [1, 8],
      [1, 10],
      [10], // two handles on p. 10 are one page
    ]);
    expect(model.bullets.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the bullet text with its handles (the renderer drops them) and the citation to flash', () => {
    const [first] = buildSummary(SUMMARY).bullets;
    expect(first?.text).toMatch(/\[b1\]/);
    expect(first?.sources[0]?.citation.marker).toBe('b1');
    expect(first?.sources[0]?.passage.length).toBeGreaterThan(0);
  });

  it('a bullet with no citation has no source (the screen says "General knowledge")', () => {
    const bare: Summary['bullets'][number] = { text: 'An overall claim.', citations: [] };
    const model = buildSummary({ ...SUMMARY, bullets: [...SUMMARY.bullets, bare] });
    expect(model.bullets.at(-1)?.sources).toEqual([]);
  });

  it('lists the pages in the order a bullet cites its handles, then by page', () => {
    const swapped: Summary = {
      ...SUMMARY,
      bullets: [
        {
          text: 'A [b6]. B [b1].',
          citations: (SUMMARY.bullets[5] as Summary['bullets'][number]).citations,
        },
      ],
    };
    expect(buildSummary(swapped).bullets[0]?.sources.map((s) => s.page)).toEqual([1, 8]);
  });

  it('the footer facts come from the stored summary', () => {
    expect(summaryDay(SUMMARY.created_at, 'UTC')).toBe('15 Oct');
    expect(shortModelName(SUMMARY.model)).toBe('M3');
    expect(shortModelName('MiniMax-M3.1-Flash')).toBe('M3.1 Flash');
  });
});
