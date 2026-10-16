/**
 * Ink latency arithmetic (S5d, #209, DESIGN.md §6, ADR-004 §5): pairs each pointer event's time
 * with the first frame time at or after it (when the live stroke that carries its point was written,
 * or shown), and summarises the gaps. Pure, so the browser probe that measures the draw path and the
 * tests run the same code. All times are `performance.now()` milliseconds (an event's `timeStamp`
 * is on that clock).
 */

/** Median, p95 and worst of a set of latencies, in ms. */
export interface LatencySummary {
  readonly n: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

/**
 * Nearest-rank percentile.
 *
 * @param sorted - Samples in ascending order (at least one).
 * @param p - The percentile, 0 to 100.
 * @returns The sample at that rank.
 */
export function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN;
}

/**
 * Summarises latencies.
 *
 * @param samples - Latencies in ms, any order.
 * @returns n, median (p50), p95 and max; NaN for no samples.
 */
export function summarise(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

/**
 * For each event, the time to the first frame at or after it: the frame that drew its point. An
 * event after the last frame never reached the screen and is left out, never counted as fast.
 *
 * @param events - Pointer event times.
 * @param frames - When each frame wrote the stroke, ascending.
 * @param shownAt - When each of those frames was on screen (the next frame's time); defaults to
 *   `frames`, which measures to the write.
 * @returns One latency per event that a frame followed.
 * @example
 * eventToFrame([1, 5], [4, 20]); // [3, 15]
 * eventToFrame([1, 5], [4, 20], [17, 33]); // [16, 28]
 */
export function eventToFrame(
  events: readonly number[],
  frames: readonly number[],
  shownAt: readonly number[] = frames,
): number[] {
  const out: number[] = [];
  for (const t of events) {
    const i = frames.findIndex((f) => f >= t);
    const shown = shownAt[i];
    if (i >= 0 && shown !== undefined) out.push(shown - t);
  }
  return out;
}
