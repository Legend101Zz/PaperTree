/**
 * contracts.md §9: "the emitted SSE for the faux-provider scripts equals
 * contracts/agent/fixtures/*.sse in event order and shape".
 *
 * Each recording is replayed as a faux script (support/scenarios.ts) through the REAL service:
 * HTTP, the secret check, request validation against the committed schema, `createPaperSession()`,
 * Pi's agent loop, the four tools over HTTP to a stand-in for the API's routes, and the guards.
 * Then the stream the agent emitted is compared with the recording:
 *
 *   - the same events in the same order (heartbeat comments are not events; they are timing, and
 *     test/heartbeat.test.ts holds them to one per interval);
 *   - `run`, `status` (phase, tool, label, attempt, delay_ms), `text` and `usage` exactly;
 *   - `done` exactly, except `first_text_ms` / `latency_ms` (timing: null-ness and type only) and
 *     `entries` (Pi mints entry ids and timestamps: compared message by message — roles, content,
 *     tool calls, stop reasons, usage — and the parent chain);
 *   - every emitted frame validates against run-events.schema.json (ajv), and the stream holds the
 *     semantics test_agent_contracts.py holds the recordings to.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { RunRequest } from '../src/contract.ts';
import type { FauxStep } from '../src/faux.ts';

import { FIXTURE_NAMES, type Fixture, readFixture, semanticProblems } from './support/contract.ts';
import {
  type Agent,
  deleteRun,
  postRun,
  startAgent,
  startToolServer,
  type ToolHit,
  type ToolServer,
} from './support/harness.ts';
import { type Scenario, scenario } from './support/scenarios.ts';

let current: Scenario | undefined;
let tools: ToolServer;
let agent: Agent;

before(async () => {
  tools = await startToolServer((hit: ToolHit) => {
    if (!current) throw new Error('no scenario');
    return current.tools(hit);
  });
  agent = await startAgent({
    apiOrigin: tools.origin,
    brain: (request: RunRequest): readonly FauxStep[] => {
      if (!current || request.run_id !== current.request['run_id'])
        throw new Error('brain asked for an unknown run');
      return current.steps;
    },
  });
});

after(async () => {
  await agent?.close();
  await tools?.close();
});

type Json = Record<string, any>;

function normaliseUsage(usage: Json | undefined): Json | undefined {
  if (!usage) return usage;
  return {
    input: usage['input'],
    output: usage['output'],
    cacheRead: usage['cacheRead'],
    cacheWrite: usage['cacheWrite'],
    reasoning: usage['reasoning'] ?? null,
    total: usage['cost']?.['total'],
  };
}

function normaliseContent(content: Json[]): Json[] {
  return content.map((block) => {
    switch (block['type']) {
      case 'text':
        return { type: 'text', text: block['text'] };
      case 'thinking':
        return { type: 'thinking', thinking: block['thinking'] };
      case 'toolCall':
        return {
          type: 'toolCall',
          id: block['id'],
          name: block['name'],
          arguments: block['arguments'],
        };
      default:
        return { type: block['type'] };
    }
  });
}

/** One entry as the comparison sees it: everything but Pi-minted ids, timestamps and provider names. */
function normaliseEntry(entry: Json): Json {
  const m = entry['message'] as Json;
  const base: Json = {
    type: entry['type'],
    role: m['role'],
    content: normaliseContent(m['content'] as Json[]),
  };
  if (m['role'] === 'assistant') {
    base['stopReason'] = m['stopReason'];
    base['model'] = m['model'];
    base['usage'] = normaliseUsage(m['usage'] as Json);
  }
  if (m['role'] === 'toolResult') {
    base['toolCallId'] = m['toolCallId'];
    base['toolName'] = m['toolName'];
    base['isError'] = m['isError'];
  }
  return base;
}

function assertChain(entries: Json[], label: string): void {
  entries.forEach((entry, i) => {
    assert.equal(typeof entry['id'], 'string', `${label}: entry ${String(i)} id`);
    assert.equal(
      entry['parentId'],
      i === 0 ? null : entries[i - 1]?.['id'],
      `${label}: entry ${String(i)} parentId`,
    );
  });
}

function compareStreams(fx: Fixture, emitted: Array<{ event: string; data: Json }>): void {
  assert.deepEqual(
    emitted.map((e) => e.event),
    fx.events.map((e) => e.event),
    `${fx.name}: event order`,
  );
  fx.events.forEach((want, i) => {
    const got = emitted[i]!;
    if (want.event !== 'done') {
      assert.deepEqual(got.data, want.data, `${fx.name}: event ${String(i)} (${want.event})`);
      return;
    }
    const {
      first_text_ms: gotFirst,
      latency_ms: gotLatency,
      entries: gotEntries,
      ...gotRest
    } = got.data;
    const {
      first_text_ms: wantFirst,
      latency_ms: _wantLatency,
      entries: wantEntries,
      ...wantRest
    } = want.data as Json;
    assert.deepEqual(gotRest, wantRest, `${fx.name}: done (all but timing and entries)`);
    assert.equal(gotFirst === null, wantFirst === null, `${fx.name}: first_text_ms null-ness`);
    if (gotFirst !== null) assert.ok(Number.isInteger(gotFirst) && gotFirst >= 0);
    assert.ok(Number.isInteger(gotLatency) && gotLatency >= 0, `${fx.name}: latency_ms`);
    const g = gotEntries as Json[];
    const w = wantEntries as Json[];
    assert.equal(g.length, w.length, `${fx.name}: entries length`);
    assert.deepEqual(
      g.map(normaliseEntry),
      w.map(normaliseEntry),
      `${fx.name}: entries, message by message`,
    );
    assertChain(g, fx.name);
  });
}

describe('the emitted stream equals the recording', () => {
  for (const name of FIXTURE_NAMES) {
    test(name, async () => {
      const fx = readFixture(name);
      current = scenario(name);
      const body = structuredClone(current.request);
      body['tool']['base_url'] = tools.baseUrl(body['run_id']);
      const hitsBefore = tools.hits.length;
      let texts = 0;
      let cancelled = false;
      const result = await postRun(agent.url, body, {
        onFrame: async (frame) => {
          if (frame.kind !== 'event' || frame.event !== 'text') return;
          texts++;
          if (current?.cancelAfterTexts === texts && !cancelled) {
            cancelled = true;
            assert.equal(await deleteRun(agent.url, body['run_id']), 204);
          }
        },
      });
      assert.equal(result.status, 200, result.text);
      assert.deepEqual(semanticProblems(result.events), [], `${name}: semantics`);
      compareStreams(fx, result.events);
      if (name === 'followup-ok') {
        // The restored history comes back verbatim at the head of the new entries.
        const got = result.events.at(-1)!.data['entries'] as Json[];
        assert.deepEqual(
          got.slice(0, body['history']['entries'].length),
          body['history']['entries'],
        );
      }
      if (name === 'tool-budget') {
        // "10 requested -> 8 served -> stop": the API saw exactly 8 tool requests.
        assert.equal(tools.hits.length - hitsBefore, 8, 'tool requests served');
      }
    });
  }
});
