/**
 * #204's summary view model on the REAL cached summary of frame 04d ("Attention Is All You Need":
 * 8 bullets, 3 not supported, 11 citations over 7 blocks on 6 pages) and the golden thread of
 * frame 04: shared passage numbers, the counting rule (the frame's 10 vs the data's 11), the trace
 * by page, "not verified", and the footer's facts.
 */
import { describe, expect, it } from 'vitest';

import { numberPassages } from './passages';
import { buildSummary, shortModelName, summaryDay } from './summary';
import { goldenMessages } from '../../../../test/fixtures/attention-thread';
import raw from '../../../../test/fixtures/attention-summary.json';

import type { Summary } from '@/lib/api/types';

const SUMMARY = (raw as unknown as { summary: Summary }).summary;
const thread = numberPassages(goldenMessages().filter((m) => m.role === 'assistant'));

describe('the summary as an exchange (frame 04d)', () => {
  it('a passage the thread cited keeps its number; new ones continue after the thread', () => {
    const model = buildSummary(SUMMARY, thread);
    // The Abstract is the thread's passage 1 (same block, same generation); the thread stops at 4.
    expect(Object.fromEntries(model.handleNumbers)).toEqual({
      b1: 1,
      b3: 5,
      b4: 6,
      b5: 7,
      b6: 8,
      b8: 9,
      b7: 10,
    });
    expect(model.bullets.map((b) => b.paragraph.markers.map((m) => m.n))).toEqual([
      [1],
      [1],
      [5],
      [6],
      [7],
      [1, 8],
      [1, 9],
      [10, 9],
    ]);
  });

  it('with no thread open the summary numbers its own passages 1..7', () => {
    const model = buildSummary(SUMMARY, null);
    expect([...new Set(model.trace.map((r) => r.n))].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('counts a citation as one bullet citing one passage, and says so exactly', () => {
    const model = buildSummary(SUMMARY, null);
    // 11, not the frame's 10: the last bullet cites two different blocks of p. 10, which the
    // frame's per-page trace merged into one.
    expect(model.readout).toBe(
      'Stands on 7 passages on 6 pages · 8 bullets · 11 citations · 3 bullets not verified',
    );
    const twice: Summary = {
      ...SUMMARY,
      bullets: [{ ...(SUMMARY.bullets[0] as Summary['bullets'][number]), text: 'A [b1]. B [b1].' }],
    };
    expect(
      buildSummary({ ...twice, bullets: [...twice.bullets, ...twice.bullets] }, null).readout,
    ).toBe('Stands on 1 passage on 1 page · 2 bullets · 2 citations');
  });

  it('marks not verified per bullet, and the trace by page with section names', () => {
    const model = buildSummary(SUMMARY, null);
    expect(
      model.bullets.map((b) => [b.supported, b.paragraph.markers.map((m) => m.notVerified)]),
    ).toEqual([
      [true, [false]],
      [true, [false]],
      [true, [false]],
      [false, [true]],
      [false, [true]],
      [true, [false, false]],
      [false, [true, true]],
      [true, [false, false]],
    ]);
    expect(
      model.trace.map((r) => [r.page, r.n, r.where, r.citedCount, r.status, r.note ?? '']),
    ).toEqual([
      [1, 1, 'Abstract', 4, 'cited', '1 not verified'],
      [2, 2, 'Background', 1, 'cited', ''],
      [3, 3, 'Decoder:', 1, 'not-verified', ''],
      [7, 4, '5.1 Training Data and Batching', 1, 'not-verified', ''],
      [8, 5, '6.1 Machine Translation', 1, 'cited', ''],
      [10, 6, 'Conclusion', 2, 'cited', '1 not verified'],
      [10, 7, 'Conclusion', 1, 'cited', ''],
    ]);
    expect(model.trace.every((r) => r.quote.length > 0 && r.para === null)).toBe(true);
  });

  it('the footer facts come from the stored summary', () => {
    expect(summaryDay(SUMMARY.created_at, 'UTC')).toBe('15 Oct');
    expect(shortModelName(SUMMARY.model)).toBe('M3');
    expect(shortModelName('MiniMax-M3.1-Flash-Preview')).toBe('M3.1 Flash');
  });
});
