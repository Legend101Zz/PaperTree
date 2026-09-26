/**
 * `createPaperSession()`: the ONLY caller of Pi's `createAgentSession` in this service
 * (contracts.md §3.1; spike-verify must-fix 7). Every boundary Pi would otherwise discover from
 * disk is supplied, because leaving out any one of them brings back `~/.pi/agent/*`,
 * `<cwd>/.pi/*`, AGENTS.md, extensions (which EXECUTE code) or the built-in bash/read/edit/write
 * tools (spike-verify "Leaks" 3–4):
 *
 *   modelRuntime     in-memory credentials, no models.json, no catalog network (boot builds it)
 *   resourceLoader   loads nothing; returns this run's system prompt
 *   settingsManager  in memory: no default tools, compaction off, cache warming off, telemetry off,
 *                    bounded retries (§3.1 values)
 *   sessionManager   in memory, id = the thread, entries = the thread's stored history
 *   tools            the allowlist: built-ins are not even registered
 *   cwd "/"          Pi appends `<cwd>` to every system prompt; never a real path
 *
 * The wrapper also owns the disposed guard (must-fix 4: a disposed session sent a malformed request
 * and once blocked 301 s) and the conversation export (`entries`, §3.2).
 */
import type { Model } from '@earendil-works/pi-ai';
import {
  type AgentSession,
  createAgentSession,
  createExtensionRuntime,
  type ModelRuntime,
  type ResourceLoader,
  type SessionEntry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

/** The only prompt option this service ever uses (must-fix 7: it defaults to true). */
export const PROMPT_OPTIONS = { expandPromptTemplates: false } as const;

/** A ResourceLoader that loads NOTHING from disk (spike §13). */
export function emptyResourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** The §3.1 time-to-response-headers bound for one model request. */
export const PROVIDER_TIMEOUT_MS = 30_000;

/**
 * §3.1 settings, verbatim; only `maxRetries` comes from the request (`limits.max_retries`).
 * `providerTimeoutMs` differs from 30 s only in a test that must not wait 30 s for a hung mock.
 */
export function paperSettings(
  maxRetries: number,
  providerTimeoutMs = PROVIDER_TIMEOUT_MS,
): SettingsManager {
  return SettingsManager.inMemory({
    defaultTools: [],
    compaction: { enabled: false },
    cacheWarming: 'off',
    enableInstallTelemetry: false,
    httpIdleTimeoutMs: 60_000,
    retry: {
      enabled: maxRetries > 0,
      maxRetries,
      baseDelayMs: 1_000,
      maxAgentDelayMs: 4_000,
      provider: { maxRetries: 0, timeoutMs: providerTimeoutMs, maxRetryDelayMs: 4_000 },
    },
  });
}

export interface PaperSessionInput {
  readonly modelRuntime: ModelRuntime;
  /** The base model (MiniMax-M3, or the faux model); copied with `maxTokens` below. */
  readonly model: Model<any>;
  readonly maxOutputTokens: number;
  readonly maxRetries: number;
  readonly systemPrompt: string;
  readonly tools: readonly ToolDefinition[];
  /** `history.session_id` (the thread), or the run id on a thread's first turn. */
  readonly sessionId: string;
  /** The thread's stored conversation (§3.2 `history.entries`), or none. */
  readonly entries: readonly SessionEntry[];
  /** Tests only (see paperSettings). */
  readonly providerTimeoutMs?: number;
}

/** The conversation entries a run hands back (§3.2 `done.entries`). */
export type ConversationEntry = SessionEntry & { readonly type: 'message' };

/** What an exported failed message says instead of the provider's own words. */
export const REDACTED_PROVIDER_ERROR =
  "The model request failed (details are in the agent's debug log).";

/**
 * §3.3: a raw `errorMessage` (provider JSON, request ids, install paths) never leaves the agent
 * except at debug level — and `done.entries` travels in the SSE stream. A message that failed keeps
 * its stop reason and its content; only the provider's text is replaced.
 */
function redactProviderError<T>(message: T): T {
  const m = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
  if (m.role !== 'assistant' || m.stopReason !== 'error' || typeof m.errorMessage !== 'string')
    return message;
  return { ...message, errorMessage: REDACTED_PROVIDER_ERROR };
}

export class DisposedSessionError extends Error {
  constructor() {
    super('This session was disposed; it is never prompted again.');
  }
}

/** One run's Pi session, behind the guards the spike found were needed. */
export class PaperSession {
  readonly session: AgentSession;
  private disposed = false;

  constructor(session: AgentSession) {
    this.session = session;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** `prompt()` with `expandPromptTemplates: false`, and never on a disposed session. */
  async prompt(text: string): Promise<void> {
    if (this.disposed) throw new DisposedSessionError();
    await this.session.prompt(text, PROMPT_OPTIONS);
  }

  /** `session.abort()` without awaiting idle: safe to call from inside an event listener. */
  abort(): void {
    if (this.disposed) return;
    void this.session.abort();
  }

  /**
   * The conversation as the model will see it next: the message entries (user, assistant,
   * toolResult) on the active branch of Pi's session projection, re-chained into one list.
   *
   * What is left out, on purpose, and why:
   *  - the session header, `model_change` and `thinking_level_change` entries: this wrapper sets the
   *    model and the thinking level on every run;
   *  - `role: "system"` messages: the system prompt is rebuilt from THIS run's request every time
   *    (it holds the run's passages and datamark), so a stored copy would only be stale;
   *  - `context_edit` entries and the attempts they omit: a failed attempt Pi retried is not part of
   *    the conversation.
   *
   * `parentId`s are rewritten to the previous kept entry, because `SessionManager.inMemory` walks
   * parent links from the last entry and silently stops at a missing one — a dropped entry left as
   * a parent would truncate the restored history without an error.
   */
  exportConversation(): ConversationEntry[] {
    const projection = this.session.sessionManager.buildSessionProjection();
    const kept: ConversationEntry[] = [];
    for (const projected of projection.entries) {
      const entry = projected.sourceEntry;
      if (entry.type !== 'message') continue;
      const message = projected.messages[0];
      if (projected.messages.length !== 1 || message === undefined) continue;
      if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult')
        continue;
      const previous = kept.at(-1);
      kept.push({
        ...entry,
        parentId: previous ? previous.id : null,
        message: redactProviderError(message),
      } as ConversationEntry);
    }
    return kept;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session.dispose();
  }
}

/** Build one run's session. The only `createAgentSession` call in the service. */
export async function createPaperSession(input: PaperSessionInput): Promise<PaperSession> {
  const tools = [...input.tools];
  const { session } = await createAgentSession({
    cwd: '/',
    model: { ...input.model, maxTokens: input.maxOutputTokens },
    thinkingLevel: 'low',
    modelRuntime: input.modelRuntime,
    resourceLoader: emptyResourceLoader(input.systemPrompt),
    settingsManager: paperSettings(input.maxRetries, input.providerTimeoutMs),
    sessionManager: SessionManager.inMemory('/', { id: input.sessionId }, [...input.entries]),
    tools: tools.map((tool) => tool.name),
    customTools: tools,
  });
  return new PaperSession(session);
}
