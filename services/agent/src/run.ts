/**
 * One `POST /v1/runs`: build the session, prompt it, turn Pi's events into the §3.2 stream, and
 * enforce the §3.3 host guards. The SDK has none of these guards itself (spike-verify must-fix 1,
 * 2, 5, 9, 10):
 *
 *   tool-call cap   counted at `tool_execution_start`; past `max_tool_calls` a tool answers
 *                   "Tool budget exhausted; answer from what you have." without calling the API; at
 *                   cap + 2, or past `max_turns`, the run is aborted -> tool_budget_exhausted
 *   idle watchdog   reset on every session event; `idle_ms` of silence -> abort -> timeout
 *   deadline        AbortSignal.any([AbortSignal.timeout(deadline_ms), client gone]) -> abort ->
 *                   timeout, or aborted when the client went away / DELETE
 *   classification  our own (classify.ts), and Pi's auto-retry is vetoed for anything we would not
 *                   retry (a 400 that mentions "500" is not retried)
 *   citations       `markers` are only handles issued in THIS run (the seed + tool responses)
 *   history         an aborted / failed turn with no text hands back the entries from BEFORE the
 *                   prompt, so a cancelled task is not resumed on the next turn
 *
 * Text (§3.2 `text`): only an answer's text reaches the caller. Each assistant message's text is
 * held until the message proves to be an answer — its text carries a `[bN]` marker, or the message
 * ends with anything but `toolUse` — and then streams live. Text of a message that never cites and
 * ends in `toolUse` ("Let me search the paper…") is dropped (spike §6). So the deltas sent are
 * exactly `done.final_text`.
 */
import type { AssistantMessage, Model } from '@earendil-works/pi-ai';
import type {
  AgentSessionEvent,
  ModelRuntime,
  SessionEntry,
} from '@earendil-works/pi-coding-agent';

import {
  classifyHostAbort,
  classifyProviderError,
  type HostAbort,
  mayRetry,
  type RunError,
  runError,
} from './classify.ts';
import {
  hasMarker,
  MODEL_LABEL,
  parseMarkers,
  type RunRequest,
  SDK_LABEL,
  TOOL_NAMES,
} from './contract.ts';
import type { FauxBrain, FauxModel } from './faux.ts';
import type { Logger } from './log.ts';
import { systemPrompt, userText } from './prompts.ts';
import { createPaperSession, type PaperSession } from './session.ts';
import type { SseSink } from './sse.ts';
import {
  createPaperTools,
  type HandleInfo,
  parseHeaders,
  parseLabel,
  stripDatamark,
} from './tools.ts';

export interface RunDeps {
  readonly modelRuntime: ModelRuntime;
  readonly model: Model<any>;
  readonly log: Logger;
  readonly pingMs: number;
  readonly faux?: { readonly model: FauxModel; readonly brain: FauxBrain };
  /** Tests only: the time-to-headers bound (§3.1 fixes 30 s). */
  readonly providerTimeoutMs?: number;
}

export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number | null;
  cost_usd_est: number;
}

export type RunStatus = 'complete' | 'partial' | 'error' | 'aborted';

export interface DoneData {
  status: RunStatus;
  stop_reason: AssistantMessage['stopReason'] | null;
  error: RunError | null;
  final_text: string;
  handles_seen: string[];
  markers: string[];
  usage_totals: Usage;
  tool_calls: number;
  turns: number;
  retries: number;
  first_text_ms: number | null;
  latency_ms: number;
  entries: unknown[];
}

const RETRY_LABEL = 'The model service is busy; trying again';
const BUDGET_LABEL = 'Tool budget exhausted';
/** After the host aborts, the session must settle within this long, or the run is closed anyway. */
const SETTLE_AFTER_ABORT_MS = 5_000;

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function usageOf(message: AssistantMessage): Usage {
  const u = message.usage;
  return {
    input: u.input,
    output: u.output,
    cache_read: u.cacheRead,
    cache_write: u.cacheWrite,
    reasoning: typeof u.reasoning === 'number' ? u.reasoning : null,
    cost_usd_est: round(u.cost.total),
  };
}

function isZero(usage: Usage): boolean {
  return (
    usage.input + usage.output + usage.cache_read + usage.cache_write === 0 &&
    usage.cost_usd_est === 0
  );
}

function hasContent(message: AssistantMessage): boolean {
  return message.content.some(
    (block) =>
      block.type === 'toolCall' ||
      (block.type === 'text' && block.text.length > 0) ||
      (block.type === 'thinking' && block.thinking.length > 0),
  );
}

function clip(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

interface MessageState {
  deltas: string[];
  text: string;
  committed: boolean;
}

/** A run in flight: what the HTTP layer can do to it. */
export interface ActiveRun {
  readonly runId: string;
  abort(reason: HostAbort): void;
  readonly finished: Promise<void>;
}

export function startRun(
  request: RunRequest,
  sse: SseSink,
  deps: RunDeps,
  clientGone: AbortSignal,
): ActiveRun {
  const run = new Run(request, sse, deps, clientGone);
  return {
    runId: request.run_id,
    abort: (reason) => run.hostAbort(reason),
    finished: run.execute(),
  };
}

class Run {
  private readonly t0 = performance.now();
  /** The seed's handles, in order. */
  private readonly seedHandles: string[] = [];
  /** Each tool call's new handles, by call position (not completion order: calls run in parallel). */
  private readonly resultHandles = new Map<number, readonly string[]>();
  private readonly info = new Map<string, HandleInfo>();
  private readonly callIndex = new Map<string, number>();
  private toolCalls = 0;
  private turnsStarted = 0;
  private agentStarts = 0;
  private retries = 0;
  /**
   * Every assistant message of the run, with the stop reason the run accounts it under: once the
   * host has aborted, a message Pi reports as `error` ("This operation was aborted": the abort
   * landed while Pi was preparing the request, before any provider stream) IS that abort.
   */
  private readonly assistant: Array<{
    message: AssistantMessage;
    stop: AssistantMessage['stopReason'];
    retried: boolean;
  }> = [];
  private readonly stopOf = new WeakMap<object, AssistantMessage['stopReason']>();
  private readonly usages: Usage[] = [];
  private current: MessageState | null = null;
  private finalText = '';
  private firstTextMs: number | null = null;
  /** Latency breakdown for the done log (not the stream): the model's first delta of any kind, its
   * first text delta (sent or held), and how much thinking and text it produced. */
  private firstTokenMs: number | null = null;
  private firstModelTextMs: number | null = null;
  private thinkingChars = 0;
  private modelTextChars = 0;
  private hostReason: HostAbort | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  private paper: PaperSession | null = null;
  private settled = false;
  private abortedAt: number | null = null;
  private readonly sessionId: string;
  private readonly request: RunRequest;
  private readonly sse: SseSink;
  private readonly deps: RunDeps;
  private readonly clientGone: AbortSignal;

  constructor(request: RunRequest, sse: SseSink, deps: RunDeps, clientGone: AbortSignal) {
    this.request = request;
    this.sse = sse;
    this.deps = deps;
    this.clientGone = clientGone;
    this.sessionId = request.history?.session_id ?? request.run_id;
    for (const passage of request.seed?.passages ?? []) {
      if (!this.seedHandles.includes(passage.handle)) this.seedHandles.push(passage.handle);
      this.info.set(passage.handle, parseLabel(passage.label));
    }
  }

  private now(): number {
    return Math.round(performance.now() - this.t0);
  }

  /** Handles issued in THIS run: the seed, then each tool response in call order, first-seen. */
  private seen(): string[] {
    const out = [...this.seedHandles];
    for (const index of [...this.resultHandles.keys()].toSorted((a, b) => a - b)) {
      for (const handle of this.resultHandles.get(index) ?? [])
        if (!out.includes(handle)) out.push(handle);
    }
    return out;
  }

  hostAbort(reason: HostAbort): void {
    if (this.settled) return;
    if (this.hostReason === null) {
      this.hostReason = reason;
      this.abortedAt = this.now();
      this.deps.log.info('agent.run.abort', {
        run_id: this.request.run_id,
        request_id: this.request.request_id,
        reason,
        ms: this.abortedAt,
      });
    }
    clearTimeout(this.idleTimer);
    this.paper?.abort();
  }

  private resetIdle(): void {
    if (this.settled || this.hostReason !== null) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.hostAbort('idle'), this.request.limits.idle_ms);
  }

  private sendText(delta: string): void {
    if (delta.length === 0) return;
    if (this.firstTextMs === null) this.firstTextMs = this.now();
    this.finalText += delta;
    this.sse.event('text', { delta });
  }

  private commit(state: MessageState): void {
    if (state.committed) return;
    state.committed = true;
    this.sse.event('status', { phase: 'writing' });
    if (this.finalText.length > 0 && state.text.length > 0) this.sendText('\n\n');
    for (const delta of state.deltas) this.sendText(delta);
  }

  private toolStatus(name: string, args: unknown, index: number): Record<string, unknown> {
    const known = (TOOL_NAMES as readonly string[]).includes(name);
    const data: Record<string, unknown> = { phase: 'tool' };
    if (known) data['tool'] = name;
    if (index > this.request.limits.max_tool_calls) {
      data['label'] = BUDGET_LABEL;
      return data;
    }
    const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
    const handle = typeof a['handle'] === 'string' ? a['handle'] : undefined;
    const where = handle === undefined ? undefined : this.info.get(handle);
    switch (name) {
      case 'get_outline':
        data['label'] = 'Reading the outline';
        break;
      case 'search_passages':
        data['label'] =
          typeof a['query'] === 'string' && a['query'].trim()
            ? `Searching the paper · ${clip(a['query'])}`
            : 'Searching the paper';
        break;
      case 'get_section':
        data['label'] = where
          ? where.section
            ? `Reading ${where.page} · ${where.section}`
            : `Reading ${where.page}`
          : `Reading the section of ${handle ?? 'a passage'}`;
        break;
      case 'get_passage':
        data['label'] = where
          ? `Reading ${where.page} · ${handle ?? ''}`
          : `Reading ${handle ?? 'a passage'}`;
        break;
      default:
        data['label'] = 'A tool this service does not have';
    }
    return data;
  }

  /**
   * When the run's budget is nearly spent, tell the model in the tool result itself (it cannot see
   * the host's counters): at most 2 calls left, or at most 1 round of tools before the answer turn.
   */
  private budgetNote(toolCallId: string): string | undefined {
    const index = this.callIndex.get(toolCallId);
    if (index === undefined) return undefined;
    const calls = Math.max(0, this.request.limits.max_tool_calls - index);
    const rounds = Math.max(0, this.request.limits.max_turns - this.turnsStarted - 1);
    if (calls > 2 && rounds > 1) return undefined;
    if (calls === 0 || rounds === 0)
      return '(Tool budget used up: write the answer now, from what you have.)';
    return `(Tool budget: ${String(calls)} call${calls === 1 ? '' : 's'} and ${String(rounds)} round${rounds === 1 ? '' : 's'} left. Write the answer soon.)`;
  }

  private thinkingLabel(): string | undefined {
    if (this.agentStarts !== 1 || this.request.history !== null) return undefined;
    if (this.request.kind === 'explain') return 'Reading the selected passage';
    if (this.request.kind === 'summary') return "Reading the paper's outline";
    return undefined;
  }

  private onEvent(event: AgentSessionEvent): void {
    if (this.settled) return;
    this.resetIdle();
    switch (event.type) {
      case 'agent_start': {
        this.agentStarts++;
        const label = this.thinkingLabel();
        this.sse.event(
          'status',
          label === undefined ? { phase: 'thinking' } : { phase: 'thinking', label },
        );
        break;
      }
      case 'turn_start':
        this.turnsStarted++;
        if (this.turnsStarted > this.request.limits.max_turns) this.hostAbort('tool_budget');
        break;
      case 'message_start':
        if (event.message.role === 'assistant')
          this.current = { deltas: [], text: '', committed: false };
        break;
      case 'message_update': {
        const inner = event.assistantMessageEvent;
        if (
          this.firstTokenMs === null &&
          (inner.type === 'text_delta' ||
            inner.type === 'thinking_delta' ||
            inner.type === 'toolcall_delta')
        ) {
          this.firstTokenMs = this.now();
        }
        if (inner.type === 'thinking_delta') this.thinkingChars += inner.delta.length;
        if (inner.type !== 'text_delta') break;
        if (this.firstModelTextMs === null) this.firstModelTextMs = this.now();
        this.modelTextChars += inner.delta.length;
        const state = this.current ?? (this.current = { deltas: [], text: '', committed: false });
        state.deltas.push(inner.delta);
        state.text += inner.delta;
        if (state.committed) this.sendText(inner.delta);
        else if (hasMarker(state.text)) this.commit(state);
        break;
      }
      case 'message_end': {
        if (event.message.role !== 'assistant') break;
        const message = event.message as AssistantMessage;
        const state = this.current;
        this.current = null;
        if (state && !state.committed && state.text.length > 0 && message.stopReason !== 'toolUse')
          this.commit(state);
        const stop =
          this.hostReason !== null && message.stopReason === 'error'
            ? 'aborted'
            : message.stopReason;
        this.stopOf.set(message, stop);
        this.assistant.push({ message, stop, retried: false });
        if (message.stopReason === 'error' && this.hostReason === null) {
          const { code } = classifyProviderError(message.errorMessage);
          this.deps.log.debug('agent.provider.error', {
            run_id: this.request.run_id,
            request_id: this.request.request_id,
            code,
            raw: message.errorMessage ?? null,
          });
          // Veto Pi's own retry (its regex matches "500" anywhere) for anything we would not retry.
          if (!mayRetry(code, this.finalText.length > 0)) this.paper?.abort();
        }
        break;
      }
      case 'turn_end': {
        const message = event.message;
        if (message.role !== 'assistant') break;
        const usage = usageOf(message as AssistantMessage);
        const stop = this.stopOf.get(message) ?? (message as AssistantMessage).stopReason;
        // An aborted message usually carries no usage (nothing was billed); one that does is counted.
        if (stop === 'aborted' && isZero(usage)) break;
        this.usages.push(usage);
        this.sse.event('usage', { ...usage });
        break;
      }
      case 'tool_execution_start': {
        this.toolCalls++;
        const index = this.toolCalls;
        this.callIndex.set(event.toolCallId, index);
        this.sse.event('status', this.toolStatus(event.toolName, event.args, index));
        if (index >= this.request.limits.max_tool_calls + 2) this.hostAbort('tool_budget');
        break;
      }
      case 'auto_retry_start': {
        const last = this.assistant.at(-1);
        if (last) last.retried = true;
        this.retries++;
        this.turnsStarted = Math.max(0, this.turnsStarted - 1);
        const { code } = classifyProviderError(event.errorMessage);
        this.deps.log.info('agent.retry', {
          run_id: this.request.run_id,
          request_id: this.request.request_id,
          attempt: event.attempt,
          delay_ms: event.delayMs,
          error_code: code,
        });
        this.sse.event('status', {
          phase: 'retrying',
          label: RETRY_LABEL,
          attempt: event.attempt,
          delay_ms: event.delayMs,
        });
        break;
      }
      default:
        break;
    }
  }

  async execute(): Promise<void> {
    const { request, deps } = this;
    const limits = request.limits;
    deps.log.info('agent.run.start', {
      run_id: request.run_id,
      request_id: request.request_id,
      kind: request.kind,
      prompt_version: request.prompt_version,
      follow_up: request.history !== null,
      generation: request.paper.generation,
      seed_passages: request.seed?.passages.length ?? 0,
      limits,
    });
    deps.log.redact(request.tool.token);
    this.sse.event('run', { run_id: request.run_id, model: MODEL_LABEL, sdk: SDK_LABEL });
    const ping = setInterval(() => this.sse.ping(), deps.pingMs);
    const deadline = AbortSignal.timeout(limits.deadline_ms);
    const stop = AbortSignal.any([deadline, this.clientGone]);
    const onStop = (): void => this.hostAbort(this.clientGone.aborted ? 'client' : 'deadline');
    stop.addEventListener('abort', onStop, { once: true });
    let promptError: unknown = null;
    try {
      const tools = createPaperTools({
        baseUrl: request.tool.base_url,
        token: request.tool.token,
        requestId: request.request_id,
        runId: request.run_id,
        log: deps.log,
        maxToolCalls: limits.max_tool_calls,
        callIndex: (id) => this.callIndex.get(id),
        onResult: (toolCallId, handles, text) => {
          for (const [handle, info] of parseHeaders(stripDatamark(text, request.datamark)))
            this.info.set(handle, info);
          const index = this.callIndex.get(toolCallId);
          if (index !== undefined) this.resultHandles.set(index, [...handles]);
        },
        onFatal: () => this.hostAbort('tool_failed'),
        budgetNote: (id) => this.budgetNote(id),
      });
      if (deps.faux) deps.faux.model.load(this.sessionId, deps.faux.brain(request));
      this.paper = await createPaperSession({
        modelRuntime: deps.modelRuntime,
        model: deps.model,
        maxOutputTokens: limits.max_output_tokens,
        maxRetries: limits.max_retries,
        systemPrompt: systemPrompt(request),
        tools,
        sessionId: this.sessionId,
        entries: (request.history?.entries ?? []) as SessionEntry[],
        ...(deps.providerTimeoutMs === undefined
          ? {}
          : { providerTimeoutMs: deps.providerTimeoutMs }),
      });
      this.paper.session.subscribe((event) => this.onEvent(event));
      if (stop.aborted) onStop();
      if (this.hostReason === null) {
        this.resetIdle();
        const prompted = this.paper.prompt(userText(request));
        // If the session never settles after an abort, the race below returns without it; the
        // late rejection (if any) must not become an unhandled one.
        prompted.catch(() => undefined);
        await Promise.race([prompted, this.settleAfterAbort()]);
      }
    } catch (error) {
      promptError = error;
      deps.log.error('agent.run.failed', {
        run_id: request.run_id,
        request_id: request.request_id,
        error_type: error instanceof Error ? error.name : typeof error,
      });
      deps.log.debug('agent.run.failed.detail', {
        run_id: request.run_id,
        raw: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.settled = true;
      clearTimeout(this.idleTimer);
      clearInterval(ping);
      stop.removeEventListener('abort', onStop);
    }
    const done = this.done(promptError);
    this.sse.event('done', { ...done });
    this.sse.end();
    deps.log.info('agent.run.done', {
      run_id: request.run_id,
      request_id: request.request_id,
      status: done.status,
      stop_reason: done.stop_reason,
      error_code: done.error?.code ?? null,
      tokens: {
        input: done.usage_totals.input,
        output: done.usage_totals.output,
        cache_read: done.usage_totals.cache_read,
        cache_write: done.usage_totals.cache_write,
        reasoning: done.usage_totals.reasoning,
      },
      cost_usd_est: done.usage_totals.cost_usd_est,
      retries: done.retries,
      tool_calls: done.tool_calls,
      turns: done.turns,
      markers: done.markers,
      unseen_markers: parseMarkers(done.final_text).filter((m) => !done.handles_seen.includes(m)),
      first_text_ms: done.first_text_ms,
      first_token_ms: this.firstTokenMs,
      first_model_text_ms: this.firstModelTextMs,
      thinking_chars: this.thinkingChars,
      model_text_chars: this.modelTextChars,
      latency_ms: done.latency_ms,
    });
    deps.log.forget(request.tool.token);
    this.paper?.dispose();
    deps.faux?.model.forget(this.sessionId);
  }

  /** Resolves SETTLE_AFTER_ABORT_MS after a host abort, in case the session never settles. */
  private settleAfterAbort(): Promise<void> {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this.settled) {
          clearInterval(check);
          return;
        }
        if (this.abortedAt !== null && this.now() - this.abortedAt > SETTLE_AFTER_ABORT_MS) {
          clearInterval(check);
          this.deps.log.warn('agent.run.unsettled', {
            run_id: this.request.run_id,
            ms: this.now(),
          });
          resolve();
        }
      }, 250);
      check.unref();
    });
  }

  private done(promptError: unknown): DoneData {
    const lastEntry = this.assistant.at(-1);
    const last = lastEntry?.message;
    const lastStop = lastEntry?.stop;
    const text = this.finalText;
    let status: RunStatus;
    let error: RunError | null = null;
    if (this.hostReason !== null) {
      const { code, retryable } = classifyHostAbort(this.hostReason);
      status = this.hostReason === 'client' ? 'aborted' : text ? 'partial' : 'error';
      error = runError(code, retryable, {
        partial: text.length > 0,
        idle: this.hostReason === 'idle',
      });
    } else if (promptError !== null) {
      status = text ? 'partial' : 'error';
      error = runError('internal', false);
    } else if (last === undefined) {
      status = 'error';
      error = runError('internal', false);
    } else if (lastStop === 'error') {
      const { code, retryable } = classifyProviderError(last.errorMessage);
      status = text ? 'partial' : 'error';
      error = runError(code, retryable);
    } else if (lastStop === 'length') {
      status = text ? 'partial' : 'error';
      error = runError('output_truncated', true);
    } else if (lastStop === 'aborted') {
      status = 'aborted';
      error = runError('aborted', true);
    } else if (text.length === 0) {
      status = 'error';
      error = runError('internal', false);
    } else {
      status = 'complete';
    }
    const totals: Usage = {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_write: 0,
      reasoning: 0,
      cost_usd_est: 0,
    };
    for (const u of this.usages) {
      totals.input += u.input;
      totals.output += u.output;
      totals.cache_read += u.cache_read;
      totals.cache_write += u.cache_write;
      totals.cost_usd_est = round(totals.cost_usd_est + u.cost_usd_est);
      totals.reasoning =
        totals.reasoning === null || u.reasoning === null ? null : totals.reasoning + u.reasoning;
    }
    const seen = this.seen();
    const markers = parseMarkers(text).filter((handle) => seen.includes(handle));
    const entries =
      (status === 'aborted' || status === 'error') && text.length === 0
        ? [...(this.request.history?.entries ?? [])]
        : (this.paper?.exportConversation() ?? [...(this.request.history?.entries ?? [])]);
    const turns = this.assistant.filter(
      ({ message, stop, retried }) => !retried && !(stop === 'aborted' && !hasContent(message)),
    ).length;
    return {
      status,
      stop_reason: lastStop ?? null,
      error,
      final_text: text,
      handles_seen: seen,
      markers,
      usage_totals: totals,
      tool_calls: this.toolCalls,
      turns,
      retries: this.retries,
      first_text_ms: this.firstTextMs,
      latency_ms: this.now(),
      entries,
    };
  }
}
