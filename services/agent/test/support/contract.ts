/**
 * The committed contract files, read the way the tests hold the agent to them: ajv over
 * `contracts/agent/*.schema.json` (ajv 8.20.0 is this package's devDependency), the eight recorded
 * streams, and the three request examples.
 */
import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';

import { parseSse, type Frame } from './harness.ts';

export { CONTRACTS_DIR as CONTRACTS } from '../../src/contract.ts';
import { CONTRACTS_DIR as CONTRACTS } from '../../src/contract.ts';

export function readJson<T = Record<string, unknown>>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, CONTRACTS), 'utf8')) as T;
}

const ajv = new Ajv2020.default({ allErrors: true, strict: false });
export const validateEvent = ajv.compile(readJson('run-events.schema.json'));
export const validateRequest = ajv.compile(readJson('run-request.schema.json'));
const toolsSchema = readJson<{ $defs: Record<string, unknown> }>('internal-tools.schema.json');
export function toolParamsValidator(def: string): ReturnType<typeof ajv.compile> {
  return ajv.compile({ ...toolsSchema, $ref: `#/$defs/${def}` });
}

export const FIXTURE_NAMES = [
  'explain-ok',
  'followup-ok',
  'summary-ok',
  'tool-budget',
  'stall-timeout',
  'auth-error',
  'aborted-partial',
  'upstream-503-retry-ok',
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface Fixture {
  readonly name: FixtureName;
  readonly frames: Frame[];
  readonly events: Array<{ readonly event: string; readonly data: Record<string, unknown> }>;
  readonly pings: number;
  readonly done: Record<string, unknown> & { entries: Array<Record<string, any>> };
  readonly texts: string[];
  readonly usages: Array<Record<string, number | null>>;
}

export function readFixture(name: FixtureName): Fixture {
  const frames = parseSse(readFileSync(new URL(`fixtures/${name}.sse`, CONTRACTS), 'utf8'));
  const events = frames.flatMap((f) =>
    f.kind === 'event' ? [{ event: f.event, data: f.data }] : [],
  );
  const done = events.at(-1)?.data as Fixture['done'];
  return {
    name,
    frames,
    events,
    pings: frames.filter((f) => f.kind === 'ping').length,
    done,
    texts: events.filter((e) => e.event === 'text').map((e) => String(e.data['delta'])),
    usages: events
      .filter((e) => e.event === 'usage')
      .map((e) => e.data as Record<string, number | null>),
  };
}

export function readExample(name: 'explain' | 'followup' | 'summary'): Record<string, any> {
  return readJson(`examples/run-request-${name}.json`);
}

const MARKER = /\[(b\d+(?:\s*,\s*b\d+)*)\]/g;

/**
 * The semantics `services/api/.../tests/test_agent_contracts.py` holds every recorded stream to,
 * applied to a stream this agent EMITTED: the deltas are the final text, the markers are the regex
 * over it (restricted to handles seen), the totals are the sum, tool/retry counts match statuses,
 * no tool step after the first text. Returns the problems (none = holds).
 */
export function semanticProblems(events: Fixture['events']): string[] {
  const problems: string[] = [];
  const names = events.map((e) => e.event);
  if (names[0] !== 'run' || names.filter((n) => n === 'run').length !== 1)
    problems.push('run is not first and only');
  if (names.at(-1) !== 'done' || names.filter((n) => n === 'done').length !== 1)
    problems.push('done is not last and only');
  for (const e of events) {
    if (!validateEvent({ event: e.event, data: e.data })) {
      problems.push(
        `${e.event} fails run-events.schema.json: ${JSON.stringify(validateEvent.errors)}`,
      );
    }
  }
  const done = events.at(-1)?.data ?? {};
  const texts = events.filter((e) => e.event === 'text').map((e) => String(e.data['delta']));
  if (texts.join('') !== done['final_text']) problems.push('deltas are not final_text');
  const firstText = names.indexOf('text');
  if (firstText !== -1 && events.slice(firstText).some((e) => e.data['phase'] === 'tool'))
    problems.push('a tool step after text');
  if ((done['first_text_ms'] === null) !== (texts.length === 0))
    problems.push('first_text_ms vs texts');
  const expected: string[] = [];
  for (const m of String(done['final_text'] ?? '').matchAll(MARKER)) {
    for (const h of (m[1] ?? '').split(/\s*,\s*/)) if (!expected.includes(h)) expected.push(h);
  }
  const seen = (done['handles_seen'] as string[] | undefined) ?? [];
  const markers = (done['markers'] as string[] | undefined) ?? [];
  if (JSON.stringify(markers) !== JSON.stringify(expected.filter((h) => seen.includes(h))))
    problems.push('markers are not the regex ∩ seen');
  const usages = events
    .filter((e) => e.event === 'usage')
    .map((e) => e.data as Record<string, number | null>);
  const totals = (done['usage_totals'] ?? {}) as Record<string, number | null>;
  for (const key of ['input', 'output', 'cache_read', 'cache_write']) {
    if (totals[key] !== usages.reduce((sum, u) => sum + Number(u[key]), 0))
      problems.push(`usage_totals.${key} is not the sum`);
  }
  const reasoning = usages.some((u) => u['reasoning'] === null)
    ? null
    : usages.reduce((sum, u) => sum + Number(u['reasoning']), 0);
  if (totals['reasoning'] !== reasoning) problems.push('usage_totals.reasoning is not the sum');
  const cost = usages.reduce((sum, u) => sum + Number(u['cost_usd_est']), 0);
  if (Math.abs(Number(totals['cost_usd_est']) - cost) > 1e-9)
    problems.push('usage_totals.cost_usd_est is not the sum');
  const phases = events.filter((e) => e.event === 'status').map((e) => e.data['phase']);
  if (done['tool_calls'] !== phases.filter((p) => p === 'tool').length)
    problems.push('tool_calls is not the tool statuses');
  if (done['retries'] !== phases.filter((p) => p === 'retrying').length)
    problems.push('retries is not the retrying statuses');
  if ((done['status'] === 'complete' || done['status'] === 'partial') && !done['final_text'])
    problems.push('complete/partial without text');
  return problems;
}
