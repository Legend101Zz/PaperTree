/**
 * The figure step inside a run (run.ts `settleFigure`, v0.3 W6), on the faux model, the REAL
 * parser worker and the real Pi loop: what `done.final_text` holds, what the repair request costs
 * (it is in `usage` and `usage_totals`), and the `agent.figure` log line a round counts.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { RunRequest } from '../src/contract.ts';
import type { FauxStep } from '../src/faux.ts';

import { readExample } from './support/contract.ts';
import {
  type Agent,
  postRun,
  requestId,
  runId,
  startAgent,
  startToolServer,
  type ToolServer,
} from './support/harness.ts';
import { FLOWCHART_TWO_STATEMENTS_B } from './support/r1-failing-fences.ts';

const scripts = new Map<string, readonly FauxStep[]>();
let tools: ToolServer;
let agent: Agent;
let n = 7_000;

before(async () => {
  tools = await startToolServer(() => ({ status: 404, body: {} }));
  agent = await startAgent({
    apiOrigin: tools.origin,
    brain: (request: RunRequest) => {
      const steps = scripts.get(request.run_id);
      if (!steps) throw new Error(`no script for ${request.run_id}`);
      return steps;
    },
  });
});
after(async () => {
  await agent?.close();
  await tools?.close();
});

type Json = Record<string, any>;

function explain(steps: readonly FauxStep[], patch: (body: Json) => void = () => {}): Json {
  const body = readExample('explain');
  n++;
  body['run_id'] = runId(n);
  body['request_id'] = requestId(n);
  body['tool']['base_url'] = tools.baseUrl(body['run_id']);
  patch(body);
  scripts.set(body['run_id'], steps);
  return body;
}

const withFence = (body: string): string =>
  `## TL;DR\nIt adds the input back.\n## How it works\nThe block outputs $y = F(x) + x$ [b1].\n\`\`\`mermaid\n${body}\n\`\`\`\n## In the paper\nSection 3 [b1].`;

const usage = (output: number) => ({
  input: 100,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  cost: 0.001,
});

function doneOf(events: Array<{ event: string; data: Json }>): Json {
  const last = events.at(-1);
  assert.equal(last?.event, 'done');
  return last.data;
}

const figureLog = (body: Json): Json | undefined =>
  agent.logs.find((l) => l.event === 'agent.figure' && l['run_id'] === body['run_id']);

const BROKEN = 'flowchart TD\n  a --> --> b\n  b --> c';

describe('a figure is parsed, repaired or dropped before final_text', () => {
  test('a good fence costs no model call and logs path ok', async () => {
    const body = explain([
      {
        text: [withFence('flowchart TD\n  a["Input"] --> b["Layers"]\n  b --> c["Sum"]')],
        usage: usage(40),
      },
    ]);
    const { events } = await postRun(agent.url, body);
    const done = doneOf(events);
    assert.match(done['final_text'], /```mermaid\nflowchart TD/);
    assert.equal(events.filter((e) => e.event === 'usage').length, 1);
    assert.equal(figureLog(body)?.['path'], 'ok');
    assert.equal(figureLog(body)?.['model_called'], false);
  });

  test('a real round-1 failure is repaired deterministically: stored text parses, no model call', async () => {
    const body = explain([{ text: [withFence(FLOWCHART_TWO_STATEMENTS_B)], usage: usage(40) }]);
    const { events } = await postRun(agent.url, body);
    const done = doneOf(events);
    assert.equal(done['status'], 'complete');
    assert.match(done['final_text'], /cat --> wo\n {2}wo --> out/);
    assert.equal(events.filter((e) => e.event === 'usage').length, 1);
    const line = figureLog(body);
    assert.equal(line?.['path'], 'deterministic');
    assert.deepEqual(line?.['repairs'], ['flow-split-statements']);
    // The streamed text is what the model wrote; final_text is the stored, repaired one.
    const streamed = events
      .filter((e) => e.event === 'text')
      .map((e) => String(e.data['delta']))
      .join('');
    assert.match(streamed, /cat --> wo {2}wo --> out/);
  });

  test('a fence only the model can fix: ONE repair request, counted in usage, logged as model', async () => {
    const body = explain([
      { text: [withFence(BROKEN)], usage: usage(40) },
      { text: ['flowchart TD\n  a["One"] --> b["Two"]\n  b --> c["Three"]'], usage: usage(15) },
    ]);
    const { events } = await postRun(agent.url, body);
    const done = doneOf(events);
    assert.equal(done['status'], 'complete');
    assert.match(done['final_text'], /a\["One"\] --> b\["Two"\]/);
    assert.doesNotMatch(done['final_text'], /--> -->/);
    assert.match(done['final_text'], /## In the paper\nSection 3 \[b1\]\.$/);
    const usages = events.filter((e) => e.event === 'usage');
    assert.equal(usages.length, 2, 'the repair request has its own usage event');
    assert.equal(done['usage_totals']['output'], 55);
    assert.equal(done['usage_totals']['input'], 200);
    assert.equal(agent.app.faux?.requests(body['run_id']), 2, 'one answer, one repair');
    assert.equal(done['turns'], 1, 'the repair is not a turn of the conversation');
    assert.equal(figureLog(body)?.['path'], 'model');
    assert.equal(figureLog(body)?.['model_called'], true);
  });

  test('a repair that fails (the model errors) drops the fence; the answer stays complete', async () => {
    const body = explain([
      { text: [withFence(BROKEN)], usage: usage(40) },
      { stopReason: 'error', errorMessage: '500 faux error' },
    ]);
    const { events } = await postRun(agent.url, body);
    const done = doneOf(events);
    assert.equal(done['status'], 'complete');
    assert.doesNotMatch(done['final_text'], /mermaid/);
    assert.match(done['final_text'], /^## TL;DR/);
    assert.equal(figureLog(body)?.['path'], 'dropped');
  });

  test('an over-cap fence is repaired by asking the model to simplify', async () => {
    const big = `flowchart TD\n${Array.from({ length: 14 }, (_, i) => `  n${String(i)}["A"] --> n${String(i + 1)}["B"]`).join('\n')}`;
    const body = explain([
      { text: [withFence(big)], usage: usage(80) },
      (context) => {
        const last = JSON.stringify(context.messages.at(-1));
        assert.match(last, /15 nodes; at most 12/);
        return {
          text: ['flowchart TD\n  a["Start"] --> b["End"]\n  b --> c["Done"]'],
          usage: usage(12),
        };
      },
    ]);
    const done = doneOf((await postRun(agent.url, body)).events);
    assert.match(done['final_text'], /a\["Start"\] --> b\["End"\]/);
    assert.equal(figureLog(body)?.['path'], 'model');
  });

  test('diagram: never keeps the fence out and never runs the step', async () => {
    const body = explain([{ text: [withFence(BROKEN)], usage: usage(40) }], (b) => {
      b['diagram'] = 'never';
    });
    const done = doneOf((await postRun(agent.url, body)).events);
    assert.doesNotMatch(done['final_text'], /mermaid/);
    assert.equal(figureLog(body)?.['path'], 'dropped');
  });

  test('an answer with no fence logs nothing and costs nothing', async () => {
    const body = explain([
      { text: ['## TL;DR\nPlain.\n## How it works\nIt adds [b1].'], usage: usage(10) },
    ]);
    await postRun(agent.url, body);
    assert.equal(figureLog(body), undefined);
  });
});
