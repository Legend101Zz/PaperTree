/**
 * One answer, not one refusal (contracts/README.md): the agent's runtime checks must ACCEPT and
 * REFUSE the same things as the committed schemas, read by ajv.
 *
 *   - the request: typebox/schema over run-request.schema.json (what the agent runs) vs ajv
 *   - the tool parameters: the TypeBox schemas the agent registers vs internal-tools.schema.json
 *   - the §3.2 marker regex, the §3.3 error table (pure functions)
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Value } from 'typebox/value';

import { classifyHostAbort, classifyProviderError, mayRetry } from '../src/classify.ts';
import { parseMarkers, validateRunRequest } from '../src/contract.ts';
import { parseHeaders, parseLabel, stripDatamark, TOOL_PARAMETERS } from '../src/tools.ts';

import { readExample, toolParamsValidator, validateRequest } from './support/contract.ts';

type Json = Record<string, any>;

const clone = (b: Json): Json => structuredClone(b);

function mutations(): Array<[string, unknown]> {
  const explain = readExample('explain');
  const followup = readExample('followup');
  const summary = readExample('summary');
  const set = (b: Json, f: (x: Json) => void): Json => {
    const c = clone(b);
    f(c);
    return c;
  };
  return [
    ['explain example', explain],
    ['follow-up example', followup],
    ['summary example', summary],
    ['summary with a seed', set(summary, (b) => (b['seed'] = explain['seed']))],
    ['explain without a seed', set(explain, (b) => (b['seed'] = null))],
    [
      'ask without a seed',
      set(
        explain,
        (b) => ((b['kind'] = 'ask'), (b['prompt_version'] = 'ask-v1'), (b['seed'] = null)),
      ),
    ],
    ['bad datamark', set(explain, (b) => (b['datamark'] = '^XYZ'))],
    ['datamark upper hex', set(explain, (b) => (b['datamark'] = '^7F3A91C2'))],
    ['extra top-level field', set(explain, (b) => (b['extra'] = 1))],
    ['extra limit', set(explain, (b) => (b['limits']['extra'] = 1))],
    ['limits deadline 0', set(explain, (b) => (b['limits']['deadline_ms'] = 0))],
    ['limits max_tool_calls 0', set(explain, (b) => (b['limits']['max_tool_calls'] = 0))],
    ['limits float', set(explain, (b) => (b['limits']['idle_ms'] = 1.5))],
    ['empty question', set(explain, (b) => (b['question'] = ''))],
    ['2001-char question', set(explain, (b) => (b['question'] = 'q'.repeat(2001)))],
    ['2000-char question', set(explain, (b) => (b['question'] = 'q'.repeat(2000)))],
    ['short token', set(explain, (b) => (b['tool']['token'] = 'short'))],
    ['run id lowercase', set(explain, (b) => (b['run_id'] = 'run_01k63ae8m4q2t7v9x3b5n6r0c1'))],
    [
      'base_url without /internal',
      set(
        explain,
        (b) =>
          (b['tool']['base_url'] = 'http://127.0.0.1:8000/runs/run_01K63AE8M4Q2T7V9X3B5N6R0C1'),
      ),
    ],
    ['seed passage bad handle', set(explain, (b) => (b['seed']['passages'][0]['handle'] = 'x1'))],
    ['seed passage extra', set(explain, (b) => (b['seed']['passages'][0]['x'] = 1))],
    ['seed section null', set(explain, (b) => (b['seed']['section'] = null))],
    ['page_count null', set(explain, (b) => (b['paper']['page_count'] = null))],
    ['generation 0', set(explain, (b) => (b['paper']['generation'] = 0))],
    ['history session id bad', set(followup, (b) => (b['history']['session_id'] = 'thread-1'))],
    ['history entries not objects', set(followup, (b) => (b['history']['entries'] = ['x']))],
    ['kind unknown', set(explain, (b) => (b['kind'] = 'chat'))],
    ['not an object', 'hello'],
    ['null', null],
  ];
}

describe("the request: the agent's runtime check vs ajv on the committed schema", () => {
  for (const [name, body] of mutations()) {
    test(name, () => {
      const byAjv = validateRequest(body) === true;
      const byAgent = validateRunRequest(body).ok;
      assert.equal(byAgent, byAjv, `agent ${String(byAgent)}, ajv ${String(byAjv)}`);
    });
  }

  test('what only the agent adds: the kind/prompt pairing, the base_url suffix, the history chain', () => {
    const explain = readExample('explain');
    const mismatch = { ...structuredClone(explain), prompt_version: 'ask-v1' };
    assert.equal(validateRequest(mismatch), true, 'the schema allows it (S0 left it open)');
    assert.equal(validateRunRequest(mismatch).ok, false);
    const followup = readExample('followup');
    assert.equal(
      validateRunRequest(followup).ok,
      true,
      "the follow-up example's history is a valid chain",
    );
    const broken = structuredClone(followup);
    broken['history']['entries'][2]['parentId'] = 'nope';
    assert.equal(validateRequest(broken), true);
    assert.equal(
      validateRunRequest(broken).ok,
      false,
      'a broken parent chain would truncate the restored history',
    );
  });
});

describe('the tool parameters: the TypeBox the agent registers vs internal-tools.schema.json', () => {
  const cases: Record<keyof typeof TOOL_PARAMETERS, unknown[]> = {
    get_outline: [{}, { handle: 'b1' }, null],
    get_section: [
      { handle: 'b3' },
      { handle: 'b3', cursor: 'c1' },
      { handle: 'b3', cursor: '' },
      { handle: 'b3', cursor: 'x'.repeat(65) },
      { handle: '3' },
      {},
      { handle: 'b3', extra: 1 },
    ],
    get_passage: [{ handle: 'b12' }, { handle: 'B12' }, { handle: 'b' }, {}, { handle: 12 }],
    search_passages: [
      { query: 'grid' },
      { query: 'grid', limit: 8 },
      { query: 'grid', limit: 9 },
      { query: 'grid', limit: 0 },
      { query: '' },
      { query: 'q'.repeat(501) },
      { query: 'grid', limit: 2.5 },
      {},
    ],
  };
  const defs: Record<keyof typeof TOOL_PARAMETERS, string> = {
    get_outline: 'GetOutlineParams',
    get_section: 'GetSectionParams',
    get_passage: 'GetPassageParams',
    search_passages: 'SearchPassagesParams',
  };
  for (const [tool, list] of Object.entries(cases) as Array<
    [keyof typeof TOOL_PARAMETERS, unknown[]]
  >) {
    test(tool, () => {
      const ajv = toolParamsValidator(defs[tool]);
      for (const args of list) {
        assert.equal(
          Value.Check(TOOL_PARAMETERS[tool], args),
          ajv(args) === true,
          `${tool} ${JSON.stringify(args)}`,
        );
      }
    });
  }
});

describe('pure pieces', () => {
  test('markers: the §3.2 regex, deduplicated, first-seen order', () => {
    assert.deepEqual(parseMarkers('a [b2] b [b1, b3] c [b2][b10] d [b1,b2]'), [
      'b2',
      'b1',
      'b3',
      'b10',
    ]);
    assert.deepEqual(parseMarkers('[B1] [b] [1] (b2) [b 3]'), []);
  });

  test('headers: `[bN] (p. · section · type)`, inline or datamarked', () => {
    const outline =
      '^7f3a91c2 [b1] ^7f3a91c2 (p. ^7f3a91c2 1 ^7f3a91c2 · ^7f3a91c2 Abstract ^7f3a91c2 · ^7f3a91c2 heading) ^7f3a91c2 Abstract ^7f3a91c2 [b3] ^7f3a91c2 (p. ^7f3a91c2 2 ^7f3a91c2 · ^7f3a91c2 2. ^7f3a91c2 Unified ^7f3a91c2 Detection ^7f3a91c2 · ^7f3a91c2 heading)';
    assert.deepEqual(parseHeaders(stripDatamark(outline, '^7f3a91c2')), [
      ['b1', { page: 'p. 1', section: 'Abstract' }],
      ['b3', { page: 'p. 2', section: '2. Unified Detection' }],
    ]);
    assert.deepEqual(parseHeaders('[b7] (p. 4 · 3.1 Loss (L1) · paragraph)\ntext'), [
      ['b7', { page: 'p. 4', section: '3.1 Loss (L1)' }],
    ]);
    assert.deepEqual(parseLabel('p. 1 · Abstract · paragraph'), {
      page: 'p. 1',
      section: 'Abstract',
    });
    // Seen live: a section title's own line break reached a status label ("3.2\nAttention").
    assert.deepEqual(parseLabel('p. 4 ·  3.2\nAttention  · paragraph'), {
      page: 'p. 4',
      section: '3.2 Attention',
    });
  });

  test('the §3.3 error table', () => {
    const table: Array<[string | undefined, string, boolean]> = [
      ['401 {"type":"error"}', 'provider_auth', false],
      ['403 forbidden', 'provider_auth', false],
      ['429 {"error":{"message":"insufficient_quota"}}', 'quota', false],
      ['429 billing hard limit', 'quota', false],
      ['429 your balance is low', 'quota', false],
      ['429 rate limited', 'rate_limited', true],
      ['500 oops', 'upstream_unavailable', true],
      ['503 overloaded', 'upstream_unavailable', true],
      ['599 edge', 'upstream_unavailable', true],
      ['400 max_tokens must be <= 500000', 'bad_request', false],
      ['404 no model', 'internal', false],
      ['Request timed out.', 'upstream_unavailable', true],
      ['fetch failed', 'upstream_unavailable', true],
      ['Connection error.', 'upstream_unavailable', true],
      ['terminated', 'upstream_unavailable', true],
      ['Anthropic stream ended before message_stop', 'internal', false],
      ['something 500 happened', 'internal', false],
      [undefined, 'internal', false],
    ];
    for (const [message, code, retryable] of table) {
      assert.deepEqual(classifyProviderError(message), { code, retryable }, String(message));
    }
    assert.deepEqual(classifyHostAbort('tool_budget'), {
      code: 'tool_budget_exhausted',
      retryable: false,
    });
    assert.deepEqual(classifyHostAbort('idle'), { code: 'timeout', retryable: true });
    assert.deepEqual(classifyHostAbort('deadline'), { code: 'timeout', retryable: true });
    assert.deepEqual(classifyHostAbort('client'), { code: 'aborted', retryable: true });
    assert.deepEqual(classifyHostAbort('tool_failed'), { code: 'tool_failed', retryable: true });
    assert.equal(mayRetry('upstream_unavailable', false), true);
    assert.equal(mayRetry('rate_limited', false), true);
    assert.equal(mayRetry('upstream_unavailable', true), false, 'never after text');
    assert.equal(mayRetry('bad_request', false), false);
    assert.equal(mayRetry('internal', false), false);
  });
});
