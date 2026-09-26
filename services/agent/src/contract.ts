/**
 * The wire contract this service speaks (contracts.md §3–§4), and the facts it is built on.
 *
 * The request is validated against the COMMITTED `contracts/agent/run-request.schema.json` at
 * runtime (typebox/schema is a JSON Schema 2020-12 validator), so there is no hand-written mirror to
 * drift from the file the API side is also held to. `test/contract.test.ts` compares its answers
 * with ajv's on the same schema.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Compile } from 'typebox/schema';

/** The four read-only paper tools, in the order they are registered (contracts.md §3.1, §4). */
export const TOOL_NAMES = ['get_outline', 'get_section', 'get_passage', 'search_passages'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** `run.model` is a schema const (run-events.schema.json). */
export const MODEL_LABEL = 'minimax/MiniMax-M3';
export const PROVIDER_ID = 'minimax';
export const MODEL_ID = 'MiniMax-M3';

/** The pins in package.json. Boot refuses to start if the installed copies disagree. */
export const PINNED_SDK_VERSION = '0.87.1';

/** The version of the copy of `name` this service actually loads (its `package.json` is not exported). */
function installedVersion(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.resolve(name)));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      if (manifest.name === name && typeof manifest.version === 'string') return manifest.version;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name}: no package.json above its entry point`);
    dir = parent;
  }
}

export const SDK_VERSION = installedVersion('@earendil-works/pi-coding-agent');
export const PI_AI_VERSION = installedVersion('@earendil-works/pi-ai');
export const SDK_LABEL = `pi-coding-agent@${SDK_VERSION}`;

/**
 * The repo's `contracts/agent/`, found by walking up from this file (so a copy of this package
 * anywhere inside the repo — the mutation runner's — reads the same committed contract).
 */
function findContractsDir(): URL {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'contracts', 'agent', 'run-request.schema.json'))) {
      return pathToFileURL(join(dir, 'contracts', 'agent') + '/');
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('contracts/agent/ not found above services/agent');
    dir = parent;
  }
}

export const CONTRACTS_DIR = findContractsDir();

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, CONTRACTS_DIR), 'utf8')) as Record<string, unknown>;
}

const requestSchema = loadSchema('run-request.schema.json');
const requestValidator = Compile(requestSchema);

/** For an `if`/`then` failure (reported at the root), the fields its `then` constrains. */
function conditionalFields(schemaPath: string): string[] {
  let node: unknown = requestSchema;
  for (const part of schemaPath.replace(/^#\//, '').split('/')) {
    if (typeof node !== 'object' || node === null) return [];
    node = (node as Record<string, unknown>)[part];
  }
  const then = (node as { then?: { properties?: Record<string, unknown> } } | undefined)?.then;
  return Object.keys(then?.properties ?? {});
}

export type Kind = 'explain' | 'ask' | 'summary';
export type PromptVersion = 'explain-v1' | 'ask-v1' | 'summary-v1';

export interface SeedPassage {
  readonly handle: string;
  readonly label: string;
  readonly text: string;
}

export interface RunLimits {
  readonly deadline_ms: number;
  readonly idle_ms: number;
  readonly max_tool_calls: number;
  readonly max_turns: number;
  readonly max_output_tokens: number;
  readonly max_retries: number;
}

/** `POST /v1/runs` body, exactly as run-request.schema.json has it. */
export interface RunRequest {
  readonly run_id: string;
  readonly request_id: string;
  readonly kind: Kind;
  readonly prompt_version: PromptVersion;
  readonly tool: { readonly base_url: string; readonly token: string };
  readonly datamark: string;
  readonly paper: {
    readonly title: string;
    readonly page_count: number | null;
    readonly generation: number;
  };
  readonly seed: {
    readonly quote: string;
    readonly page_label: string;
    readonly section: string | null;
    readonly passages: readonly SeedPassage[];
  } | null;
  readonly question: string;
  readonly history: { readonly session_id: string; readonly entries: readonly unknown[] } | null;
  readonly limits: RunLimits;
}

/** The prompt each kind runs under. A request that pairs them otherwise is refused (S0 left it open). */
export const PROMPT_FOR_KIND: Readonly<Record<Kind, PromptVersion>> = {
  explain: 'explain-v1',
  ask: 'ask-v1',
  summary: 'summary-v1',
};

/**
 * The longest delay Node's timers take (2^31 - 1 ms, about 24.8 days). The schema sets no maximum;
 * a longer `deadline_ms` makes `AbortSignal.timeout` throw and a longer `idle_ms` fires at once
 * (TimeoutOverflowWarning), so both are refused before the stream starts (review should-fix).
 */
export const MAX_TIMER_MS = 2_147_483_647;

export type Validation =
  | { readonly ok: true; readonly request: RunRequest }
  | { readonly ok: false; readonly detail: string };

/** Validate a parsed body against the committed contract, then the rules the schema cannot say. */
export function validateRunRequest(body: unknown): Validation {
  const [ok, errors] = requestValidator.Errors(body);
  if (!ok) {
    // Name the most specific failing field (an if/then failure also reports the root).
    const deepest = errors.toSorted((a, b) => b.instancePath.length - a.instancePath.length)[0];
    if (deepest && deepest.instancePath === '' && deepest.keyword === 'if') {
      const fields = conditionalFields(deepest.schemaPath);
      if (fields.length > 0)
        return { ok: false, detail: `${fields.join(', ')}: does not fit a run of this kind` };
    }
    const where = deepest?.instancePath
      ? deepest.instancePath.slice(1).replaceAll('/', '.')
      : 'body';
    return {
      ok: false,
      detail: `${where}: ${deepest?.message ?? 'does not match the run request contract'}`,
    };
  }
  const request = body as RunRequest;
  for (const name of ['deadline_ms', 'idle_ms'] as const) {
    if (request.limits[name] > MAX_TIMER_MS) {
      return {
        ok: false,
        detail: `limits.${name}: must be at most ${String(MAX_TIMER_MS)} (the longest timer Node can set)`,
      };
    }
  }
  if (PROMPT_FOR_KIND[request.kind] !== request.prompt_version) {
    return {
      ok: false,
      detail: `prompt_version: a ${request.kind} run takes ${PROMPT_FOR_KIND[request.kind]}, not ${request.prompt_version}`,
    };
  }
  if (!request.tool.base_url.endsWith(`/${request.run_id}`)) {
    return { ok: false, detail: "tool.base_url: must end with this run's run_id" };
  }
  const history = historyProblem(request.history?.entries ?? []);
  if (history !== null) return { ok: false, detail: `history.entries: ${history}` };
  return { ok: true, request };
}

const ROLES = new Set(['user', 'assistant', 'toolResult']);

/**
 * `history.entries` must be a conversation this agent handed back: message entries only (user,
 * assistant, toolResult), each one's `parentId` the previous one's `id`. Anything else is refused,
 * because Pi's SessionManager walks parent links from the last entry and silently stops at a
 * missing one — a broken chain would restore a truncated history without any error.
 */
function historyProblem(entries: readonly unknown[]): string | null {
  let previous: string | null = null;
  const ids = new Set<string>();
  for (const [i, raw] of entries.entries()) {
    const entry = raw as {
      type?: unknown;
      id?: unknown;
      parentId?: unknown;
      message?: { role?: unknown };
    };
    if (entry.type !== 'message') return `entry ${String(i)} is not a message entry`;
    if (typeof entry.id !== 'string' || entry.id === '' || ids.has(entry.id))
      return `entry ${String(i)} has no unique id`;
    if (entry.parentId !== previous)
      return `entry ${String(i)} does not follow entry ${String(i - 1)}`;
    if (
      typeof entry.message !== 'object' ||
      entry.message === null ||
      !ROLES.has(String(entry.message.role))
    ) {
      return `entry ${String(i)} is not a user, assistant or toolResult message`;
    }
    ids.add(entry.id);
    previous = entry.id;
  }
  return null;
}

/** §3.2: the marker regex, verbatim. */
export const MARKER_PATTERN = /\[(b\d+(?:\s*,\s*b\d+)*)\]/g;

/** The `[bN]` handles in `text`, deduplicated, first-seen order. */
export function parseMarkers(text: string): string[] {
  const seen: string[] = [];
  for (const match of text.matchAll(MARKER_PATTERN)) {
    for (const handle of (match[1] ?? '').split(/\s*,\s*/)) {
      if (handle && !seen.includes(handle)) seen.push(handle);
    }
  }
  return seen;
}

/** Whether `text` holds at least one §3.2 marker (used to decide a message is an answer). */
export function hasMarker(text: string): boolean {
  return new RegExp(MARKER_PATTERN.source).test(text);
}
