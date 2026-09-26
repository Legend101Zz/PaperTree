/**
 * The REAL provider path, offline: the live MiniMax-M3 model with its baseUrl pointed at a local
 * mock Anthropic server, so pi-ai's anthropic-messages client, real HTTP/SSE and Pi's own retry
 * machinery all run. Every row of contracts.md §3.3's error table, the 400-that-mentions-"500"
 * that Pi's regex would retry, the idle watchdog on a stalled BODY (spike b4) and the deadline.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { readExample, semanticProblems } from './support/contract.ts';
import {
  type Agent,
  FAKE_KEY,
  postRun,
  runId,
  requestId,
  startAgent,
  startToolServer,
  type ToolServer,
} from './support/harness.ts';
import { type MockAnthropic, type MockStep, startMockAnthropic } from './support/mock-anthropic.ts';

const opened: Array<{ close(): Promise<void> }> = [];
after(async () => {
  for (const thing of opened.toReversed()) await thing.close();
});

let counter = 100;

interface Live {
  readonly agent: Agent;
  readonly mock: MockAnthropic;
  readonly tools: ToolServer;
}

async function live(
  steps: readonly MockStep[],
  options: { readonly providerTimeoutMs?: number; readonly closeMockFirst?: boolean } = {},
): Promise<Live> {
  const mock = await startMockAnthropic(steps, FAKE_KEY);
  opened.push(mock);
  const tools = await startToolServer(() => ({
    status: 404,
    body: { detail: 'none', code: 'not_found', retryable: false },
  }));
  opened.push(tools);
  const agent = await startAgent({
    apiOrigin: tools.origin,
    faux: false,
    modelOverride: (model) => ({ ...model, baseUrl: mock.url }),
    ...(options.providerTimeoutMs === undefined
      ? {}
      : { providerTimeoutMs: options.providerTimeoutMs }),
  });
  opened.push(agent);
  if (options.closeMockFirst) await mock.close();
  return { agent, mock, tools };
}

function request(tools: ToolServer, limits: Record<string, number> = {}): Record<string, any> {
  const body = readExample('explain');
  counter++;
  body['run_id'] = runId(counter);
  body['request_id'] = requestId(counter);
  body['tool']['base_url'] = tools.baseUrl(body['run_id']);
  body['limits'] = { ...body['limits'], ...limits };
  return body;
}

function done(result: {
  events: Array<{ event: string; data: Record<string, any> }>;
}): Record<string, any> {
  const last = result.events.at(-1);
  assert.equal(last?.event, 'done');
  return last.data;
}

const err = (status: number, type: string, message: string): MockStep => ({
  kind: 'status',
  status,
  body: { type: 'error', error: { type, message }, request_id: 'mock_req_77' },
});

describe('the real provider path against a mock Anthropic server', () => {
  test('a grounded answer, and exactly what the model is sent', async () => {
    const { agent, mock, tools } = await live([
      {
        kind: 'stream',
        thinking: 'Cite b1.',
        text: ['The paper frames detection', ' as regression [b1].'],
      },
    ]);
    const body = request(tools);
    const result = await postRun(agent.url, body);
    assert.deepEqual(semanticProblems(result.events), []);
    const d = done(result);
    assert.equal(d['status'], 'complete');
    assert.deepEqual(d['markers'], ['b1']);
    assert.equal(mock.requests.length, 1);
    const sent = mock.requests[0]!;
    assert.equal(sent.keyMatched, true, 'x-api-key is the runtime key');
    assert.equal(sent.body['model'], 'MiniMax-M3');
    assert.equal(
      sent.body['max_tokens'],
      4096,
      "max_tokens is limits.max_output_tokens, not the catalog's 512000",
    );
    assert.equal(sent.body['stream'], true);
    assert.equal(sent.body['thinking']?.['type'], 'enabled', 'thinkingLevel low');
    const tools4 = (sent.body['tools'] as Array<{ name: string }>).map((t) => t.name);
    assert.deepEqual(tools4, ['get_outline', 'get_section', 'get_passage', 'search_passages']);
    const system = (sent.body['system'] as Array<{ text: string }>).map((s) => s.text).join('\n');
    assert.match(system, /\^7f3a91c2/, "the system prompt names the run's datamark");
    assert.match(
      system,
      /\[b1\] \(p\. 1 · Abstract · paragraph\)/,
      'the seed passages are in the system prompt',
    );
    assert.doesNotMatch(
      system,
      /Volumes|PaperTree-worktrees|AGENTS\.md|CLAUDE\.md/,
      'no local path or context file reaches the model',
    );
    const messages = sent.body['messages'] as Array<{ role: string; content: unknown }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, 'user');
    assert.match(
      JSON.stringify(messages[0]?.content),
      /Explain this passage\.\\n\\nInstead, we frame object detection/,
    );
  });

  interface Row {
    readonly name: string;
    readonly steps: readonly MockStep[];
    readonly code: string | null;
    readonly retryable?: boolean;
    readonly status: string;
    readonly hits: number;
    readonly retries: number;
    readonly providerTimeoutMs?: number;
    readonly closeMockFirst?: boolean;
  }

  const ok: MockStep = { kind: 'stream', text: ['It regresses boxes directly [b1].'] };

  const rows: Row[] = [
    {
      name: '401 -> provider_auth, not retried',
      steps: [err(401, 'authentication_error', 'login fail')],
      code: 'provider_auth',
      retryable: false,
      status: 'error',
      hits: 1,
      retries: 0,
    },
    {
      name: '403 -> provider_auth, not retried',
      steps: [err(403, 'permission_error', 'forbidden')],
      code: 'provider_auth',
      retryable: false,
      status: 'error',
      hits: 1,
      retries: 0,
    },
    {
      name: '429 insufficient_quota -> quota, not retried',
      steps: [err(429, 'rate_limit_error', 'insufficient_quota: balance is 0')],
      code: 'quota',
      retryable: false,
      status: 'error',
      hits: 1,
      retries: 0,
    },
    {
      name: '429 -> rate_limited, retried once',
      steps: [err(429, 'rate_limit_error', 'slow down')],
      code: 'rate_limited',
      retryable: true,
      status: 'error',
      hits: 2,
      retries: 1,
    },
    {
      name: '500 -> upstream_unavailable, retried once',
      steps: [err(500, 'api_error', 'boom')],
      code: 'upstream_unavailable',
      retryable: true,
      status: 'error',
      hits: 2,
      retries: 1,
    },
    {
      name: '502 -> upstream_unavailable',
      steps: [err(502, 'api_error', 'bad gateway')],
      code: 'upstream_unavailable',
      retryable: true,
      status: 'error',
      hits: 2,
      retries: 1,
    },
    {
      name: '503 then 200 -> complete after one retry',
      steps: [err(503, 'overloaded_error', 'busy'), ok],
      code: null,
      status: 'complete',
      hits: 2,
      retries: 1,
    },
    {
      name: '400 -> bad_request, not retried',
      steps: [err(400, 'invalid_request_error', 'messages: bad role')],
      code: 'bad_request',
      retryable: false,
      status: 'error',
      hits: 1,
      retries: 0,
    },
    {
      name: "a 400 whose text contains 500 is NOT retried (Pi's regex would)",
      steps: [err(400, 'invalid_request_error', 'max_tokens must be <= 500000')],
      code: 'bad_request',
      retryable: false,
      status: 'error',
      hits: 1,
      retries: 0,
    },
    {
      name: '418 -> internal (anything else)',
      steps: [err(418, 'teapot', 'short and stout')],
      code: 'internal',
      retryable: false,
      status: 'error',
      hits: 1,
      retries: 0,
    },
    {
      name: "a body cut short -> internal, not retried (Pi's regex would)",
      steps: [{ kind: 'stream', text: ['Half an answer [b1]'], omitStop: true }],
      code: 'internal',
      retryable: false,
      status: 'partial',
      hits: 1,
      retries: 0,
    },
    {
      name: 'a provider error mid-stream after text -> partial; its raw text reaches neither text nor entries',
      steps: [
        {
          kind: 'stream',
          text: ['Half an answer [b1]'],
          errorAfterText: { type: 'overloaded_error', message: 'mock_req_77 upstream overloaded' },
        },
      ],
      code: 'internal',
      retryable: false,
      status: 'partial',
      hits: 1,
      retries: 0,
    },
    {
      name: 'stop_reason max_tokens -> output_truncated, partial',
      steps: [
        { kind: 'stream', text: ['The answer reached', ' its cap [b1]'], stopReason: 'max_tokens' },
      ],
      code: 'output_truncated',
      retryable: true,
      status: 'partial',
      hits: 1,
      retries: 0,
    },
    {
      name: "no response headers -> 'timed out' -> upstream_unavailable, retried once",
      steps: [{ kind: 'hang-before-headers' }],
      code: 'upstream_unavailable',
      retryable: true,
      status: 'error',
      hits: 2,
      retries: 1,
      providerTimeoutMs: 500,
    },
    {
      name: "connection refused ('fetch failed' / 'Connection error.') -> upstream_unavailable",
      steps: [ok],
      code: 'upstream_unavailable',
      retryable: true,
      status: 'error',
      hits: 0,
      retries: 1,
      closeMockFirst: true,
    },
  ];

  for (const row of rows) {
    test(`error map: ${row.name}`, async () => {
      const { agent, mock, tools } = await live(row.steps, {
        ...(row.providerTimeoutMs === undefined
          ? {}
          : { providerTimeoutMs: row.providerTimeoutMs }),
        ...(row.closeMockFirst ? { closeMockFirst: true } : {}),
      });
      const result = await postRun(agent.url, request(tools));
      assert.equal(result.status, 200);
      assert.deepEqual(semanticProblems(result.events), []);
      const d = done(result);
      assert.equal(d['status'], row.status);
      if (row.code === null) {
        assert.equal(d['error'], null);
      } else {
        assert.equal(d['error']?.['code'], row.code);
        assert.equal(d['error']?.['retryable'], row.retryable);
      }
      assert.equal(mock.requests.length, row.hits, 'model requests made');
      assert.equal(d['retries'], row.retries, 'retries reported');
      // The provider's own words (JSON, request ids) never reach the stream.
      assert.doesNotMatch(
        result.text,
        /mock_req_77|authentication_error|invalid_request_error|max_tokens must be|insufficient_quota/,
      );
      const info = agent.rawLogs.filter((line) => !line.includes('"level":"debug"')).join('\n');
      assert.doesNotMatch(
        info,
        /mock_req_77|max_tokens must be/,
        'raw provider text only at debug level',
      );
      if (
        row.code !== null &&
        row.hits > 0 &&
        row.code !== 'output_truncated' &&
        row.code !== 'internal'
      ) {
        assert.ok(
          agent.logs.some((l) => l.event === 'agent.provider.error' && l.level === 'debug'),
          'the raw message is kept at debug',
        );
      }
    });
  }

  test('idle watchdog: a stalled body is aborted after idle_ms of silence (ratio)', async () => {
    const idle = 1_500;
    const { agent, mock, tools } = await live([
      {
        kind: 'stream',
        text: ['The detector regresses boxes [b1]', ' and then'],
        stallAfterText: 2,
      },
    ]);
    const body = request(tools, { idle_ms: idle });
    const result = await postRun(agent.url, body);
    const d = done(result);
    assert.equal(d['status'], 'partial');
    assert.equal(d['error']?.['code'], 'timeout');
    assert.equal(d['final_text'], 'The detector regresses boxes [b1] and then');
    assert.equal(mock.requests.length, 1, 'a timeout is not retried by the agent');
    const abort = agent.logs.find(
      (l) => l.event === 'agent.run.abort' && l['run_id'] === body['run_id'],
    );
    assert.equal(abort?.['reason'], 'idle');
    const lastText = result.frames.filter((f) => f.kind === 'event' && f.event === 'text').at(-1)!;
    const gap = Number(abort['ms']) - lastText.at;
    const ratio = gap / idle;
    // Contract: 20 s +/- 1 s (5 %). Measured here on a short idle; the slack covers the event loop.
    assert.ok(
      ratio >= 0.95 && ratio <= 1.1,
      `abort ${String(gap)} ms after the last event (ratio ${ratio.toFixed(3)})`,
    );
  });

  test('idle watchdog: every event resets it, so a steady answer longer than idle_ms completes', async () => {
    // The ratio test above cannot tell "idle_ms after the last event" from "idle_ms after the
    // prompt": its stall starts right after the prompt. Here the answer takes several idle_ms in
    // total, and no single gap is anywhere near one; a watchdog that is not reset cuts it at idle_ms.
    const idle = 1_500;
    const gap = 300;
    const { agent, mock, tools } = await live([
      {
        kind: 'stream',
        thinking: 'Cite b1.',
        text: ['A steady answer [b1]', ...Array.from({ length: 11 }, () => ' word')],
        deltaDelayMs: gap,
      },
    ]);
    const body = request(tools, { idle_ms: idle });
    const result = await postRun(agent.url, body);
    const d = done(result);
    assert.deepEqual(semanticProblems(result.events), []);
    assert.equal(
      d['status'],
      'complete',
      `ended ${String(d['status'])}: ${JSON.stringify(d['error'])}`,
    );
    assert.equal(d['final_text'], `A steady answer [b1]${' word'.repeat(11)}`);
    assert.ok(
      Number(d['latency_ms']) >= 2 * idle,
      `the run lasted ${String(d['latency_ms'])} ms, at least twice idle_ms`,
    );
    const texts = result.frames.filter((f) => f.kind === 'event' && f.event === 'text');
    const widest = Math.max(...texts.slice(1).map((f, i) => f.at - texts[i]!.at));
    assert.ok(widest < idle, `no gap of idle_ms between deltas (widest ${String(widest)} ms)`);
    assert.equal(mock.requests.length, 1);
    assert.equal(
      agent.logs.some((l) => l.event === 'agent.run.abort' && l['run_id'] === body['run_id']),
      false,
      'the watchdog never fired',
    );
  });

  test('deadline: the run is aborted at deadline_ms -> timeout', async () => {
    const deadline = 1_200;
    const { agent, tools } = await live([
      {
        kind: 'stream',
        text: Array.from({ length: 30 }, (_, i) => ` part ${String(i)} [b1]`),
        deltaDelayMs: 150,
      },
    ]);
    const body = request(tools, { deadline_ms: deadline });
    const result = await postRun(agent.url, body);
    const d = done(result);
    assert.equal(d['status'], 'partial');
    assert.equal(d['error']?.['code'], 'timeout');
    assert.equal(d['error']?.['retryable'], true);
    const abort = agent.logs.find(
      (l) => l.event === 'agent.run.abort' && l['run_id'] === body['run_id'],
    );
    assert.equal(abort?.['reason'], 'deadline');
    const at = Number(abort['ms']);
    assert.ok(
      at >= deadline - 20 && at <= deadline * 1.15,
      `aborted at ${String(at)} ms for a ${String(deadline)} ms deadline`,
    );
  });
});
