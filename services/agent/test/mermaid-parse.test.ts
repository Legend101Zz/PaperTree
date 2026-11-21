/**
 * The worker-thread parser (mermaid-parse.ts, v0.3 W6): a real `mermaid.parse`, kept out of the
 * main thread's globals, replaced when it hangs, and open (never throwing) when it cannot start.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { MermaidParser } from '../src/mermaid-parse.ts';

const parser = new MermaidParser();
after(() => parser.close());

const FENCE =
  'flowchart TD\n  subgraph s["Group"]\n    a["Query"] -->|"ranked"| b["Merge"]\n  end\n  b --> c["Results"]';

describe('mermaid.parse in a worker thread', () => {
  test('a valid fence is ok; an invalid one carries the parser’s own words', async () => {
    assert.deepEqual(await parser.parse(FENCE), { status: 'ok' });
    const bad = await parser.parse('flowchart TD\n  a --> b  c --> d');
    assert.equal(bad.status, 'invalid');
    assert.match(bad.status === 'invalid' ? bad.error : '', /Parse error/);
    const empty = await parser.parse('notadiagram\n  x');
    assert.equal(empty.status, 'invalid');
  });

  test('every diagram type the prompt offers parses', async () => {
    for (const body of [
      'sequenceDiagram\n  A->>B: hi',
      'stateDiagram-v2\n  [*] --> A\n  A --> B',
      'mindmap\n  root((R))\n    A\n    B',
      'timeline\n  title T\n  2000 : a\n  2001 : b',
      'quadrantChart\n  x-axis L --> H\n  y-axis L --> H\n  A: [0.5, 0.5]',
      'xychart-beta\n  x-axis [a, b]\n  line [1, 2]',
      'classDiagram\n  class A\n  A <|-- B',
      'erDiagram\n  A ||--o{ B : has',
    ]) {
      assert.deepEqual(await parser.parse(body), { status: 'ok' }, body.split('\n')[0]);
    }
  });

  test('the DOM shim lives in the worker only: the main thread gets no window or document', async () => {
    await parser.parse(FENCE);
    const scope = globalThis as unknown as Record<string, unknown>;
    assert.equal(typeof scope['window'], 'undefined');
    assert.equal(typeof scope['document'], 'undefined');
    assert.equal(typeof scope['DOMPurify'], 'undefined');
  });

  // Warm parses run 11-18 ms here; on a loaded CI runner (turbo runs every package's tests at once) the
  // median reached 51.5 ms. What this guards is the warm worker: a cold DOM per parse costs ~150 ms, so
  // 120 ms still fails that regression without failing on a busy machine (cf. #80, a wall-clock flake).
  test('a parse of a typical fence is fast once the worker is warm (median under 120 ms)', async () => {
    await parser.warm();
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      await parser.parse(FENCE);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? Infinity;
    assert.ok(median < 120, `median ${median.toFixed(1)} ms`);
  });

  test('concurrent parses are answered to the right caller', async () => {
    const [a, b] = await Promise.all([
      parser.parse(FENCE),
      parser.parse('flowchart TD\n  a --> b  c --> d'),
    ]);
    assert.equal(a.status, 'ok');
    assert.equal(b.status, 'invalid');
  });
});

describe('when the worker cannot answer, the parse is unavailable and nothing throws', () => {
  test('a worker that never answers is timed out, replaced, and the next parse starts a new one', async () => {
    const hung = new MermaidParser({
      timeoutMs: 60,
      workerUrl: new URL('./support/hang-worker.mjs', import.meta.url),
    });
    try {
      const first = await hung.parse(FENCE);
      assert.deepEqual(first, { status: 'unavailable', reason: 'parse timeout' });
      assert.equal(hung.starts, 1);
      const second = await hung.parse(FENCE);
      assert.equal(second.status, 'unavailable');
      assert.equal(hung.starts, 2, 'the stuck thread was replaced');
    } finally {
      await hung.close();
    }
  });

  test('a worker file that does not exist: unavailable, not a throw', async () => {
    const missing = new MermaidParser({
      workerUrl: new URL('./support/does-not-exist.mjs', import.meta.url),
    });
    try {
      assert.equal((await missing.parse(FENCE)).status, 'unavailable');
    } finally {
      await missing.close();
    }
  });
});
