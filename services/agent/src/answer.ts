/**
 * The explain / ask answer after the model wrote it (v0.3, #339; the shape is contracts.md §3.2.2):
 * Markdown with an optional ```diagram fence and, when the request says `check: true`, one
 * ```check fence. The model is trusted with neither, so `tidyAnswer` runs on `done.final_text`, the
 * text the API stores:
 *
 *   diagram  at most one; its lines are validated with the diagram run's own reader (diagram.ts),
 *            invalid lines dropped; a fence with no part left, or a second one, is removed
 *   check    at most one, and only when `check` is true; exactly the four keys `prompt`, `accept`,
 *            `right`, `hint`, each with a value, else the fence is removed
 *   a fence the model never closed (a cut-off answer) is removed
 *
 * Everything outside those two fences is left as written, and a text with nothing to fix comes back
 * unchanged, so it is idempotent and a clean answer still equals the `text` deltas that streamed.
 */
import { cleanDiagramFence } from './diagram.ts';

/** The four keys of a ```check fence, in the order they are written back. */
export const CHECK_KEYS = ['prompt', 'accept', 'right', 'hint'] as const;

/** A fence line: ``` or ```lang (the opening line may carry text after the language; it is kept). */
const OPEN = /^```([A-Za-z0-9_-]*)[ \t]*$/;
const CLOSE = /^```[ \t]*$/;

/** The check fence's body as canonical lines, or null when it is not exactly the four keys. */
export function cleanCheckFence(body: string): string | null {
  const values = new Map<string, string>();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon <= 0) return null;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (!(CHECK_KEYS as readonly string[]).includes(key) || values.has(key)) return null;
    values.set(key, line.slice(colon + 1).trim());
  }
  if (values.size !== CHECK_KEYS.length) return null;
  if (CHECK_KEYS.some((key) => (values.get(key) ?? '') === '')) return null;
  const accept = (values.get('accept') ?? '')
    .split('|')
    .map((fill) => fill.trim())
    .filter((fill) => fill !== '');
  if (accept.length === 0) return null;
  return CHECK_KEYS.map(
    (key) => `${key}: ${key === 'accept' ? accept.join(' | ') : values.get(key)}`,
  ).join('\n');
}

/**
 * @param text - `final_text` of an explain or ask run.
 * @param check - Whether the request asked for a check fence.
 * @param diagram - Whether a diagram fence may stay (false: the request said `diagram: never`).
 * @returns The text with the fences tidied as described above.
 */
export function tidyAnswer(text: string, check: boolean, diagram = true): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let diagrams = 0;
  let checks = 0;
  let i = 0;
  let removed = false;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const open = OPEN.exec(line.trimEnd());
    if (open === null || line.startsWith(' ')) {
      out.push(line);
      i++;
      continue;
    }
    const lang = (open[1] ?? '').toLowerCase();
    let end = i + 1;
    while (end < lines.length && !CLOSE.test((lines[end] ?? '').trimEnd())) end++;
    const closed = end < lines.length;
    const body = lines.slice(i + 1, end).join('\n');
    const next = closed ? end + 1 : end;
    if (lang !== 'diagram' && lang !== 'check') {
      out.push(...lines.slice(i, next)); // any other fence (code) is the answer's own
      i = next;
      continue;
    }
    let kept: string | null = null;
    if (closed) {
      if (lang === 'diagram' && diagrams === 0 && diagram) kept = cleanDiagramFence(body);
      if (lang === 'check' && checks === 0 && check) kept = cleanCheckFence(body);
    }
    if (kept === null) removed = true;
    else {
      if (lang === 'diagram') diagrams++;
      else checks++;
      out.push(`\`\`\`${lang}`, kept, '```');
    }
    i = next;
  }
  if (!removed && out.join('\n') === text) return text;
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
