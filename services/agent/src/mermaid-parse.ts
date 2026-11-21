/**
 * A real `mermaid.parse` of a fence, in the agent (v0.3 W6): the web's renderer and this parser
 * are the same pinned `mermaid@12.2.0`, so a fence that parses here draws there.
 *
 * Why a worker thread. Mermaid's parser needs a DOM (DOMPurify), and a DOM means `window` and
 * `document` globals. Defined in the agent's main thread they would change how every other module
 * behaves (a library that probes `typeof window` takes its browser path). A `worker_threads`
 * Worker has its own global scope: the shim lives in mermaid-worker.ts and nowhere else, there is
 * no per-parse cost of a process spawn, and a parse that hangs is ended by terminating the thread.
 * (A child process would isolate just as well but costs ~40 ms to start and an IPC channel to
 * clean up; the shared heap of a worker is not a risk here, the fence is only text.)
 *
 * Why happy-dom, not jsdom. mermaid.parse touches only DOMPurify, which needs a handful of DOM
 * constructors. happy-dom is 25 MB and is already in the workspace (the web's test DOM, the same
 * version), so it adds nothing to the lockfile's resolution; jsdom would be a second DOM with
 * ~20 more transitive packages. (Without any DOM every type fails with "DOMPurify.addHook is not a
 * function": measured, 2026-11-20.)
 *
 * Cost, measured on the 91 round-1 fences (M-series Mac): worker start + mermaid import + warming
 * one sample of every type ~1.4 s once, started at boot (`warmMermaid`, server.ts) so no run pays
 * it; then a parse is 11-18 ms median (the first of a type after start, ~150 ms, is gone because
 * the warm-up parses one of each). Worst case a fence waits `timeoutMs` and is kept unparsed.
 *
 * Failure is open: if the worker cannot start, or a parse times out, the answer is `unavailable`
 * and the fence is stored as it is (the web still parses before it draws), never lost to an
 * infrastructure fault.
 */
import { Worker } from 'node:worker_threads';

export type ParseVerdict =
  | { readonly status: 'ok' }
  | { readonly status: 'invalid'; readonly error: string }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface MermaidParserOptions {
  /** One parse's budget. Default 3 s: a pathological fence must not hold a run. */
  readonly timeoutMs?: number;
  /** The first start's budget (module import and warm-up). Default 15 s. */
  readonly startMs?: number;
  /** Tests only: the worker file. */
  readonly workerUrl?: URL;
}

interface Pending {
  readonly resolve: (verdict: ParseVerdict) => void;
  readonly timer: NodeJS.Timeout;
}

export class MermaidParser {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly timeoutMs: number;
  private readonly startMs: number;
  private readonly url: URL;
  /** Workers started (a test's "a hung parse was replaced"). */
  starts = 0;

  constructor(options: MermaidParserOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.startMs = options.startMs ?? 15_000;
    this.url = options.workerUrl ?? new URL('./mermaid-worker.ts', import.meta.url);
  }

  /** Start the worker (idempotent). Resolves true once it has loaded mermaid, false if it could not. */
  warm(): Promise<boolean> {
    if (this.ready !== null) return this.ready;
    this.starts++;
    const worker = new Worker(this.url);
    this.worker = worker;
    worker.unref();
    this.ready = new Promise<boolean>((resolve) => {
      const startTimer = setTimeout(() => {
        this.drop(worker, 'start timeout');
        resolve(false);
      }, this.startMs);
      startTimer.unref();
      worker.on(
        'message',
        (message: { ready?: true; id?: number; ok?: boolean; error?: string }) => {
          if (message.ready === true) {
            clearTimeout(startTimer);
            resolve(true);
            return;
          }
          const pending = message.id === undefined ? undefined : this.pending.get(message.id);
          if (pending === undefined || message.id === undefined) return;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          pending.resolve(
            message.ok === true
              ? { status: 'ok' }
              : { status: 'invalid', error: message.error ?? 'parse error' },
          );
        },
      );
      worker.on('error', () => {
        clearTimeout(startTimer);
        this.drop(worker, 'worker error');
        resolve(false);
      });
      worker.on('exit', () => {
        clearTimeout(startTimer);
        this.drop(worker, 'worker exited');
        resolve(false);
      });
    });
    return this.ready;
  }

  /** Forget a dead worker, answer everything waiting on it as unavailable, allow a fresh start. */
  private drop(worker: Worker, reason: string): void {
    if (this.worker === worker) {
      this.worker = null;
      this.ready = null;
    }
    void worker.terminate();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ status: 'unavailable', reason });
      this.pending.delete(id);
    }
  }

  /** Parse one fence body. Never throws. */
  async parse(text: string): Promise<ParseVerdict> {
    const started = await this.warm().catch(() => false);
    const worker = this.worker;
    if (!started || worker === null) return { status: 'unavailable', reason: 'no parser' };
    const id = ++this.seq;
    return new Promise<ParseVerdict>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ status: 'unavailable', reason: 'parse timeout' });
        // A thread stuck in a parse cannot be interrupted: replace it.
        this.drop(worker, 'parse timeout');
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, timer });
      // (A worker thread, not a window: there is no origin to name.)
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage({ id, text });
    });
  }

  /** Stop the worker (tests, shutdown). */
  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    if (worker !== null) await worker.terminate();
  }
}

/** The service's one parser. */
export const mermaidParser = new MermaidParser();

/** Start the shared worker in the background (boot). Never rejects. */
export function warmMermaid(): void {
  void mermaidParser.warm().catch(() => undefined);
}
