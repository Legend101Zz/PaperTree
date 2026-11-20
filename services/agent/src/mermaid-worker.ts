/**
 * The worker thread that runs `mermaid.parse` (see mermaid-parse.ts for why it is a worker).
 *
 * Mermaid's parser reaches DOMPurify at module load and at parse time, and DOMPurify needs a
 * `window`. happy-dom supplies one HERE, in this thread's own isolate: the `window`/`document`
 * globals below exist nowhere else in the service. Nothing in this file is imported by any other
 * module; the thread is started with `new Worker(<this file>)`.
 *
 * Protocol: the parent posts `{ id, text }`; this answers `{ id, ok: true }` or
 * `{ id, ok: false, error }` (the parser's first lines). On start it posts `{ ready: true }` once
 * every diagram type's parser chunk is loaded (a sample of each is parsed), so the first real
 * parse costs milliseconds, not the ~150 ms of a cold chunk import.
 */
import { parentPort } from 'node:worker_threads';

import { Window } from 'happy-dom';

if (parentPort === null) throw new Error('mermaid-worker.ts is a worker thread, not a module.');
const port = parentPort;

const dom = new Window();
const scope = globalThis as unknown as Record<string, unknown>;
scope['window'] = dom;
scope['document'] = dom.document;

const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

/** One tiny valid fence per type the prompt offers, parsed once at start to load its chunk. */
const SAMPLES = [
  'flowchart TD\n  a --> b',
  'sequenceDiagram\n  A->>B: hi',
  'stateDiagram-v2\n  [*] --> A',
  'mindmap\n  root((R))\n    A',
  'timeline\n  2000 : a',
  'quadrantChart\n  x-axis L --> H\n  y-axis L --> H\n  A: [0.5, 0.5]',
  'xychart-beta\n  x-axis [a, b]\n  line [1, 2]',
  'classDiagram\n  class A',
  'erDiagram\n  A ||--o{ B : has',
];
for (const sample of SAMPLES) await mermaid.parse(sample).catch(() => undefined);

/** The first lines of a parser error, trimmed: enough for a repair request, never a stack. */
function brief(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(0, 4)
    .join('\n')
    .slice(0, 400);
}

port.on('message', (message: { id: number; text: string }) => {
  mermaid.parse(message.text).then(
    () => port.postMessage({ id: message.id, ok: true }),
    (error: unknown) => port.postMessage({ id: message.id, ok: false, error: brief(error) }),
  );
});
port.postMessage({ ready: true });
