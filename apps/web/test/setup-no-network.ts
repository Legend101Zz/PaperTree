/**
 * No test touches the network (#310). The web client's default API origin is
 * `http://localhost:8000`, and on the maintainer's Mac port 8000 belongs to another app (it is
 * reserved, CONTRIBUTING.md): an unmocked request there reaches that app whenever it runs. A full
 * run once made 97 such connection attempts and passed, because nothing was listening.
 *
 * Three guards, installed before any test file loads, none of which ever opens a socket:
 *   - `fetch` (the app's one transport, `lib/api/client.ts`; SSE is read through it too);
 *   - `XMLHttpRequest.prototype.send` (the upload, `uploadWithProgress`);
 *   - `net.Socket.prototype.connect`, the backstop for anything that reaches the network without
 *     the two globals (happy-dom's own resource loading, a library using `node:http`).
 * The app opens no `EventSource` or `WebSocket` (client.ts says why), so neither is guarded; the
 * socket backstop would catch one anyway.
 *
 * A guarded call is RECORDED and fails as an offline network would; the `afterEach`/`afterAll`
 * below then fail the test (or the file) that made it, naming each method and URL. Throwing alone
 * would not do: `apiFetch` turns any transport error into a `NetworkError`, the screen shows its
 * offline state, and the test passes, which is how the 97 went unnoticed.
 *
 * Every existing mocking style keeps working. The fetch guard is a plain assignment, not
 * `vi.stubGlobal`, so a test's `vi.stubGlobal('fetch', …)` replaces it and `vi.unstubAllGlobals()`
 * puts the GUARD back (it is the value stubGlobal saved); `vi.spyOn(globalThis, 'fetch')` with an
 * implementation wraps it and `vi.restoreAllMocks()` restores it; a stubbed `XMLHttpRequest` class
 * never reaches the guarded prototype; a `vi.mock` of `@/lib/api/*` never reaches any of them.
 */
import net from 'node:net';

import { afterAll, afterEach, expect } from 'vitest';

/** The requests made since the last check, each as "METHOD URL (in <test>)". */
const attempts: string[] = [];

function record(target: string): string {
  const test = expect.getState().currentTestName ?? 'outside any test';
  attempts.push(`${target} (in "${test}")`);
  return `#310: a test reached for the network: ${target}. Tests never touch the network; mock it.`;
}

/**
 * Throw if any request reached for the network since the last check, naming each one; the list is
 * emptied either way. Runs after every test and file; `no-network.spec.ts` calls it to prove the
 * guards record what they stop.
 */
export function assertNoNetworkAttempts(): void {
  if (attempts.length === 0) return;
  const made = attempts.splice(0);
  throw new Error(
    `#310: ${String(made.length)} unmocked network request(s), and tests never touch the network ` +
      `(port 8000 is reserved on the maintainer's machine). Mock them with vi.mock('@/lib/api/…') ` +
      `or vi.stubGlobal('fetch', …):\n  ${made.join('\n  ')}`,
  );
}

/** A relative URL resolves against the test page (`http://localhost:3000`), as `fetch` would. */
function absolute(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).href;
  } catch {
    return url;
  }
}

function fetchTarget(input: RequestInfo | URL, init?: RequestInit): string {
  const request = typeof input === 'object' && 'method' in input ? input : null;
  const method = init?.method ?? request?.method ?? 'GET';
  return `${method.toUpperCase()} ${absolute(request?.url ?? String(input))}`;
}

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  Promise.reject(new TypeError(record(fetchTarget(input, init))));

// The Node environment (`@vitest-environment node`, e.g. perf.spec) has no XMLHttpRequest.
if (typeof XMLHttpRequest !== 'undefined') {
  const targets = new WeakMap<XMLHttpRequest, string>();
  const { open } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function guardedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    targets.set(this, `${method.toUpperCase()} ${absolute(String(url))}`);
    Reflect.apply(open, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function guardedSend(this: XMLHttpRequest): void {
    throw new DOMException(record(targets.get(this) ?? 'XMLHttpRequest'), 'NetworkError');
  };
}

// `node:net` is one module per worker process while this file runs once per test file, so the
// unpatched `connect` is kept on the prototype: a second run must not wrap the first one's guard.
const UNPATCHED = Symbol.for('papertree.test.unpatchedConnect');
type Connect = typeof net.Socket.prototype.connect;
const socketProto = net.Socket.prototype as net.Socket & { [UNPATCHED]?: Connect };
const realConnect: Connect = socketProto[UNPATCHED] ?? socketProto.connect;
socketProto[UNPATCHED] = realConnect;

/** `host:port` of a TCP connect, or `null` for a local pipe (vitest's own IPC never comes here). */
function tcpTarget(args: unknown[]): string | null {
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === 'number') {
    return `${typeof args[1] === 'string' ? args[1] : 'localhost'}:${String(first)}`;
  }
  if (first === null || typeof first !== 'object') return null;
  const options = first as { path?: unknown; host?: unknown; port?: unknown };
  if (options.path || options.port === undefined) return null;
  return `${typeof options.host === 'string' ? options.host : 'localhost'}:${String(options.port)}`;
}

socketProto.connect = function guardedConnect(this: net.Socket, ...args: unknown[]): net.Socket {
  const target = tcpTarget(args);
  if (target === null) return Reflect.apply(realConnect, this, args) as net.Socket;
  // Refused, as a port nobody listens on would be, so the caller takes its usual error path; and
  // asynchronously, as a real refusal is, so its 'error' listener is attached by then.
  const error = Object.assign(new Error(record(`TCP connect ${target}`)), {
    code: 'ECONNREFUSED',
    syscall: 'connect',
  });
  process.nextTick(() => this.destroy(error));
  return this;
} as Connect;

afterEach(assertNoNetworkAttempts);
afterAll(assertNoNetworkAttempts);
