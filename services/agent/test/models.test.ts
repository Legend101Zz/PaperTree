/**
 * The model policy (ADR-003), offline: the env -> policy rules, and what a Flash request looks like
 * on the wire, against the mock Anthropic server (the real pi-ai client, real HTTP/SSE). Flash
 * cannot be run with thinking off, so its request is adaptive thinking plus an effort, never
 * `disabled`. M3 stays byte-for-byte what it was.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { readConfig } from '../src/config.ts';
import {
  costBasis,
  DEFAULT_MODELS,
  FLASH_COST_BASIS,
  FLASH_MODEL_ID,
  M3_MODEL_ID,
  type ModelPolicy,
  readPolicy,
} from '../src/models.ts';
import { readExample } from './support/contract.ts';
import {
  type Agent,
  FAKE_KEY,
  postRun,
  requestId,
  runId,
  startAgent,
  startToolServer,
  type ToolAnswer,
  type ToolServer,
} from './support/harness.ts';
import { type MockAnthropic, type MockStep, startMockAnthropic } from './support/mock-anthropic.ts';

const opened: Array<{ close(): Promise<void> }> = [];
after(async () => {
  for (const thing of opened.toReversed()) await thing.close();
});

describe('readPolicy(): env -> which model answers which kind', () => {
  test('the shipped default: Flash (low) for explain and ask, M3 for summary (ADR-003)', () => {
    const p = readPolicy({});
    assert.deepEqual(
      [p.explain.id, p.ask.id, p.summary.id],
      [FLASH_MODEL_ID, FLASH_MODEL_ID, M3_MODEL_ID],
    );
    assert.deepEqual([p.explain.effort, p.ask.effort, p.summary.effort], ['low', 'low', null]);
    assert.equal(p.explain.label, `minimax/${FLASH_MODEL_ID}`);
    assert.deepEqual(DEFAULT_MODELS, {
      explain: FLASH_MODEL_ID,
      ask: FLASH_MODEL_ID,
      summary: M3_MODEL_ID,
    });
  });

  test('PAPERTREE_MODEL=MiniMax-M3 is the whole-service fallback', () => {
    const p = readPolicy({ PAPERTREE_MODEL: M3_MODEL_ID });
    for (const kind of ['explain', 'ask', 'summary'] as const) {
      assert.equal(p[kind].id, M3_MODEL_ID);
      assert.equal(p[kind].effort, null);
    }
  });

  test('a faux agent reports M3 until the environment names a model', () => {
    const base = { PAPERTREE_AGENT_SECRET: 's', PAPERTREE_AGENT_FAUX: '1' };
    assert.equal(readConfig(base).policy.explain.id, M3_MODEL_ID);
    assert.equal(
      readConfig({ ...base, PAPERTREE_MODEL: FLASH_MODEL_ID }).policy.summary.id,
      FLASH_MODEL_ID,
    );
    assert.equal(
      readConfig({ ...base, PAPERTREE_MODEL_EFFORT: 'high' }).policy.explain.id,
      FLASH_MODEL_ID,
      'naming any policy variable switches the faux agent to the real default',
    );
  });

  test('PAPERTREE_MODEL sets all, PAPERTREE_MODEL_<KIND> overrides one', () => {
    const p = readPolicy({
      PAPERTREE_MODEL: FLASH_MODEL_ID,
      PAPERTREE_MODEL_ASK: M3_MODEL_ID,
    });
    assert.equal(p.explain.id, FLASH_MODEL_ID);
    assert.equal(p.summary.id, FLASH_MODEL_ID);
    assert.equal(p.ask.id, M3_MODEL_ID);
  });

  test('effort: global, per kind, default low; M3 has none', () => {
    const p = readPolicy({
      PAPERTREE_MODEL: FLASH_MODEL_ID,
      PAPERTREE_MODEL_EFFORT: 'high',
      PAPERTREE_MODEL_EFFORT_SUMMARY: 'medium',
      PAPERTREE_MODEL_ASK: M3_MODEL_ID,
    });
    assert.equal(p.explain.effort, 'high');
    assert.equal(p.summary.effort, 'medium');
    assert.equal(p.ask.effort, null);
    assert.equal(readPolicy({ PAPERTREE_MODEL: FLASH_MODEL_ID }).explain.effort, 'low');
  });

  test('an unknown model or effort is refused at config time, naming the variable', () => {
    assert.throws(() => readPolicy({ PAPERTREE_MODEL: 'gpt-9' }), /PAPERTREE_MODEL=gpt-9/);
    assert.throws(() => readPolicy({ PAPERTREE_MODEL_EFFORT: 'none' }), /PAPERTREE_MODEL_EFFORT/);
    assert.throws(
      () =>
        readConfig({
          PAPERTREE_AGENT_SECRET: 's',
          PAPERTREE_AGENT_FAUX: '1',
          PAPERTREE_MODEL_SUMMARY: 'nope',
        }),
      /PAPERTREE_MODEL_SUMMARY/,
    );
  });

  test('the cost label: Flash is an estimate on M3 rates', () => {
    assert.equal(costBasis(FLASH_MODEL_ID), FLASH_COST_BASIS);
    assert.equal(FLASH_COST_BASIS, 'estimate on M3 rates');
    assert.notEqual(costBasis(M3_MODEL_ID), FLASH_COST_BASIS);
  });
});

const policy: ModelPolicy = readPolicy({
  PAPERTREE_MODEL: M3_MODEL_ID,
  PAPERTREE_MODEL_EXPLAIN: FLASH_MODEL_ID,
  PAPERTREE_MODEL_EFFORT_EXPLAIN: 'low',
  PAPERTREE_MODEL_SUMMARY: FLASH_MODEL_ID,
  PAPERTREE_MODEL_EFFORT_SUMMARY: 'medium',
});

const passage = (handle: string): ToolAnswer => ({
  status: 200,
  body: {
    text: `[${handle}] (p. 3 · 2.1. Design · paragraph)\n<paper_text channel="paper" trust="untrusted">\n^7f3a91c2 text ^7f3a91c2\n</paper_text>`,
    handles: [handle],
  },
});

let counter = 400;

async function live(steps: readonly MockStep[]): Promise<{
  agent: Agent;
  mock: MockAnthropic;
  tools: ToolServer;
}> {
  const mock = await startMockAnthropic(steps, FAKE_KEY);
  opened.push(mock);
  const tools = await startToolServer(() => passage('b3'));
  opened.push(tools);
  const agent = await startAgent({
    apiOrigin: tools.origin,
    faux: false,
    policy,
    modelOverride: (model) => ({ ...model, baseUrl: mock.url }),
  });
  opened.push(agent);
  return { agent, mock, tools };
}

function request(kind: 'explain' | 'followup' | 'summary', tools: ToolServer): Record<string, any> {
  const body = readExample(kind);
  counter++;
  if (kind === 'followup') {
    body['kind'] = 'ask';
    body['prompt_version'] = 'ask-v1';
  }
  body['run_id'] = runId(counter);
  body['request_id'] = requestId(counter);
  body['tool']['base_url'] = tools.baseUrl(body['run_id']);
  return body;
}

const eventOf = (events: Array<{ event: string; data: any }>, name: string): any =>
  events.find((e) => e.event === name)?.data;

describe('Flash on the wire (mock Anthropic server)', () => {
  test('explain on Flash: adaptive thinking + effort, never disabled; the model id flows out', async () => {
    const { agent, mock, tools } = await live([
      { kind: 'stream', thinking: 'Cite b1.', text: ['It frames detection as regression [b1].'] },
    ]);
    const result = await postRun(agent.url, request('explain', tools));
    const run = eventOf(result.events, 'run');
    assert.equal(run.model, `minimax/${FLASH_MODEL_ID}`);
    const done = eventOf(result.events, 'done');
    assert.equal(done.status, 'complete');
    assert.ok(done.usage_totals.cost_usd_est > 0, 'a Flash cost is estimated (on M3 rates)');
    const sent = mock.requests[0]!.body;
    assert.equal(sent['model'], FLASH_MODEL_ID);
    assert.equal(sent['thinking']?.['type'], 'adaptive');
    assert.equal(sent['output_config']?.['effort'], 'low');
    assert.equal(sent['thinking']?.['budget_tokens'], undefined);
    assert.doesNotMatch(JSON.stringify(sent), /"disabled"|"none"/, 'thinking is never turned off');
  });

  test('summary on Flash medium; ask (follow-up) on M3 keeps its budget-based thinking', async () => {
    const summary = await live([{ kind: 'stream', text: ['- A point [b1].'] }]);
    const s = await postRun(summary.agent.url, request('summary', summary.tools));
    assert.equal(eventOf(s.events, 'run').model, `minimax/${FLASH_MODEL_ID}`);
    assert.equal(summary.mock.requests[0]!.body['output_config']?.['effort'], 'medium');
    assert.equal(summary.mock.requests[0]!.body['thinking']?.['type'], 'adaptive');

    const ask = await live([{ kind: 'stream', text: ['That is the loss [b1].'] }]);
    const a = await postRun(ask.agent.url, request('followup', ask.tools));
    assert.equal(eventOf(a.events, 'run').model, `minimax/${M3_MODEL_ID}`);
    const sent = ask.mock.requests[0]!.body;
    assert.equal(sent['model'], M3_MODEL_ID);
    assert.equal(sent['thinking']?.['type'], 'enabled');
    assert.equal(sent['output_config'], undefined, 'M3 is sent no effort');
  });

  test('/healthz reports the model per kind, the effort and the cost basis', async () => {
    const { agent } = await live([{ kind: 'stream', text: ['x [b1].'] }]);
    const body = (await (await fetch(`${agent.url}/healthz`)).json()) as Record<string, any>;
    assert.deepEqual(body['models'], {
      explain: `minimax/${FLASH_MODEL_ID}`,
      ask: `minimax/${M3_MODEL_ID}`,
      summary: `minimax/${FLASH_MODEL_ID}`,
    });
    assert.deepEqual(body['effort'], { explain: 'low', ask: null, summary: 'medium' });
    assert.equal(body['cost_basis'][FLASH_MODEL_ID], 'estimate on M3 rates');
    assert.equal(body['model'], `minimax/${FLASH_MODEL_ID}`);
  });

  test('a Flash-shaped stream (narration, then tool_use) drops the narration', async () => {
    const { agent, tools } = await live([
      {
        kind: 'stream',
        thinking: 'I should read b3 first.',
        text: ['Let me look at the design section.'],
        toolUses: [{ id: 'toolu_1', name: 'get_passage', input: { handle: 'b3' } }],
      },
      { kind: 'stream', thinking: 'Now answer.', text: ['The design is simple [b3].'] },
    ]);
    const result = await postRun(agent.url, request('explain', tools));
    const done = eventOf(result.events, 'done');
    assert.equal(done.status, 'complete');
    const sent = result.events.filter((e) => e.event === 'text').map((e) => e.data.delta);
    assert.deepEqual(sent, ['The design is simple [b3].']);
    assert.equal(done.final_text, 'The design is simple [b3].');
    assert.deepEqual(done.markers, ['b3']);
    assert.doesNotMatch(done.final_text, /Let me look/);
  });
});
