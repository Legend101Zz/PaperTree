/**
 * contracts.md §4: the four read-only paper tools. Each calls the API's internal route for THIS run
 * (`tool.base_url` + `/outline` …) with the run token, and hands the model the API's text verbatim
 * (the API has already datamarked it). The model can only pass handles and words: it cannot choose
 * a paper, a URL or a file.
 *
 * Failures (§3.3 "Tool errors"): a tool throws short, user-safe text only — never a URL, an id, a
 * status or a stack. An unknown handle (404) is the model's to recover from ("Passage b9 is not
 * available."). A tool route that is unusable (401: the grant is gone; 5xx; unreachable; an answer
 * that is not the §4 shape) ends the run as `tool_failed`: an answer that can no longer be grounded
 * is not continued.
 */
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { ToolName } from './contract.ts';
import type { Logger } from './log.ts';

/** What a tool returns past the run's cap (§3.3). */
export const BUDGET_TEXT = 'Tool budget exhausted; answer from what you have.';

/** A tool request that does not answer within this long is a failed tool route. */
export const TOOL_TIMEOUT_MS = 10_000;

const HANDLE = Type.String({
  pattern: '^b[0-9]+$',
  description: 'A handle exactly as given, such as b3.',
});

export const TOOL_PARAMETERS = {
  get_outline: Type.Object({}, { additionalProperties: false }),
  get_section: Type.Object(
    {
      handle: HANDLE,
      cursor: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 64,
          description: 'The cursor a previous get_section result gave, to read the next part.',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  get_passage: Type.Object({ handle: HANDLE }, { additionalProperties: false }),
  search_passages: Type.Object(
    {
      query: Type.String({
        minLength: 1,
        maxLength: 500,
        description: "Words to look for, in the paper's own vocabulary.",
      }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 8,
          description: 'How many passages, 1 to 8 (default 5).',
        }),
      ),
    },
    { additionalProperties: false },
  ),
} as const;

/** What a header `[bN] (p. 2 · 2. Unified Detection · paragraph)` says about a handle. */
export interface HandleInfo {
  readonly page: string;
  readonly section: string;
}

/** `[bN] (label)`, anywhere (an outline may put several on one line); one level of nested parens. */
const HEADER = /\[(b\d+)\] \(([^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g;

/** Remove a run's datamark tokens (`^1a2b3c4d `) so a marked header reads as a header. */
export function stripDatamark(text: string, datamark: string): string {
  return text.split(`${datamark} `).join('').split(datamark).join('');
}

/** Parse one header's inner label `p. 2 · 2. Unified Detection · paragraph`. */
export function parseLabel(label: string): HandleInfo {
  const parts = label.split(' · ');
  if (parts.length >= 3) return { page: parts[0] ?? '', section: parts.slice(1, -1).join(' · ') };
  if (parts.length === 2) return { page: parts[0] ?? '', section: parts[1] ?? '' };
  return { page: parts[0] ?? '', section: '' };
}

/** Every `[bN] (…)` header in a tool text. */
export function parseHeaders(text: string): Array<[string, HandleInfo]> {
  const found: Array<[string, HandleInfo]> = [];
  for (const match of text.matchAll(HEADER)) {
    if (match[1] && match[2]) found.push([match[1], parseLabel(match[2])]);
  }
  return found;
}

/** The per-run state the tools share with the run (run.ts owns it). */
export interface ToolRunContext {
  readonly baseUrl: string;
  readonly token: string;
  readonly requestId: string;
  readonly runId: string;
  readonly log: Logger;
  /** 1-based position of this call among the run's tool calls, assigned at tool_execution_start. */
  callIndex(toolCallId: string): number | undefined;
  readonly maxToolCalls: number;
  /** Handles (and headers) the response to one tool call introduced. */
  onResult(toolCallId: string, handles: readonly string[], text: string): void;
  /** The tool route is unusable: the run ends `tool_failed`. */
  onFatal(): void;
  /** A note to append to this call's result when the run's tool budget is nearly spent. */
  budgetNote?(toolCallId: string): string | undefined;
  /** The text to answer instead of running this call, when the tools are closed (run.ts "Text"). */
  closed?(toolCallId: string): string | undefined;
}

class ToolFailure extends Error {}

interface ToolResultWire {
  readonly text: string;
  readonly handles: readonly string[];
  readonly next_cursor?: string | null;
}

function isToolResult(value: unknown): value is ToolResultWire {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const allowed = new Set(['text', 'handles', 'next_cursor']);
  if (Object.keys(v).some((key) => !allowed.has(key))) return false;
  if (typeof v['text'] !== 'string') return false;
  if (
    !Array.isArray(v['handles']) ||
    !v['handles'].every((h) => typeof h === 'string' && /^b[0-9]+$/.test(h))
  ) {
    return false;
  }
  return (
    v['next_cursor'] === undefined ||
    v['next_cursor'] === null ||
    typeof v['next_cursor'] === 'string'
  );
}

async function call(
  ctx: ToolRunContext,
  toolCallId: string,
  name: ToolName,
  path: string,
  notFound: string,
  signal: AbortSignal | undefined,
  handle?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }> {
  const started = performance.now();
  const url = `${ctx.baseUrl}${path}`;
  const signals = [AbortSignal.timeout(TOOL_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  let status: number | 'network' = 'network';
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${ctx.token}`,
        accept: 'application/json',
        'x-request-id': ctx.requestId,
      },
      signal: AbortSignal.any(signals),
      redirect: 'error',
    });
    status = response.status;
    if (response.status === 200) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      if (!isToolResult(body)) {
        ctx.onFatal();
        throw new ToolFailure('The paper could not be read.');
      }
      ctx.onResult(toolCallId, body.handles, body.text);
      let text = body.text;
      const note = ctx.budgetNote?.(toolCallId);
      if (typeof body.next_cursor === 'string' && handle !== undefined) {
        text += `\n\n(This section continues. To read on, call get_section with handle "${handle}" and cursor "${body.next_cursor}".)`;
      }
      if (note !== undefined) text += `\n\n${note}`;
      return {
        content: [{ type: 'text', text }],
        details: { handles: [...body.handles], next_cursor: body.next_cursor ?? null },
      };
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 404) throw new ToolFailure(notFound);
    if (response.status === 429) {
      return { content: [{ type: 'text', text: BUDGET_TEXT }], details: { budget: true } };
    }
    ctx.onFatal();
    throw new ToolFailure('The paper could not be read.');
  } catch (error) {
    if (error instanceof ToolFailure) throw error;
    if (signal?.aborted) throw new ToolFailure('Operation aborted');
    ctx.onFatal();
    throw new ToolFailure('The paper could not be read.');
  } finally {
    ctx.log.info('agent.tool', {
      run_id: ctx.runId,
      request_id: ctx.requestId,
      name,
      ...(handle === undefined ? {} : { handle }),
      status,
      ms: Math.round(performance.now() - started),
    });
  }
}

/** A call the run has refused (the answer already started), or undefined to run it. */
function refusal(ctx: ToolRunContext, toolCallId: string) {
  const text = ctx.closed?.(toolCallId);
  if (text === undefined) return undefined;
  return { content: [{ type: 'text' as const, text }], details: { refused: true } };
}

function budgetExhausted(ctx: ToolRunContext, toolCallId: string): boolean {
  const index = ctx.callIndex(toolCallId);
  return index === undefined || index > ctx.maxToolCalls;
}

const BUDGET_RESULT = () => ({
  content: [{ type: 'text' as const, text: BUDGET_TEXT }],
  details: { budget: true },
});

/** The four tools for one run. The order is the registration order (§3.1's boot assertion). */
export function createPaperTools(ctx: ToolRunContext): ToolDefinition[] {
  const getOutline = defineTool({
    name: 'get_outline',
    label: 'Outline',
    description:
      "List the paper's sections: each heading with its level, page and handle. Takes no arguments. " +
      'Start here to find your way around the paper.',
    parameters: TOOL_PARAMETERS.get_outline,
    executionMode: 'parallel',
    async execute(toolCallId, _params, signal) {
      const refused = refusal(ctx, toolCallId);
      if (refused) return refused;
      if (budgetExhausted(ctx, toolCallId)) return BUDGET_RESULT();
      return call(
        ctx,
        toolCallId,
        'get_outline',
        '/outline',
        'The outline is not available.',
        signal,
      );
    },
  });
  const getSection = defineTool({
    name: 'get_section',
    label: 'Section',
    description:
      "Read the body of the section that a handle belongs to (a heading's handle or any passage's " +
      'handle), in reading order. A long section comes in parts: pass the cursor a result gave to read on.',
    parameters: TOOL_PARAMETERS.get_section,
    executionMode: 'parallel',
    async execute(toolCallId, params, signal) {
      const refused = refusal(ctx, toolCallId);
      if (refused) return refused;
      if (budgetExhausted(ctx, toolCallId)) return BUDGET_RESULT();
      const query =
        params.cursor === undefined ? '' : `?cursor=${encodeURIComponent(params.cursor)}`;
      return call(
        ctx,
        toolCallId,
        'get_section',
        `/sections/${encodeURIComponent(params.handle)}${query}`,
        `Passage ${params.handle} is not available.`,
        signal,
        params.handle,
      );
    },
  });
  const getPassage = defineTool({
    name: 'get_passage',
    label: 'Passage',
    description:
      'Read one passage by its handle, with its caption, figure or table when it has one.',
    parameters: TOOL_PARAMETERS.get_passage,
    executionMode: 'parallel',
    async execute(toolCallId, params, signal) {
      const refused = refusal(ctx, toolCallId);
      if (refused) return refused;
      if (budgetExhausted(ctx, toolCallId)) return BUDGET_RESULT();
      return call(
        ctx,
        toolCallId,
        'get_passage',
        `/passages/${encodeURIComponent(params.handle)}`,
        `Passage ${params.handle} is not available.`,
        signal,
        params.handle,
      );
    },
  });
  const searchPassages = defineTool({
    name: 'search_passages',
    label: 'Search',
    description:
      'Find passages by words. Returns the best-matching passages with their handles; when nothing ' +
      'matches it returns the outline instead.',
    parameters: TOOL_PARAMETERS.search_passages,
    executionMode: 'parallel',
    async execute(toolCallId, params, signal) {
      const refused = refusal(ctx, toolCallId);
      if (refused) return refused;
      if (budgetExhausted(ctx, toolCallId)) return BUDGET_RESULT();
      const limit = params.limit ?? 5;
      return call(
        ctx,
        toolCallId,
        'search_passages',
        `/search?q=${encodeURIComponent(params.query)}&limit=${String(limit)}`,
        'The search is not available.',
        signal,
      );
    },
  });
  return [getOutline, getSection, getPassage, searchPassages];
}
