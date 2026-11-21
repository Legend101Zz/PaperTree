/**
 * The figure step of an explain / ask / image answer, after the model has written it (v0.3 W6):
 * the owner's rule is that a diagram Flash writes never reaches the reader as a render error, and
 * is readable. `settleFigure` takes the answer text and returns it with its one ```mermaid fence
 * in a state that parses (with the REAL parser, mermaid-parse.ts), or without the fence. A fence
 * that parses is never dropped for its size (v0.3 W6 round 3: the caps are SOFT):
 *
 *   1. ok / tidy       the fence parses and is within the caps (tidy: after the always-on cosmetics)
 *   2. deterministic   `repairMermaid` (mermaid-repair.ts) fixes it with no model call
 *   3. model           ONE short model request, counted in usage: a repair when the fence does not
 *                      parse, a "simplify" when it parses but is over a size cap
 *   4. kept-over-cap   it parses but is over a cap and the simplify did not come back (error,
 *                      timeout, still over, no model): the original is kept, the web scales it
 *   5. dropped         it does not parse after all repairs (or the safety check refused it): the
 *                      fence is removed; the answer text stays
 *
 * `path` is what a round counts. If the parser itself is unavailable (no worker) the fence is kept
 * as is (`unchecked`): the web still parses before it draws.
 *
 * The functions here are pure apart from `FigureDeps`, which the run supplies (the worker parse and
 * the model call), so every path is tested with fakes.
 */
import { tidyAnswer } from './answer.ts';
import { cleanMermaidFence } from './mermaid.ts';
import { FIGURE_CAPS, figureLimits, repairMermaid, tidyMermaidText } from './mermaid-repair.ts';
import type { ParseVerdict } from './mermaid-parse.ts';

export type FigurePath =
  'none' | 'ok' | 'tidy' | 'deterministic' | 'model' | 'kept-over-cap' | 'dropped' | 'unchecked';

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

interface Verdict {
  /** The parser's words when the fence does not parse; else null. */
  readonly invalid: string | null;
  /** The size caps it breaks (soft); empty when it parses within them. */
  readonly over: readonly string[];
  readonly unchecked: boolean;
}

/** What the parser and the size caps say about a fence. */
async function judge(body: string, deps: FigureDeps, clock: { ms: number }): Promise<Verdict> {
  const t0 = performance.now();
  const verdict = await deps.parse(body);
  clock.ms += performance.now() - t0;
  if (verdict.status === 'invalid') return { invalid: verdict.error, over: [], unchecked: false };
  return {
    invalid: null,
    over: figureLimits(body),
    unchecked: verdict.status === 'unavailable',
  };
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
  const first = await judge(fence.body, deps, clock);
  const firstProblem = first.invalid ?? first.over.join('; ');
  if (first.invalid === null && first.over.length === 0) {
    return {
      ...base,
      text,
      parseMs: clock.ms,
      path: first.unchecked ? 'unchecked' : rawFence?.body === fence.body ? 'ok' : 'tidy',
    };
  }
  if (first.unchecked) {
    // Over a cap and no parser to check a simplified copy with: the original stands.
    return { ...base, text, path: 'unchecked', problem: firstProblem, parseMs: clock.ms };
  }
  let body = fence.body;
  let current = first;
  let repairs: string[] = [];
  if (first.invalid !== null) {
    const structural = repairMermaid(body);
    if (structural.applied.length > 0 && cleanMermaidFence(structural.body) !== null) {
      const again = await judge(structural.body, deps, clock);
      repairs = [...structural.applied];
      body = structural.body;
      current = again;
      if (again.invalid === null && again.over.length === 0) {
        return {
          ...base,
          text: withFence(lines, fence, body),
          path: 'deterministic',
          repairs,
          problem: firstProblem,
          parseMs: clock.ms,
        };
      }
    }
  }
  // One model request at most: a repair (it does not parse) or a simplify (it parses, over a cap).
  const problem = current.invalid ?? current.over.join('; ');
  let modelCalled = false;
  if (deps.repair !== undefined) {
    modelCalled = true;
    const reply = await deps.repair(repairPrompt(body, problem), REPAIR_SYSTEM).catch(() => null);
    if (reply !== null) {
      const cleaned = cleanMermaidFence(tidyMermaidText(extractCode(reply)).body);
      if (cleaned !== null) {
        const verdict = await judge(cleaned, deps, clock);
        // A repair is accepted when it parses; a simplify only when it also got within the caps.
        const accepted =
          verdict.invalid === null && (current.invalid !== null || verdict.over.length === 0);
        if (accepted) {
          return {
            ...base,
            text: withFence(lines, fence, cleaned),
            path: 'model',
            repairs,
            problem: firstProblem,
            parseMs: clock.ms,
            modelCalled,
          };
        }
      }
    }
  }
  if (current.invalid === null) {
    // It parses: over a cap is not an error. Keep it (as the deterministic repairs left it).
    return {
      ...base,
      text: withFence(lines, fence, body),
      path: 'kept-over-cap',
      repairs,
      problem: firstProblem,
      parseMs: clock.ms,
      modelCalled,
    };
  }
  return {
    ...base,
    text: withFence(lines, fence, null),
    path: 'dropped',
    repairs,
    problem: firstProblem,
    parseMs: clock.ms,
    modelCalled,
  };
}
