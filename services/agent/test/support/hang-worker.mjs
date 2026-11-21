// A stand-in for mermaid-worker.ts that starts, says it is ready, and never answers a parse
// (mermaid-parse.test.ts: a hung parse must be timed out and the thread replaced).
import { parentPort } from 'node:worker_threads';

parentPort.on('message', () => {});
// oxlint-disable-next-line unicorn/require-post-message-target-origin
parentPort.postMessage({ ready: true });
