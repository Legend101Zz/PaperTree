/**
 * §3.2: a `: ping` comment every 5 s. The recordings carry `latency_ms // 5000` of them; replayed
 * fast, a stream has none, so the cadence is held here instead: once on a short interval (count and
 * placement), once at the real 5 s.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_PING_MS } from '../src/app.ts';
import type { RunRequest } from '../src/contract.ts';

import { readExample } from './support/contract.ts';
import { postRun, startAgent, startToolServer } from './support/harness.ts';

async function slowRun(pingMs: number | undefined, deltas: number, deltaDelayMs: number) {
  const tools = await startToolServer(() => ({ status: 404, body: {} }));
  let agent: Awaited<ReturnType<typeof startAgent>> | undefined;
  try {
    agent = await startAgent({
      apiOrigin: tools.origin,
      ...(pingMs === undefined ? {} : { pingMs }),
      brain: (_: RunRequest) => [
        { text: ['Slowly [b1]', ...Array.from({ length: deltas - 1 }, () => ' on')], deltaDelayMs },
      ],
    });
    const body = readExample('explain');
    body['tool']['base_url'] = tools.baseUrl(body['run_id']);
    return await postRun(agent.url, body);
  } finally {
    await agent?.close();
    await tools.close();
  }
}

describe('the heartbeat', () => {
  test('the default interval is 5 s', () => {
    assert.equal(DEFAULT_PING_MS, 5_000);
  });

  test('one `: ping` per interval, between frames, as a bare comment', async () => {
    const result = await slowRun(100, 12, 100);
    const pings = result.frames.filter((f) => f.kind === 'ping');
    const done = result.events.at(-1)!.data;
    const latency = Number(done['latency_ms']);
    const expected = Math.floor(latency / 100);
    assert.ok(
      Math.abs(pings.length - expected) <= 2,
      `${String(pings.length)} pings for ${String(latency)} ms`,
    );
    assert.equal(
      result.text.split(': ping\n\n').length - 1,
      pings.length,
      'each ping is exactly `: ping\\n\\n`',
    );
    assert.equal(result.frames[0]?.kind, 'event', 'the stream opens with `run`, not a ping');
    assert.equal(result.frames.at(-1)?.kind, 'event', 'and ends with `done`');
  });

  test('at the real 5 s cadence: pings == latency_ms // 5000 (as in the recordings)', async () => {
    const result = await slowRun(undefined, 12, 470);
    const pings = result.frames.filter((f) => f.kind === 'ping').length;
    const latency = Number(result.events.at(-1)!.data['latency_ms']);
    assert.ok(latency > 5_000, `the run took ${String(latency)} ms`);
    assert.equal(pings, Math.floor(latency / 5_000));
  });
});
