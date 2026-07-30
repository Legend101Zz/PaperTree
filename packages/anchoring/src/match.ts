/**
 * anchoring/match — approximate substring search, and the T3 composite score.
 *
 * WHY THIS IS NOT `approx-string-match`.
 *
 * `research/literature/13-highlight-anchoring.md` names `approx-string-match` (MIT, v2.0.0), the
 * bit-parallel Myers (1999) implementation Hypothesis uses, and it is the right reference. It is
 * not a dependency here for three reasons, in order of weight:
 *
 *   1. This package is shared by the web reader, the API and a Web Worker. A dependency that has to
 *      resolve in all three is a bundling liability for ~90 lines of arithmetic.
 *   2. The bit-parallel algorithm's speed only matters at a scale this data is nowhere near. Myers
 *      is O((k/w)·n); the banded DP below is O(n·m) but the search is per page in order of distance
 *      from the hint, so the realistic input is one page — ~3 000 code points against a ~100 code
 *      point quote, or 300 000 cell updates, which is single-digit milliseconds.
 *   3. Correctness here is checkable rather than trusted. `test/match.spec.ts` verifies this
 *      implementation against a brute-force Levenshtein oracle over every substring of randomised
 *      inputs. That is stronger evidence than an unverified dependency, and it is the whole reason
 *      to prefer a small algorithm you can test exhaustively over a large one you cannot.
 *
 * If profiling ever shows T3 dominating, the bit-parallel version drops in behind `search()`
 * unchanged — the oracle test is what makes that swap safe.
 *
 * THE HAZARD IS REAL EVEN SO. Hypothesis issue #3919 (open since 2021-11-11) reports fuzzy
 * anchoring blocking >10 s on long documents with short quotes, ~60 % of load time in
 * imperfect-match resolution. Those are user reports, not instrumentation, so they are a hazard
 * signal rather than a benchmark — but the two mitigations they imply are mandatory regardless and
 * are implemented in `resolve.ts`: cache every resolution (T0), and refuse short quotes that carry
 * no context (`MIN_QUOTE_WITHOUT_CONTEXT`).
 */

/** A match of the pattern inside the text, in code-point offsets, with its edit distance. */
export interface Match {
  readonly start: number;
  readonly end: number;
  readonly errors: number;
}

/**
 * Find the lowest-error occurrence of `pattern` in `text`, allowing at most `maxErrors`
 * substitutions, insertions and deletions. Returns `null` if none exists within the budget.
 *
 * The recurrence is the standard approximate-substring one: row 0 is all zeros, so a match may
 * begin at any position in the text at no cost, and the answer is the minimum of the final row.
 * Ties break toward the EARLIEST end offset, which makes the function deterministic — a matcher
 * that returns a different one of two equally good matches depending on iteration order produces
 * highlights that move on reload.
 *
 * `pattern` and `text` are arrays of CODE POINTS, not strings. Every offset in this package is
 * counted in code points (`Anchor.offsetUnit === 'unicode'`); taking strings here would silently
 * reintroduce UTF-16 units and drift the offsets, which is the exact failure `offsetUnit` exists to
 * make impossible.
 */
export function search(
  pattern: readonly number[],
  text: readonly number[],
  maxErrors: number,
): Match | null {
  const m = pattern.length;
  const n = text.length;
  if (m === 0 || n === 0) return null;
  const budget = Math.max(0, Math.floor(maxErrors));

  // `prev[i]` = edit distance between pattern[0..i) and the best suffix of text[0..j).
  // `startOf[i]` carries where that best suffix began, so the match's start offset comes out of
  // the same recurrence rather than from a second backward pass.
  const prev = new Int32Array(m + 1);
  const cur = new Int32Array(m + 1);
  const prevStart = new Int32Array(m + 1);
  const curStart = new Int32Array(m + 1);
  for (let i = 0; i <= m; i += 1) prev[i] = i;

  let best: Match | null = null;

  for (let j = 1; j <= n; j += 1) {
    cur[0] = 0;
    curStart[0] = j - 1; // a fresh match may start here at no cost
    const textChar = text[j - 1] as number;

    for (let i = 1; i <= m; i += 1) {
      const substitute = (prev[i - 1] as number) + ((pattern[i - 1] as number) === textChar ? 0 : 1);
      const deleteFromText = (prev[i] as number) + 1; // consume text, not pattern
      const insertIntoText = (cur[i - 1] as number) + 1; // consume pattern, not text

      let cost = substitute;
      let from = prevStart[i - 1] as number;
      if (deleteFromText < cost) {
        cost = deleteFromText;
        from = prevStart[i] as number;
      }
      if (insertIntoText < cost) {
        cost = insertIntoText;
        from = curStart[i - 1] as number;
      }
      cur[i] = cost;
      curStart[i] = from;
    }

    const errors = cur[m] as number;
    if (errors <= budget && (best === null || errors < best.errors)) {
      best = { start: curStart[m] as number, end: j, errors };
      if (errors === 0) {
        // Cannot do better, and an exact match is the common case worth short-circuiting.
        return best;
      }
    }

    prev.set(cur);
    prevStart.set(curStart);
  }

  return best;
}

/** Exact search over code points. The fast path — `indexOf` on the array, without stringifying. */
export function indexOfCodePoints(
  pattern: readonly number[],
  text: readonly number[],
  from = 0,
): number {
  const m = pattern.length;
  const n = text.length;
  if (m === 0 || m > n) return -1;
  const first = pattern[0] as number;
  outer: for (let i = Math.max(0, from); i + m <= n; i += 1) {
    if (text[i] !== first) continue;
    for (let k = 1; k < m; k += 1) {
      if (text[i + k] !== pattern[k]) continue outer;
    }
    return i;
  }
  return -1;
}

// ─── the composite score ────────────────────────────────────────────────────────────────────────

/**
 * Hypothesis's weights, read from `match-quote.ts`: quote 50, prefix 20, suffix 20, position 2.
 * Position is explicitly a tie-breaker and nothing more, which is why it is worth 2 and not 20.
 */
export const WEIGHT_QUOTE = 50;
export const WEIGHT_PREFIX = 20;
export const WEIGHT_SUFFIX = 20;
export const WEIGHT_POSITION = 2;
const WEIGHT_TOTAL = WEIGHT_QUOTE + WEIGHT_PREFIX + WEIGHT_SUFFIX + WEIGHT_POSITION;

/**
 * The anchored/approximate/orphan cut points.
 *
 * **These are a PROPOSAL, not a measured value, and this comment is the honest record of that.**
 * `match-quote.ts` returns the top-scored match unconditionally and lets the caller decide;
 * `13-highlight-anchoring.md` §9 states plainly that 0.72 and 0.60 are its author's suggestion and
 * need calibration against a PaperTree corpus. `test/reparse.spec.ts` reports the re-anchor rate at
 * several thresholds precisely so that the choice is visible and re-decidable rather than buried.
 */
export const SCORE_ANCHORED = 0.72;
export const SCORE_APPROXIMATE = 0.6;

/**
 * Reject quotes shorter than this unless BOTH prefix and suffix are present. T3 is superlinear in
 * practice on long documents with short, generic quotes, and a 4-character quote in a 30 000
 * character document is not an anchor, it is a coincidence generator.
 */
export const MIN_QUOTE_WITHOUT_CONTEXT = 10;

function similarity(errors: number, length: number): number {
  if (length === 0) return 1;
  return Math.max(0, 1 - errors / length);
}

/**
 * Score one candidate match. `hint` is the T2 offset; `textLength` scales the position term so the
 * tie-breaker means the same thing in a 2-page and a 200-page document.
 */
export function scoreMatch(args: {
  readonly quoteErrors: number;
  readonly quoteLength: number;
  readonly prefixErrors: number | null;
  readonly prefixLength: number;
  readonly suffixErrors: number | null;
  readonly suffixLength: number;
  readonly matchStart: number;
  readonly hint: number | null;
  readonly textLength: number;
}): number {
  const q = similarity(args.quoteErrors, args.quoteLength);
  // An absent context is scored 1 rather than 0: a quote at the very start of a document has no
  // prefix through no fault of its own, and penalising that would rank a mid-document coincidence
  // above the correct match.
  const p = args.prefixErrors === null ? 1 : similarity(args.prefixErrors, args.prefixLength);
  const s = args.suffixErrors === null ? 1 : similarity(args.suffixErrors, args.suffixLength);
  const pos =
    args.hint === null || args.textLength === 0
      ? 1
      : Math.max(0, 1 - Math.abs(args.matchStart - args.hint) / args.textLength);
  return (
    (WEIGHT_QUOTE * q + WEIGHT_PREFIX * p + WEIGHT_SUFFIX * s + WEIGHT_POSITION * pos) / WEIGHT_TOTAL
  );
}

/** `maxErrors = min(256, quoteLength / 2)`, per Hypothesis. */
export function maxErrorsFor(quoteLength: number): number {
  return Math.min(256, Math.floor(quoteLength / 2));
}
