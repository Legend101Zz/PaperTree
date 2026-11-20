/**
 * The figure step of an explain / ask / image answer, after the model has written it (v0.3 W6):
 * the owner's rule is that a diagram Flash writes never reaches the reader as a render error, and
 * is readable. `settleFigure` takes the answer text and returns it with its one ```mermaid fence
 * in a state that parses (with the REAL parser, mermaid-parse.ts) and is within the size caps, or
 * without the fence:
 *
 *   1. ok / tidy       the fence parses and is within the caps (tidy: after the always-on cosmetics)
 *   2. deterministic   `repairMermaid` (mermaid-repair.ts) fixes it with no model call
 *   3. model           ONE short repair request (the fence + the problem), counted in usage
 *   4. dropped         the fence is removed; the answer text stays
 *
 * `path` is what a round counts. If the parser itself is unavailable (no worker) and the caps hold,
 * the fence is kept as is (`unchecked`): the web still parses before it draws.
 *
 * The functions here are pure apart from `FigureDeps`, which the run supplies (the worker parse and
 * the model call), so every path is tested with fakes.
 */
import { tidyAnswer } from './answer.ts';
import { cleanMermaidFence } from './mermaid.ts';
import { FIGURE_CAPS, figureLimits, repairMermaid, tidyMermaidText } from './mermaid-repair.ts';
import type { ParseVerdict } from './mermaid-parse.ts';

export type FigurePath =
  'none' | 'ok' | 'tidy' | 'deterministic' | 'model' | 'dropped' | 'unchecked';

export interface FigureOutcome {
  readonly text: string;
  readonly path: FigurePath;
  /** The deterministic repairs applied to the kept fence (also when the model then fixed the rest). */
  readonly repairs: readonly string[];
  /** The problem that sent the fence to repair (the parser's words, or the cap that broke). */
  readonly problem: string | null;
  readonly parseMs: number;
  /** Whether a model repair request was made (its usage is the run's). */
  readonly modelCalled: boolean;
}

export interface FigureDeps {
  parse(body: string): Promise<ParseVerdict>;
  /**
   * One short model request: the corrected Mermaid code, or null (error, timeout, nothing back).
   * Absent: no model repair (the offline replay, tests).
   */
  repair?(prompt: string, system: string): Promise<string | null>;
}

/** The system prompt of the repair request: one job, no chat. */
export const REPAIR_SYSTEM =
  'You fix Mermaid 12 diagrams. Reply with only the corrected Mermaid code: no fence, no explanation.';

/** The caps in one line, for the repair request and for a test that keeps prompts.ts in step. */
export const CAPS_LINE =
  `flowchart TD, at most ${FIGURE_CAPS.flowNodes} nodes; mindmap one root, at most ` +
  `${FIGURE_CAPS.mindmapNodes} nodes, ${FIGURE_CAPS.mindmapDepth} levels, no parentheses in text; ` +
  `sequenceDiagram at most ${FIGURE_CAPS.participants} participants, ${FIGURE_CAPS.messages} messages; ` +
  `timeline at most ${FIGURE_CAPS.periods} periods, ${FIGURE_CAPS.eventsPerPeriod} short events each; ` +
  `quadrantChart at most ${FIGURE_CAPS.quadrantPoints} points; xychart-beta at most ` +
  `${FIGURE_CAPS.chartPoints} points`;

/** The user message of the repair request. */
export function repairPrompt(body: string, problem: string): string {
  return (
    `This Mermaid diagram does not work: ${problem}\n` +
    'Fix it, keeping the meaning. One statement per line; text with ( ) [ ] { } goes in quotes: ' +
    'A["text (x)"]; no <br>, no quotes in titles; simplify when over a cap. Caps: ' +
    `${CAPS_LINE}.\n\n${body}`
  );
}

interface Fence {
  readonly start: number;
  readonly end: number;
  readonly body: string;
}

/** The first complete ```mermaid fence's line span and body (the tidy step leaves at most one). */
function findFence(lines: readonly string[]): Fence | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/^```mermaid[ \t]*$/i.test((lines[i] ?? '').trimEnd()) || (lines[i] ?? '').startsWith(' '))
      continue;
    let end = i + 1;
    while (end < lines.length && !/^```[ \t]*$/.test((lines[end] ?? '').trimEnd())) end++;
    if (end >= lines.length) return null;
    return { start: i, end, body: lines.slice(i + 1, end).join('\n') };
  }
  return null;
}

function withFence(lines: readonly string[], fence: Fence, body: string | null): string {
  const middle = body === null ? [] : ['```mermaid', body, '```'];
  const out = [...lines.slice(0, fence.start), ...middle, ...lines.slice(fence.end + 1)].join('\n');
  return body === null ? out.replace(/\n{3,}/g, '\n\n').trimEnd() : out;
}

/** What the model wrote back as bare Mermaid code: a stray fence or `mermaid` word is removed. */
function extractCode(reply: string): string {
  const fenced = /```(?:mermaid)?[ \t]*\n([\s\S]*?)```/i.exec(reply);
  return (fenced === null ? reply : (fenced[1] ?? '')).trim();
}

/** A fence the parser and the caps both accept: its problem text, or null. */
async function problemOf(
  body: string,
  deps: FigureDeps,
  clock: { ms: number },
): Promise<{ problem: string | null; unchecked: boolean }> {
  const t0 = performance.now();
  const verdict = await deps.parse(body);
  clock.ms += performance.now() - t0;
  const limits = figureLimits(body);
  if (verdict.status === 'invalid') return { problem: verdict.error, unchecked: false };
  if (limits.length > 0) return { problem: limits.join('; '), unchecked: false };
  return { problem: null, unchecked: verdict.status === 'unavailable' };
}

/**
 * @param raw - `final_text` as the model streamed it.
 * @param check - Whether the request asked for a ```check fence (passed to the tidy step).
 * @param diagram - Whether a figure may stay (false: `diagram: never`).
 * @param deps - The parser and, optionally, the model repair.
 */
export async function settleFigure(
  raw: string,
  check: boolean,
  diagram: boolean,
  deps: FigureDeps,
): Promise<FigureOutcome> {
  const rawFence = findFence(raw.split('\n'));
  const text = tidyAnswer(raw, check, diagram);
  const lines = text.split('\n');
  const fence = findFence(lines);
  const clock = { ms: 0 };
  const base = { parseMs: 0, repairs: [] as string[], problem: null, modelCalled: false };
  if (fence === null) {
    // Either no figure, or the safety check removed it (no parse, no model: it was unsafe).
    return { ...base, text, path: rawFence === null ? 'none' : 'dropped' };
  }
  const first = await problemOf(fence.body, deps, clock);
  if (first.problem === null) {
    return {
      ...base,
      text,
      parseMs: clock.ms,
      path: first.unchecked ? 'unchecked' : rawFence?.body === fence.body ? 'ok' : 'tidy',
    };
  }
  let body = fence.body;
  let problem = first.problem;
  let repairs: string[] = [];
  const structural = repairMermaid(body);
  if (structural.applied.length > 0 && cleanMermaidFence(structural.body) !== null) {
    const again = await problemOf(structural.body, deps, clock);
    repairs = [...structural.applied];
    if (again.problem === null) {
      return {
        ...base,
        text: withFence(lines, fence, structural.body),
        path: 'deterministic',
        repairs,
        problem: first.problem,
        parseMs: clock.ms,
      };
    }
    body = structural.body;
    problem = again.problem;
  }
  let modelCalled = false;
  if (deps.repair !== undefined) {
    modelCalled = true;
    const reply = await deps.repair(repairPrompt(body, problem), REPAIR_SYSTEM).catch(() => null);
    if (reply !== null) {
      const cleaned = cleanMermaidFence(tidyMermaidText(extractCode(reply)).body);
      if (cleaned !== null && (await problemOf(cleaned, deps, clock)).problem === null) {
        return {
          ...base,
          text: withFence(lines, fence, cleaned),
          path: 'model',
          repairs,
          problem: first.problem,
          parseMs: clock.ms,
          modelCalled,
        };
      }
    }
  }
  return {
    ...base,
    text: withFence(lines, fence, null),
    path: 'dropped',
    repairs,
    problem: first.problem,
    parseMs: clock.ms,
    modelCalled,
  };
}
