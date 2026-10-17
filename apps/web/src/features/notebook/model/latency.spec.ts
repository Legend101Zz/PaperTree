/** latency.spec — the arithmetic of the ink latency probe (#209). */
import { describe, expect, it } from 'vitest';

import { eventToFrame, percentile, summarise } from './latency';

describe('ink latency arithmetic', () => {
  it('takes nearest-rank percentiles', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
  });

  it('summarises in any order', () => {
    expect(summarise([9, 1, 5, 3, 7])).toEqual({ n: 5, median: 5, p95: 9, max: 9 });
    expect(summarise([]).n).toBe(0);
  });

  it('pairs each event with the first frame at or after it', () => {
    expect(eventToFrame([1, 5, 16.7], [4, 16.7, 33.4])).toEqual([3, 11.7, 0]);
  });

  it('measures to when the writing frame was shown, not to an earlier frame', () => {
    // The event at 101 missed the write at 100; it is drawn at 116.5 and shown at 133.
    expect(eventToFrame([101], [100, 116.5], [116, 133])).toEqual([32]);
  });

  it('leaves out an event no frame followed, rather than counting it as fast', () => {
    expect(eventToFrame([1, 50], [10])).toEqual([9]);
  });
});
