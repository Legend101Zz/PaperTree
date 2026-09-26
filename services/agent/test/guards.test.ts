/**
 * The §3.3 host guards and the §3.2 run rules, on the faux model (scripted turns, real Pi loop,
 * real tools over HTTP to a stand-in API).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { RunRequest } from '../src/contract.ts';
import type { FauxStep } from '../src/faux.ts';
import { createLogger } from '../src/log.ts';
import { createPaperSession, DisposedSessionError } from '../src/session.ts';
import { BUDGET_TEXT, createPaperTools } from '../src/tools.ts';

import { readExample, semanticProblems } from './support/contract.ts';
import {
  type Agent,
  deleteRun,
  type Frame,
  postRun,
  requestId,
  runId,
  SECRET,
  startAgent,
  startToolServer,
  threadId,
  type ToolAnswer,
  type ToolHit,
  type ToolServer,
} from './support/harness.ts';

const scripts = new Map<string, readonly FauxStep[]>();
let toolAnswer: (hit: ToolHit) => ToolAnswer = () => ({ status: 404, body: {} });
let tools: ToolServer;
let agent: Agent;
let n = 1_000;

before(async () => {
  tools = await startToolServer((hit) => toolAnswer(hit));
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

const call = (h: number) => ({ name: 'get_passage', arguments: { handle: `b${String(h)}` } });

const passage = (handle: string, page = 'p. 3', section = '2.1. Design'): ToolAnswer => ({
  status: 200,
  body: {
    text: `[${handle}] (${page} · ${section} · paragraph)\n<paper_text channel="paper" trust="untrusted">\n^7f3a91c2 text ^7f3a91c2 of ^7f3a91c2 ${handle} ^7f3a91c2\n</paper_text>`,
    handles: [handle],
  },
});

function doneOf(events: Array<{ event: string; data: Json }>): Json {
  const last = events.at(-1);
  assert.equal(last?.event, 'done');
  return last.data;
}

function textsOf(events: Array<{ event: string; data: Json }>): string[] {
  return events.filter((e) => e.event === 'text').map((e) => String(e.data['delta']));
}

describe('the tool loop', () => {
  test('a tool call is served over HTTP with the run token, and its handles become citable', async () => {
    toolAnswer = (hit) =>
      hit.path.endsWith('/passages/b3') ? passage('b3') : { status: 404, body: {} };
    const body = explain([
      { thinking: 'Read b3.', toolCalls: [{ name: 'get_passage', arguments: { handle: 'b3' } }] },
      { text: ['b3 says the design is simple [b3].'] },
    ]);
    const hitsBefore = tools.hits.length;
    const result = await postRun(agent.url, body);
    assert.deepEqual(semanticProblems(result.events), []);
    const d = doneOf(result.events);
    assert.equal(d['status'], 'complete');
    assert.deepEqual(d['handles_seen'], ['b1', 'b2', 'b3']);
    assert.deepEqual(d['markers'], ['b3']);
    const hit = tools.hits.at(-1)!;
    assert.equal(tools.hits.length - hitsBefore, 1);
    assert.equal(hit.path, `/internal/agent/runs/${String(body['run_id'])}/passages/b3`);
    assert.equal(hit.authorization, `Bearer ${String(body['tool']['token'])}`);
    assert.equal(hit.requestId, body['request_id']);
    const toolStatus = result.events.find(
      (e) => e.event === 'status' && e.data['phase'] === 'tool',
    );
    assert.deepEqual(toolStatus?.data, { phase: 'tool', tool: 'get_passage', label: 'Reading b3' });
    // The model was given the tool result on its second request.
    const seen = agent.app.faux!.seen(String(body['run_id']));
    assert.ok(
      seen[1]?.roles.includes('toolResult'),
      `second request roles: ${String(seen[1]?.roles)}`,
    );
  });

  test('search params: TypeBox refuses a limit over 8 before any request is made', async () => {
    toolAnswer = () => passage('b4');
    const body = explain([
      { toolCalls: [{ name: 'search_passages', arguments: { query: 'grid', limit: 50 } }] },
      { text: ['No search was made [b1].'] },
    ]);
    const hitsBefore = tools.hits.length;
    const result = await postRun(agent.url, body);
    assert.equal(tools.hits.length - hitsBefore, 0, 'an invalid call never reaches the API');
    const entries = doneOf(result.events)['entries'] as Json[];
    const toolResult = entries.find((e) => e['message']['role'] === 'toolResult')!['message'];
    assert.equal(toolResult['isError'], true);
  });

  test('a hallucinated built-in (bash, read) is not executed', async () => {
    const body = explain([
      {
        toolCalls: [
          { name: 'bash', arguments: { command: 'touch /tmp/papertree-agent-canary-bash' } },
          { name: 'read', arguments: { path: `${process.env['HOME'] ?? ''}/.pi/agent/auth.json` } },
        ],
      },
      { text: ['Only paper tools exist [b1].'] },
    ]);
    const result = await postRun(agent.url, body);
    const d = doneOf(result.events);
    const results = (d['entries'] as Json[])
      .filter((e) => e['message']['role'] === 'toolResult')
      .map((e) => e['message']);
    assert.equal(results.length, 2);
    for (const r of results) {
      assert.equal(r['isError'], true);
      assert.match(String(r['content'][0]['text']), /^Tool (bash|read) not found$/);
    }
    const statuses = result.events
      .filter((e) => e.event === 'status' && e.data['phase'] === 'tool')
      .map((e) => e.data);
    assert.deepEqual(statuses, [
      { phase: 'tool', label: 'A tool this service does not have' },
      { phase: 'tool', label: 'A tool this service does not have' },
    ]);
  });
});

describe('the tool-call cap and the turn cap (§3.3)', () => {
  test('past max_tool_calls a tool answers the budget text without calling the API; the model may still answer', async () => {
    toolAnswer = () => passage(`b${String(10 + tools.hits.length)}`);
    const nine = Array.from({ length: 9 }, (_, i) => ({
      name: 'get_passage',
      arguments: { handle: `b${String(i + 1)}` },
    }));
    const body = explain([
      { toolCalls: nine.slice(0, 5) },
      { toolCalls: nine.slice(5) },
      { text: ['Answered from what it had [b1].'] },
    ]);
    const hitsBefore = tools.hits.length;
    const result = await postRun(agent.url, body);
    const d = doneOf(result.events);
    assert.equal(tools.hits.length - hitsBefore, 8, '8 served');
    assert.equal(d['status'], 'complete', 'cap + 1 is not an abort');
    assert.equal(d['tool_calls'], 9);
    const labels = result.events
      .filter((e) => e.data['phase'] === 'tool')
      .map((e) => e.data['label']);
    assert.equal(labels.at(-1), 'Tool budget exhausted');
    const results = (d['entries'] as Json[])
      .filter((e) => e['message']['role'] === 'toolResult')
      .map((e) => e['message']['content'][0]['text']);
    assert.equal(results.at(-1), BUDGET_TEXT);
  });

  test('10 requested -> 8 served -> the run stops (cap + 2)', async () => {
    toolAnswer = () => passage('b5');
    const body = explain([
      { toolCalls: [call(1), call(2), call(3)] },
      { toolCalls: [call(4), call(5), call(6)] },
      { toolCalls: [call(7), call(8), call(9)] },
      { toolCalls: [call(10)] },
      { text: ['NEVER REQUESTED'] },
    ]);
    const hitsBefore = tools.hits.length;
    const result = await postRun(agent.url, body);
    const d = doneOf(result.events);
    assert.equal(tools.hits.length - hitsBefore, 8);
    assert.equal(d['status'], 'error');
    assert.equal(d['error']['code'], 'tool_budget_exhausted');
    assert.equal(d['tool_calls'], 10);
    assert.ok(!result.text.includes('NEVER REQUESTED'));
  });

  test('past max_turns the run stops -> tool_budget_exhausted', async () => {
    toolAnswer = () => passage('b6');
    const turns = Array.from({ length: 8 }, (_, i) => ({
      toolCalls: [{ name: 'get_passage', arguments: { handle: `b${String(i + 1)}` } }],
    }));
    const body = explain(turns, (b) => {
      b['limits'] = { ...b['limits'], max_tool_calls: 20, max_turns: 3 };
    });
    const hitsBefore = tools.hits.length;
    const result = await postRun(agent.url, body);
    const d = doneOf(result.events);
    assert.equal(d['error']['code'], 'tool_budget_exhausted');
    assert.equal(
      tools.hits.length - hitsBefore,
      3,
      "three turns' tools ran, the fourth turn never did",
    );
    assert.equal(agent.app.faux!.requests(String(body['run_id'])) <= 4, true);
  });
});

describe('text: only an answer reaches the caller', () => {
  test('narration before a tool call is dropped; the deltas are exactly final_text', async () => {
    toolAnswer = () => passage('b3');
    const body = explain([
      {
        text: ['Let me search', ' the paper for that.'],
        toolCalls: [{ name: 'get_passage', arguments: { handle: 'b3' } }],
      },
      { text: ['The design is simple [b3].', ' It has one stage.'] },
    ]);
    const result = await postRun(agent.url, body);
    const d = doneOf(result.events);
    assert.deepEqual(textsOf(result.events), ['The design is simple [b3].', ' It has one stage.']);
    assert.equal(d['final_text'], 'The design is simple [b3]. It has one stage.');
    // The narration stays in the model's own history (entries), never in what the reader is sent.
    const assistant = (d['entries'] as Json[]).filter((e) => e['message']['role'] === 'assistant');
    assert.match(JSON.stringify(assistant[0]?.['message']['content']), /Let me search/);
  });

  test('an answer streams from its first citation; uncited answer text is sent at its end', async () => {
    const body = explain([
      { text: ['Plain words', ' with no handle', ' yet [b1].', ' More.'], deltaDelayMs: 40 },
    ]);
    const result = await postRun(agent.url, body);
    const statusWriting = result.frames.findIndex(
      (f) => f.kind === 'event' && f.event === 'status' && f.data['phase'] === 'writing',
    );
    const firstText = result.frames.findIndex((f) => f.kind === 'event' && f.event === 'text');
    assert.ok(statusWriting !== -1 && statusWriting < firstText);
    assert.deepEqual(textsOf(result.events), [
      'Plain words',
      ' with no handle',
      ' yet [b1].',
      ' More.',
    ]);
    const uncited = explain([{ text: ['No handle', ' at all.'] }]);
    const second = await postRun(agent.url, uncited);
    assert.equal(doneOf(second.events)['final_text'], 'No handle at all.');
  });
});

describe('citations (§3.3): markers are only handles issued in this run', () => {
  test('an invented handle stays in the text but not in markers, and is logged', async () => {
    const body = explain([{ text: ['The abstract says so [b1], and [b9] too [b2, b9].'] }]);
    const result = await postRun(agent.url, body);
    const d = doneOf(result.events);
    assert.deepEqual(d['markers'], ['b1', 'b2']);
    assert.deepEqual(d['handles_seen'], ['b1', 'b2']);
    const logged = agent.logs.find(
      (l) => l.event === 'agent.run.done' && l['run_id'] === body['run_id'],
    );
    assert.deepEqual(logged?.['unseen_markers'], ['b9']);
  });
});

describe('history (§3.2 entries)', () => {
  test('entries restore: a follow-up sees the whole previous turn, and hands it back verbatim', async () => {
    toolAnswer = () => passage('b3');
    const first = explain([
      { toolCalls: [{ name: 'get_passage', arguments: { handle: 'b3' } }] },
      { text: ['First answer [b3].'] },
    ]);
    const r1 = await postRun(agent.url, first);
    const entries = doneOf(r1.events)['entries'] as Json[];
    assert.deepEqual(
      entries.map((e) => e['message']['role']),
      ['user', 'assistant', 'toolResult', 'assistant'],
    );
    const thread = threadId(1);
    const second = explain([{ text: ['As I said [b1].'] }], (b) => {
      b['question'] = 'Say that again.';
      b['history'] = { session_id: thread, entries: JSON.parse(JSON.stringify(entries)) as Json[] };
    });
    const r2 = await postRun(agent.url, second);
    const d2 = doneOf(r2.events);
    assert.equal(d2['status'], 'complete');
    const seen = agent.app.faux!.seen(thread);
    assert.deepEqual(
      seen[0]?.roles.filter((r) => r !== 'system'),
      ['user', 'assistant', 'toolResult', 'assistant', 'user'],
      'the model got the restored conversation plus the new question',
    );
    const e2 = d2['entries'] as Json[];
    assert.deepEqual(e2.slice(0, 4), entries);
    assert.equal(
      e2[4]?.['message']['content'][0]['text'],
      'Say that again.',
      "a follow-up's user turn is the question alone",
    );
    assert.equal(e2[4]?.['parentId'], entries[3]?.['id']);
  });

  test('an aborted follow-up with no text hands back the entries from BEFORE its prompt', async () => {
    const first = explain([{ text: ['An answer [b1].'] }]);
    const entries = doneOf((await postRun(agent.url, first)).events)['entries'] as Json[];
    const thread = threadId(2);
    const cancelled = explain([{ thinking: 'Working on it', stallAfterDeltas: 0 }], (b) => {
      b['question'] = 'Now read every section of the paper.';
      b['history'] = { session_id: thread, entries };
    });
    const result = await postRun(agent.url, cancelled, {
      onFrame: async (frame: Frame) => {
        if (
          frame.kind === 'event' &&
          frame.event === 'status' &&
          frame.data['phase'] === 'thinking'
        ) {
          await new Promise((r) => setTimeout(r, 50));
          assert.equal(await deleteRun(agent.url, String(cancelled['run_id'])), 204);
        }
      },
    });
    const d = doneOf(result.events);
    assert.equal(d['status'], 'aborted');
    assert.equal(d['final_text'], '');
    assert.deepEqual(d['entries'], entries, 'the cancelled question is not in the history');
    // The next turn therefore does not see (or redo) the cancelled task.
    const next = explain([{ text: ['Fine [b1].'] }], (b) => {
      b['question'] = 'Just summarise the abstract.';
      b['history'] = { session_id: thread, entries: d['entries'] as Json[] };
    });
    await postRun(agent.url, next);
    const roles = agent.app
      .faux!.seen(thread)
      .at(-1)
      ?.roles.filter((r) => r !== 'system');
    assert.deepEqual(roles, ['user', 'assistant', 'user']);
  });

  test('an aborted turn WITH text keeps it (the partial answer is part of the thread)', async () => {
    const body = explain([{ text: ['Partial [b1]', ' answer'], stallAfterDeltas: 2 }]);
    const result = await postRun(agent.url, body, {
      onFrame: async (frame: Frame, events) => {
        if (
          frame.kind === 'event' &&
          frame.event === 'text' &&
          events.filter((e) => e.event === 'text').length === 2
        ) {
          await deleteRun(agent.url, String(body['run_id']));
        }
      },
    });
    const d = doneOf(result.events);
    assert.equal(d['status'], 'aborted');
    assert.deepEqual(
      (d['entries'] as Json[]).map((e) => [
        e['message']['role'],
        e['message']['stopReason'] ?? null,
      ]),
      [
        ['user', null],
        ['assistant', 'aborted'],
      ],
    );
  });

  test('history that is not a conversation this agent produced is refused, not silently truncated', async () => {
    const body = explain([{ text: ['x [b1]'] }], (b) => {
      b['history'] = {
        session_id: threadId(3),
        entries: [
          { type: 'message', id: 'a', parentId: 'missing', message: { role: 'user', content: [] } },
        ],
      };
    });
    const result = await postRun(agent.url, body);
    assert.equal(result.status, 422);
    assert.equal((result.json as Json)['code'], 'validation_failed');
  });
});

describe('one run per thread; DELETE', () => {
  test('a second concurrent run on the same thread is 409 busy; DELETE is idempotent; unknown is 404', async () => {
    const thread = threadId(4);
    const slow = explain([{ text: ['slow [b1]', ' still', ' going'], deltaDelayMs: 300 }], (b) => {
      b['history'] = { session_id: thread, entries: [] };
    });
    const second = explain([{ text: ['x [b1]'] }], (b) => {
      b['history'] = { session_id: thread, entries: [] };
    });
    let busy: Awaited<ReturnType<typeof postRun>> | undefined;
    const first = postRun(agent.url, slow, {
      onFrame: async (frame) => {
        if (busy === undefined && frame.kind === 'event' && frame.event === 'status')
          busy = await postRun(agent.url, second);
      },
    });
    const r1 = await first;
    assert.ok(busy, 'the second request was made while the first streamed');
    assert.equal(busy.status, 409);
    assert.equal((busy.json as Json)['code'], 'busy');
    assert.equal(doneOf(r1.events)['status'], 'complete');
    assert.equal(await deleteRun(agent.url, String(slow['run_id'])), 204, 'a finished run: 204');
    assert.equal(await deleteRun(agent.url, String(slow['run_id'])), 204, 'again: 204');
    assert.equal(await deleteRun(agent.url, runId(999_999)), 404);
    assert.equal(await deleteRun(agent.url, String(slow['run_id']), null), 401);
    const reused = await postRun(agent.url, { ...slow, request_id: requestId(4242) });
    assert.equal(reused.status, 409, 'a run id is used once');
  });

  test('a client that goes away aborts its run', async () => {
    const body = explain([
      { text: ['streaming [b1]', ...Array.from({ length: 40 }, () => ' more')], deltaDelayMs: 100 },
    ]);
    const controller = new AbortController();
    await postRun(agent.url, body, {
      signal: controller.signal,
      onFrame: (frame) => {
        if (frame.kind === 'event' && frame.event === 'text') controller.abort();
      },
    }).catch(() => undefined);
    for (let i = 0; i < 100 && agent.app.health().active_runs > 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(agent.app.health().active_runs, 0);
    const doneLog = agent.logs.find(
      (l) => l.event === 'agent.run.done' && l['run_id'] === body['run_id'],
    );
    assert.equal(doneLog?.['status'], 'aborted');
    assert.equal(doneLog?.['error_code'], 'aborted');
  });
});

describe('tool failures (§3.3): short, user-safe, and a dead tool route ends the run', () => {
  for (const [label, answer, fatal] of [
    [
      '404 -> the model is told the passage is not available and carries on',
      { status: 404, body: { detail: 'x', code: 'not_found', retryable: false } },
      false,
    ],
    [
      '500 -> tool_failed',
      { status: 500, body: { detail: 'boom', code: 'internal', retryable: true } },
      true,
    ],
    [
      '401 (grant gone) -> tool_failed',
      { status: 401, body: { detail: 'no', code: 'auth_required', retryable: false } },
      true,
    ],
    ['a body that is not the §4 shape -> tool_failed', { status: 200, raw: '{"text": 3}' }, true],
  ] as Array<[string, ToolAnswer, boolean]>) {
    test(label, async () => {
      toolAnswer = () => answer;
      const body = explain([
        { toolCalls: [{ name: 'get_passage', arguments: { handle: 'b9' } }] },
        { text: ['The paper does not say [b1].'] },
      ]);
      const result = await postRun(agent.url, body);
      const d = doneOf(result.events);
      const toolResult = (d['entries'] as Json[]).find(
        (e) => e['message']['role'] === 'toolResult',
      );
      if (fatal) {
        assert.equal(d['error']?.['code'], 'tool_failed');
        assert.equal(d['error']?.['retryable'], true);
      } else {
        assert.equal(d['status'], 'complete');
        assert.equal(toolResult?.['message']['content'][0]['text'], 'Passage b9 is not available.');
      }
      const shown = JSON.stringify(d['entries']);
      assert.doesNotMatch(
        shown,
        /127\.0\.0\.1|internal\/agent|Bearer|stack|at \w+ \(/,
        'no URL, token or stack reaches the model',
      );
    });
  }
});

describe('deadline and output length (faux)', () => {
  test('deadline_ms ends a slow answer as partial timeout', async () => {
    const body = explain(
      [{ text: ['Slow [b1]', ...Array.from({ length: 50 }, () => ' word')], deltaDelayMs: 60 }],
      (b) => {
        b['limits'] = { ...b['limits'], deadline_ms: 700 };
      },
    );
    const d = doneOf((await postRun(agent.url, body)).events);
    assert.equal(d['status'], 'partial');
    assert.equal(d['error']['code'], 'timeout');
    assert.equal(
      d['error']['message'],
      'The answer took longer than allowed, so it is incomplete.',
    );
  });

  test('stopReason length -> output_truncated, partial', async () => {
    const body = explain([{ text: ['Cut off at the cap [b1]'], stopReason: 'length' }]);
    const d = doneOf((await postRun(agent.url, body)).events);
    assert.equal(d['status'], 'partial');
    assert.deepEqual(d['error'], {
      code: 'output_truncated',
      retryable: true,
      message: 'The answer reached its length limit, so it is incomplete.',
    });
  });
});

describe('the disposed-session guard (spike-verify must-fix 4)', () => {
  test('a disposed session is never prompted: prompt() throws and the model is never called', async () => {
    const faux = agent.app.faux!;
    const quiet = createLogger({ write: () => {} });
    const session = await createPaperSession({
      modelRuntime: agent.app.modelRuntime,
      model: faux.model,
      maxOutputTokens: 256,
      maxRetries: 0,
      systemPrompt: 'probe',
      tools: createPaperTools({
        baseUrl: 'http://127.0.0.1:9/internal/agent/runs/run_x',
        token: 't',
        requestId: 'r',
        runId: 'run_x',
        log: quiet,
        callIndex: () => undefined,
        maxToolCalls: 1,
        onResult() {},
        onFatal() {},
      }),
      sessionId: 'disposed-probe',
      entries: [],
    });
    faux.load('disposed-probe', [{ text: ['must never be asked'] }]);
    session.dispose();
    assert.equal(session.isDisposed, true);
    await assert.rejects(() => session.prompt('hello'), DisposedSessionError);
    assert.equal(faux.requests('disposed-probe'), 0, 'no model request was made');
    faux.forget('disposed-probe');
  });
});

describe('logs (§8)', () => {
  test('agent.run.start / agent.tool / agent.run.done carry the run and request ids; no secret, token or key', async () => {
    toolAnswer = () => passage('b3');
    const body = explain([
      { toolCalls: [{ name: 'get_passage', arguments: { handle: 'b3' } }] },
      { text: ['Logged [b3].'] },
    ]);
    await postRun(agent.url, body);
    const mine = agent.logs.filter((l) => l['run_id'] === body['run_id']);
    const events = mine.map((l) => l.event);
    for (const e of ['agent.run.start', 'agent.tool', 'agent.run.done'])
      assert.ok(events.includes(e), `${e} logged`);
    for (const l of mine) assert.equal(l['request_id'], body['request_id']);
    const doneLine = mine.find((l) => l.event === 'agent.run.done')!;
    for (const key of ['stop_reason', 'tokens', 'cost_usd_est', 'retries', 'tool_calls'])
      assert.ok(key in doneLine, key);
    const all = agent.rawLogs.join('\n');
    assert.ok(!all.includes(SECRET), 'the agent secret');
    assert.ok(!all.includes(String(body['tool']['token'])), 'the run token');
    for (const line of agent.rawLogs) assert.equal((JSON.parse(line) as Json)['service'], 'agent');
  });
});
