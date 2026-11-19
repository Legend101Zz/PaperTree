/**
 * "Check yourself" (v0.3 answer format §1): one sentence with a blank, marked in the browser with
 * no model call. The model writes a ```check fence of exactly four keys:
 *
 *   prompt: If $F(x) = 0$, the block outputs ___.
 *   accept: x | the input | input | its input
 *   right: Right. $0 + x = x$: the block hands its input straight on.
 *   hint: Put 0 in place of $F(x)$ in $F(x) + x$ and see what is left.
 *
 * Pure: reading the fence, comparing a fill, and the small state machine the block runs.
 */

/** A check, read from its fence. */
export interface CheckSpec {
  /** The sentence; `___` marks the blank. */
  readonly prompt: string;
  /** The fills that are right, as written (compared after `normalizeFill`). */
  readonly accept: readonly string[];
  /** Shown when the fill is right. */
  readonly right: string;
  /** Shown, once, when it is not. */
  readonly hint: string;
}

type CheckKey = 'prompt' | 'accept' | 'right' | 'hint';

/**
 * The check a check fence holds, or null when it is not a whole one (a missing key, or a
 * prompt with nothing to accept): a half-formed check is never drawn.
 *
 * @param body The text between the fences.
 * @returns The check, or null.
 */
export function parseCheck(body: string): CheckSpec | null {
  const values = new Map<CheckKey, string>();
  let last: CheckKey | null = null;
  for (const line of body.split('\n')) {
    const match = /^\s*(prompt|accept|right|hint)\s*:\s*(.*)$/i.exec(line);
    if (match !== null) {
      last = (match[1] as string).toLowerCase() as CheckKey;
      values.set(last, (match[2] ?? '').trim());
    } else if (last !== null && line.trim() !== '') {
      // A value that wrapped onto the next line belongs to the key before it.
      values.set(last, `${values.get(last) ?? ''} ${line.trim()}`.trim());
    }
  }
  const prompt = values.get('prompt') ?? '';
  const accept = (values.get('accept') ?? '')
    .split('|')
    .map((fill) => fill.trim())
    .filter((fill) => normalizeFill(fill) !== '');
  if (prompt === '' || accept.length === 0) return null;
  return { prompt, accept, right: values.get('right') ?? '', hint: values.get('hint') ?? '' };
}

/**
 * A fill as it is compared: lower-cased, trimmed, with every `$` removed and the punctuation
 * around it stripped, inner spaces collapsed. "  The Input. " and "$x$" both match what a reader
 * would call the same answer.
 *
 * @param fill What was typed, or an accepted fill.
 * @returns The comparable form.
 * @example
 * normalizeFill(' The  input. '); // 'the input'
 */
export function normalizeFill(fill: string): string {
  return fill
    .toLowerCase()
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

/**
 * Whether a typed fill is one of the accepted ones.
 *
 * @param spec The check.
 * @param typed What the reader typed.
 * @returns True when it matches (never for an empty blank).
 */
export function isRight(spec: CheckSpec, typed: string): boolean {
  const fill = normalizeFill(typed);
  return fill !== '' && spec.accept.some((accepted) => normalizeFill(accepted) === fill);
}

/** Where a check is. `wrong` has shown its hint; the blank stays open. */
export type CheckPhase = 'idle' | 'wrong' | 'right' | 'shown' | 'skipped';

/** One check's state: what is typed, and its phase. */
export interface CheckState {
  readonly value: string;
  readonly phase: CheckPhase;
}

/** A check nobody has touched. */
export const FRESH_CHECK: CheckState = { value: '', phase: 'idle' };

/**
 * The state after the reader presses Enter: a right fill closes it, a wrong one shows the hint
 * (the check's one hint; a second wrong fill shows the same one, never another) and keeps the blank
 * open, and an empty blank does nothing.
 *
 * @param spec The check.
 * @param state Where it is.
 * @returns The next state.
 */
export function submitCheck(spec: CheckSpec, state: CheckState): CheckState {
  if (state.phase === 'right' || state.phase === 'shown' || state.phase === 'skipped') return state;
  if (normalizeFill(state.value) === '') return state;
  return { ...state, phase: isRight(spec, state.value) ? 'right' : 'wrong' };
}

/**
 * "Show me": the first accepted fill goes into the blank and the check closes as right.
 *
 * @param spec The check.
 * @returns The state.
 */
export function showCheck(spec: CheckSpec): CheckState {
  return { value: spec.accept[0] ?? '', phase: 'shown' };
}

/**
 * Typing: the value changes, and a shown hint steps aside as the reader edits (the prototype's
 * behaviour: the hint came with an Enter and goes with the next keystroke). A closed check cannot
 * be typed over.
 *
 * @param state Where it is.
 * @param value The new text.
 * @returns The next state.
 */
export function typeCheck(state: CheckState, value: string): CheckState {
  return state.phase === 'right' || state.phase === 'shown' || state.phase === 'skipped'
    ? state
    : { value, phase: 'idle' };
}

/**
 * The blank's sentence cut at the blank: `before`, then the input, then `after`. A prompt with no
 * `___` puts the blank at its end, so a check is never lost for want of one.
 *
 * @param prompt The sentence.
 * @returns The two halves.
 */
export function splitPrompt(prompt: string): { before: string; after: string } {
  const at = /_{3,}/.exec(prompt);
  if (at === null) return { before: `${prompt} `, after: '' };
  return { before: prompt.slice(0, at.index), after: prompt.slice(at.index + at[0].length) };
}
