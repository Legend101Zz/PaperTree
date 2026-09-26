/**
 * Faux mode (`PAPERTREE_AGENT_FAUX=1`, tests and e2e only): a scripted model registered in the same
 * ModelRuntime the live model uses, so a faux run goes through the SAME `createPaperSession()`
 * wiring, the same Pi agent loop, the same tools and the same guards — only the model is scripted.
 * It never opens a socket: there is no key, no base URL it calls, and the provider streams from
 * memory. (Built on pi-ai's `createProvider`, like pi-ai's own `fauxProvider`; that one re-chunks
 * text at random and overwrites usage with an estimate, so it cannot replay a recorded stream.)
 *
 * A script is a list of turns, consumed one per model request, keyed by the Pi session id (the
 * thread id, or the run id on a first turn). `defaultBrain` answers any request from what the run
 * actually gave it — the seed passages in the system prompt, or the handles its tools returned — so
 * the e2e stack can drive explain, ask and summary through a real API.
 */
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
  createProvider,
  getCurrentSystemPrompt,
  type Model,
  type Provider,
  type ToolCall,
} from '@earendil-works/pi-ai';

import type { RunRequest } from './contract.ts';
import { parseHeaders } from './tools.ts';

export const FAUX_PROVIDER = 'papertree-faux';
export const FAUX_API = 'papertree-faux';

export interface FauxUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number | null;
  readonly cost: number;
}

export interface FauxTurn {
  readonly thinking?: string;
  /** Text deltas, streamed exactly as given (one `text_delta` each). */
  readonly text?: readonly string[];
  readonly toolCalls?: ReadonlyArray<{
    readonly id?: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }>;
  readonly usage?: FauxUsage;
  /** Default: `toolUse` when there are tool calls, else `stop`. */
  readonly stopReason?: 'stop' | 'toolUse' | 'length' | 'error';
  /** For `stopReason: "error"`: the provider message, e.g. `401 {"type":"error",…}`. */
  readonly errorMessage?: string;
  /** Stall after this many text deltas: stream nothing more until aborted. */
  readonly stallAfterDeltas?: number;
  /** Wait this long before answering at all. */
  readonly delayMs?: number;
  /** Wait this long before each text delta. */
  readonly deltaDelayMs?: number;
}

export interface FauxContext {
  readonly systemPrompt: string;
  readonly messages: readonly unknown[];
  /** 1-based model request number within this session's script. */
  readonly request: number;
}

export type FauxStep = FauxTurn | ((context: FauxContext) => FauxTurn);

/** Chooses a run's script. Tests pass their own; faux mode uses `defaultBrain`. */
export type FauxBrain = (request: RunRequest) => readonly FauxStep[];

const ZERO: FauxUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  cost: 0,
};

function usageOf(usage: FauxUsage | undefined): AssistantMessage['usage'] {
  const u = usage ?? ZERO;
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    ...(u.reasoning === null ? {} : { reasoning: u.reasoning }),
    totalTokens: u.input + u.output + u.cacheRead + u.cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: u.cost },
  };
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function untilAborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!signal || signal.aborted) return resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export interface FauxModel {
  readonly provider: Provider;
  readonly model: Model<any>;
  /** Queue a session's turns (replacing any left over). */
  load(sessionId: string, steps: readonly FauxStep[]): void;
  /** Model requests seen per session (a test's "the model was called N times"). */
  requests(sessionId: string): number;
  /** What the model was given on each request, per session (system prompt and message roles). */
  seen(
    sessionId: string,
  ): ReadonlyArray<{ readonly systemPrompt: string; readonly roles: string[] }>;
  /** Drop a session's leftover script (the observations are kept, for the last OBSERVED_KEPT sessions). */
  forget(sessionId: string): void;
}

/** How many sessions' request counts and observations are kept (bounded, for a long-lived faux server). */
const OBSERVED_KEPT = 500;

export function createFauxModel(): FauxModel {
  const scripts = new Map<string, FauxStep[]>();
  const counts = new Map<string, number>();
  const observed = new Map<string, Array<{ systemPrompt: string; roles: string[] }>>();

  const model: Model<any> = {
    id: 'MiniMax-M3',
    name: 'MiniMax-M3 (faux)',
    api: FAUX_API,
    provider: FAUX_PROVIDER,
    baseUrl: 'faux://in-process',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 512_000,
  };

  const stream = (
    requestModel: Model<any>,
    context: { messages: readonly unknown[] },
    options?: { signal?: AbortSignal; sessionId?: string },
  ) => {
    const out = createAssistantMessageEventStream();
    const signal = options?.signal;
    const key = options?.sessionId ?? '';
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const systemPrompt = getCurrentSystemPrompt(context.messages as never);
    const roles = context.messages.map((m) => String((m as { role?: unknown }).role));
    const list = observed.get(key) ?? [];
    observed.delete(key);
    observed.set(key, [...list, { systemPrompt, roles }]);
    while (observed.size > OBSERVED_KEPT) {
      const oldest = observed.keys().next().value;
      if (oldest === undefined) break;
      observed.delete(oldest);
      counts.delete(oldest);
    }
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: requestModel.api,
      provider: requestModel.provider,
      model: requestModel.id,
      usage: usageOf(undefined),
      stopReason: 'pending',
      timestamp: Date.now(),
    };
    const push = (event: AssistantMessageEvent): void => out.push(event);
    const snapshot = (): AssistantMessage => ({
      ...output,
      content: output.content.map((c) => ({ ...c })),
    });
    const aborted = (): void => {
      output.stopReason = 'aborted';
      output.errorMessage = 'Request was aborted.';
      push({ type: 'error', reason: 'aborted', error: output });
      out.end(output);
    };
    queueMicrotask(async () => {
      if (signal?.aborted) return aborted();
      const queue = scripts.get(key);
      const step = queue?.shift();
      if (step === undefined) {
        output.stopReason = 'error';
        output.errorMessage = 'No faux response is scripted for this turn.';
        push({ type: 'error', reason: 'error', error: output });
        out.end(output);
        return;
      }
      const turn =
        typeof step === 'function'
          ? step({ systemPrompt, messages: context.messages, request: n })
          : step;
      if (turn.delayMs && !(await sleep(turn.delayMs, signal))) return aborted();
      if (turn.stopReason === 'error') {
        output.stopReason = 'error';
        output.errorMessage = turn.errorMessage ?? '500 faux error';
        output.usage = usageOf(turn.usage);
        push({ type: 'error', reason: 'error', error: output });
        out.end(output);
        return;
      }
      push({ type: 'start', partial: snapshot() });
      let index = 0;
      if (turn.thinking !== undefined) {
        output.content.push({ type: 'thinking', thinking: '' });
        push({ type: 'thinking_start', contentIndex: index, partial: snapshot() });
        (output.content[index] as { thinking: string }).thinking = turn.thinking;
        push({
          type: 'thinking_delta',
          contentIndex: index,
          delta: turn.thinking,
          partial: snapshot(),
        });
        push({
          type: 'thinking_end',
          contentIndex: index,
          content: turn.thinking,
          partial: snapshot(),
        });
        index++;
      }
      if (turn.text !== undefined && turn.text.length > 0) {
        output.content.push({ type: 'text', text: '' });
        push({ type: 'text_start', contentIndex: index, partial: snapshot() });
        let sent = 0;
        for (const delta of turn.text) {
          if (turn.deltaDelayMs && !(await sleep(turn.deltaDelayMs, signal))) return aborted();
          if (signal?.aborted) return aborted();
          (output.content[index] as { text: string }).text += delta;
          push({ type: 'text_delta', contentIndex: index, delta, partial: snapshot() });
          sent++;
          if (turn.stallAfterDeltas === sent) {
            await untilAborted(signal);
            return aborted();
          }
        }
        push({
          type: 'text_end',
          contentIndex: index,
          content: (output.content[index] as { text: string }).text,
          partial: snapshot(),
        });
        index++;
      }
      for (const [i, planned] of (turn.toolCalls ?? []).entries()) {
        if (signal?.aborted) return aborted();
        const call: ToolCall = {
          type: 'toolCall',
          id: planned.id ?? `faux_call_${String(n)}_${String(i)}`,
          name: planned.name,
          arguments: {},
        };
        output.content.push(call);
        push({ type: 'toolcall_start', contentIndex: index, partial: snapshot() });
        push({
          type: 'toolcall_delta',
          contentIndex: index,
          delta: JSON.stringify(planned.arguments),
          partial: snapshot(),
        });
        call.arguments = planned.arguments as ToolCall['arguments'];
        push({
          type: 'toolcall_end',
          contentIndex: index,
          toolCall: { ...call },
          partial: snapshot(),
        });
        index++;
      }
      if (turn.stallAfterDeltas === 0) {
        await untilAborted(signal);
        return aborted();
      }
      if (signal?.aborted) return aborted();
      output.usage = usageOf(turn.usage);
      const reason = turn.stopReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? 'toolUse' : 'stop');
      output.stopReason = reason;
      push({ type: 'done', reason, message: output });
      out.end(output);
    });
    return out;
  };

  const provider = createProvider({
    id: FAUX_PROVIDER,
    name: 'PaperTree faux model',
    auth: { apiKey: { name: 'Faux', resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: { stream: stream as never, streamSimple: stream as never },
  } as never);

  return {
    provider,
    model,
    load(sessionId, steps) {
      scripts.set(sessionId, [...steps]);
    },
    requests: (sessionId) => counts.get(sessionId) ?? 0,
    seen: (sessionId) => observed.get(sessionId) ?? [],
    forget(sessionId) {
      scripts.delete(sessionId);
    },
  };
}

// ── the default brain: answers from what the run gave it ────────────────────────────────────────

function words(text: string, datamark: string, max: number): string {
  const plain = text
    .split(datamark)
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const list = plain.split(' ');
  return list.length <= max ? plain : `${list.slice(0, max).join(' ')} …`;
}

function chunks(text: string, size = 8): string[] {
  const list = text.split(/(?<= )/);
  const out: string[] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size).join(''));
  return out;
}

function estimate(context: FauxContext, output: string): FauxUsage {
  const input = Math.ceil(
    (context.systemPrompt.length + JSON.stringify(context.messages).length) / 4,
  );
  const out = Math.ceil(output.length / 4);
  return {
    input,
    output: out,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: input * 0.3e-6 + out * 1.2e-6,
  };
}

function lastToolResult(context: FauxContext): { text: string; handles: string[] } {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const m = context.messages[i] as {
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
      details?: { handles?: unknown };
    };
    if (m.role !== 'toolResult') continue;
    const text = (m.content ?? []).map((c) => c.text ?? '').join('\n');
    const fromDetails = Array.isArray(m.details?.handles)
      ? (m.details.handles as unknown[]).filter((h): h is string => typeof h === 'string')
      : [];
    return {
      text,
      handles: fromDetails.length > 0 ? fromDetails : parseHeaders(text).map(([h]) => h),
    };
  }
  return { text: '', handles: [] };
}

/** One passage block `[bN] (label)\ntext` of the system prompt's seed. */
function seedPassages(systemPrompt: string): Array<{ handle: string; text: string }> {
  const out: Array<{ handle: string; text: string }> = [];
  const blocks = systemPrompt.split('\n\n');
  for (const block of blocks) {
    const match = /^\[(b\d+)\] \(.*\)\n([\s\S]+)$/.exec(block);
    if (match?.[1] && match[2]) out.push({ handle: match[1], text: match[2] });
  }
  return out;
}

function answerFromSeed(request: RunRequest): FauxStep {
  return (context) => {
    const passages = seedPassages(context.systemPrompt);
    const first = passages[0];
    if (!first) {
      const text = 'The paper passages this answer was given do not say. (Faux answer.)';
      return { text: chunks(text), usage: estimate(context, text) };
    }
    const second = passages[1];
    let text = `The selected passage says: "${words(first.text, request.datamark, 30)}" [${first.handle}].`;
    if (second)
      text += ` The text around it adds: "${words(second.text, request.datamark, 24)}" [${second.handle}].`;
    text += ' (Faux answer: it quotes the paper and adds no interpretation.)';
    return {
      thinking: 'The seed passages hold the selection.',
      text: chunks(text),
      usage: estimate(context, text),
    };
  };
}

function answerFromTools(request: RunRequest, summary: boolean): FauxStep {
  return (context) => {
    const { text: toolText, handles } = lastToolResult(context);
    const headers = new Map(parseHeaders(toolText));
    if (handles.length === 0) {
      const text = summary
        ? "- The paper's outline was empty, so there is nothing to summarise. (Faux.)"
        : 'The paper does not say. (Faux answer.)';
      return { text: chunks(text), usage: estimate(context, text) };
    }
    if (summary) {
      const bullets = handles.slice(0, 6).map((handle) => {
        const info = headers.get(handle);
        const where = info
          ? `${info.section || 'a part of the paper'} (${info.page})`
          : `passage ${handle}`;
        return `- The paper has a part on ${where} [${handle}].`;
      });
      const text = bullets.join('\n');
      return { text: chunks(text, 6), usage: estimate(context, text) };
    }
    const cited = handles
      .slice(0, 2)
      .map((h) => `[${h}]`)
      .join(' ');
    const text = `The paper's passages that match the question are these ${cited}. (Faux answer about "${words(request.question, request.datamark, 12)}".)`;
    return { text: chunks(text), usage: estimate(context, text) };
  };
}

const SCENARIO = /\[faux:([a-z0-9-]+)\]/;

/** Named scenarios for e2e error paths, selected by `[faux:<name>]` in the question. */
function scenario(name: string, request: RunRequest): readonly FauxStep[] | null {
  switch (name) {
    case 'auth-error':
      return [
        {
          stopReason: 'error',
          errorMessage:
            '401 {"type":"error","error":{"type":"authentication_error","message":"faux"}}',
        },
      ];
    case 'upstream-503':
      return [
        {
          stopReason: 'error',
          errorMessage: '503 {"type":"error","error":{"type":"overloaded_error"}}',
        },
        answerFromSeed(request),
      ];
    case 'stall':
      return [{ text: ['The answer starts [b1]', ' and then', ' stops'], stallAfterDeltas: 3 }];
    case 'slow':
      return [
        {
          text: chunks('This answer streams slowly so that it can be cancelled [b1]. '.repeat(6)),
          deltaDelayMs: 400,
        },
      ];
    case 'tool-loop':
      return Array.from({ length: 12 }, () => ({
        toolCalls: [{ name: 'search_passages', arguments: { query: 'method' } }],
      }));
    default:
      return null;
  }
}

/** Faux mode's brain: a grounded, deterministic answer from whatever the run was given. */
export const defaultBrain: FauxBrain = (request) => {
  const named = SCENARIO.exec(request.question);
  if (named?.[1]) {
    const steps = scenario(named[1], request);
    if (steps) return steps;
  }
  if (request.kind === 'summary') {
    return [
      { thinking: 'Read the outline first.', toolCalls: [{ name: 'get_outline', arguments: {} }] },
      answerFromTools(request, true),
    ];
  }
  if (request.seed !== null && request.seed.passages.length > 0) return [answerFromSeed(request)];
  const query =
    words(request.question, request.datamark, 6)
      .replace(/[^\p{L}\p{N} -]/gu, ' ')
      .trim() || 'paper';
  return [
    {
      thinking: "Search the paper for the question's words.",
      toolCalls: [{ name: 'search_passages', arguments: { query, limit: 3 } }],
    },
    answerFromTools(request, false),
  ];
};
