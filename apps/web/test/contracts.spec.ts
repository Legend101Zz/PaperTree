// @vitest-environment node
/**
 * contracts.spec — the browser's hand-written wire types against the committed contracts
 * (contracts.md §0, §5, §9).
 *
 *   API types     sample objects TYPED as the §5 types (`lib/api/types.ts`) and as the feature
 *                 modules' request and response types are validated with ajv against
 *                 `contracts/api/*.schema.json`, which the API EXPORTS from its pydantic models.
 *                 The drift is caught in both directions, because the schemas forbid extra keys:
 *                 a field the web adds must appear in the sample for it to type-check, and the
 *                 schema then refuses it; a field the web drops cannot appear in the sample, and
 *                 the schema then misses it. (`tsc --noEmit` is the half of this spec that runs
 *                 in `turbo run typecheck`.)
 *   ErrorCode     the union equals `errors.py`'s enum, read from the exported envelope schema;
 *                 RunErrorCode equals the agent contract's.
 *   agent         every `data` frame of `contracts/agent/fixtures/*.sse` validates against the
 *                 hand-written `run-events.schema.json`; the request examples against
 *                 `run-request.schema.json`.
 *   anchors       every `contracts/anchor/examples/*.json` is an Anchor by the hand-written
 *                 schema AND, embedded in a Highlight, by the API's exported one.
 *
 * The pre-release response shapes (`papers.ts`'s `UploadResponse`, `JobStatus`, `PaperListRow`)
 * are deliberately NOT checked: they describe what the server answers until S1, not §2.2.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import type { BoardView, CreateEdgeBody, CreateNodeBody, PatchBoardBody } from '@/lib/api/boards';
import type { PatchEdgeBody, PatchNodeBody } from '@/lib/api/boards';
import { isErrorCode } from '@/lib/api/client';
import type {
  CreateHighlightBody,
  PutResolutionsBody,
  UpdateHighlightBody,
} from '@/lib/api/highlights';
import type { SummaryStatus } from '@/lib/api/summary';
import type { CreateThreadBody, FollowUpBody } from '@/lib/api/threads';
import type {
  Anchor,
  Board,
  CanvasEdge,
  CanvasNode,
  Citation,
  ErrorCode,
  Highlight,
  JobSummary,
  LibraryPaper,
  Message,
  RunErrorCode,
  RunSummary,
  SseEvent,
  Summary,
  Thread,
} from '@/lib/api/types';
import type { UsageTotals } from '@/lib/api/usage';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

function load(path: string): unknown {
  return JSON.parse(readFileSync(`${REPO}${path}`, 'utf8'));
}

type Validate = ((value: unknown) => boolean) & { errors?: unknown[] | null };
const ajv = new Ajv2020({ strict: true, allErrors: true });
const API_GROUPS = [
  'errors',
  'auth',
  'papers',
  'highlights',
  'threads',
  'sse',
  'summary',
  'usage',
  'boards',
  'healthz',
  'internal',
] as const;
for (const group of API_GROUPS) {
  ajv.addSchema(load(`contracts/api/${group}.schema.json`) as object, group);
}
ajv.addSchema(load('contracts/agent/run-events.schema.json') as object, 'run-events');
ajv.addSchema(load('contracts/agent/run-request.schema.json') as object, 'run-request');
ajv.addSchema(load('contracts/agent/internal-tools.schema.json') as object, 'internal-tools');
ajv.addSchema(load('contracts/anchor/anchor-v1.schema.json') as object, 'anchor-v1');

const compiled = new Map<string, Validate>();
function validator(ref: string): Validate {
  let found = compiled.get(ref);
  if (found === undefined) {
    found = ajv.compile({ $ref: ref }) as Validate;
    compiled.set(ref, found);
  }
  return found;
}

/** `value` against `<group>#/$defs/<model>`; the message is ajv's errors. */
function expectValid(group: string, model: string, value: unknown): void {
  const validate = validator(`${group}#/$defs/${model}`);
  expect(validate(value), `${group}.${model}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

function expectInvalid(group: string, model: string, value: unknown): void {
  expect(validator(`${group}#/$defs/${model}`)(value), `${group}.${model} accepted it`).toBe(false);
}

// ─── samples, typed as the web's own types ────────────────────────────────────────────────────

const T = '2026-09-25T15:09:25.123Z';
const EXAMPLES = `${REPO}contracts/anchor/examples/`;
const TEXT_ANCHOR = load('contracts/anchor/examples/text.json') as Anchor;
const CITATION_ANCHOR = load('contracts/anchor/examples/citation.json') as Anchor;
const LEGACY_ANCHOR = load('contracts/anchor/examples/legacy-0001.json') as Anchor;

const JOB: JobSummary = {
  job_id: 'job_01K63A9W4XJ7Q2N8R5T0V3Y6ZC',
  kind: 'parse',
  state: 'running',
  step: 'persist',
  done: 2,
  total: 3,
  attempt: 1,
  max_attempts: 3,
  error_code: null,
};

const PAPER: LibraryPaper = {
  paper_id: 'ppr_C425DTWW1KYMYDSWR205HB2069',
  title: 'You Only Look Once: Unified, Real-Time Object Detection',
  authors: ['Joseph Redmon', 'Santosh Divvala'],
  original_filename: 'yolo-1506.02640.pdf',
  source_hash: 'sha256:54bcd2dd05dc618849e8a94d8b88fe3eeb37f80e96e200600d38f1f733931678',
  page_count: 10,
  processing: 'reading',
  job: JOB,
  generation: 1,
  parser_version: '1.0.0',
  highlight_count: 3,
  created_at: T,
  updated_at: T,
};

const HIGHLIGHT: Highlight = {
  highlight_id: 'hl_01K63A9W4XJ7Q2N8R5T0V3Y6ZD',
  color: 'amber',
  note: null,
  created_generation: 1,
  created_at: T,
  updated_at: T,
  anchors: [
    {
      anchor_id: TEXT_ANCHOR.id,
      ordinal: 0,
      anchor: TEXT_ANCHOR,
      resolution: {
        generation: 1,
        tier: 1,
        state: 'anchored',
        block_ids: ['blk_dog5ufrf3mc2bwqy'],
        score: 1,
        reason: null,
        resolver_version: 'anchoring@1.0.0',
      },
    },
    {
      anchor_id: LEGACY_ANCHOR.id,
      ordinal: 1,
      anchor: LEGACY_ANCHOR,
      resolution: {
        generation: 2,
        tier: 6,
        state: 'orphan',
        block_ids: [],
        score: null,
        reason: 'quote_below_threshold',
        resolver_version: 'anchoring@1.0.0',
      },
    },
  ],
};

const RUN: RunSummary = {
  run_id: 'run_01K63AE8M4Q2T7V9X3B5N6R0C1',
  model: 'MiniMax-M3',
  provider: 'minimax',
  agent_sdk: 'pi-coding-agent@0.87.1',
  input_tokens: 4279,
  output_tokens: 311,
  cache_read_tokens: 1664,
  reasoning_tokens: 99,
  cost_usd_est: 0.001553,
  first_text_ms: 3812,
  latency_ms: 7694,
  retries: 0,
  tool_calls: 1,
};

const CITATION: Citation = {
  citation_id: 'cit_01K63A9W4XJ7Q2N8R5T0V3Y6ZE',
  ordinal: 0,
  marker: 'b3',
  page_index: 1,
  anchor: CITATION_ANCHOR,
  supported: true,
};

const ANSWER: Message = {
  message_id: 'msg_01K63A9W4XJ7Q2N8R5T0V3Y6ZF',
  thread_id: 'thr_01K63A9W4XJ7Q2N8R5T0V3Y6ZB',
  ordinal: 1,
  role: 'assistant',
  content: 'This sentence is the paper’s central move [b3].',
  status: 'complete',
  error: null,
  generation: 1,
  run: RUN,
  citations: [CITATION],
  created_at: T,
  completed_at: T,
};

const FAILED: Message = {
  ...ANSWER,
  message_id: 'msg_01K63A9W4XJ7Q2N8R5T0V3Y6ZG',
  status: 'partial',
  error: { code: 'timeout', retryable: true, message: 'The model stopped responding.' },
  citations: [],
  completed_at: null,
};

const QUESTION: Message = {
  ...ANSWER,
  message_id: 'msg_01K63A9W4XJ7Q2N8R5T0V3Y6ZH',
  ordinal: 0,
  role: 'user',
  content: 'Explain this passage.',
  run: null,
  citations: [],
};

const THREAD: Thread = {
  thread_id: 'thr_01K63A9W4XJ7Q2N8R5T0V3Y6ZB',
  kind: 'explain',
  title: 'Instead, we frame object detection as a regression problem…',
  origin_anchor: TEXT_ANCHOR,
  created_at: T,
  updated_at: T,
  message_count: 2,
};

const EVENTS: SseEvent[] = [
  {
    event: 'run',
    data: {
      run_id: RUN.run_id,
      thread_id: THREAD.thread_id,
      user_message_id: QUESTION.message_id,
      message_id: ANSWER.message_id,
      generation: 1,
    },
  },
  {
    event: 'run',
    data: {
      run_id: RUN.run_id,
      thread_id: null,
      user_message_id: null,
      message_id: ANSWER.message_id,
      generation: 1,
    },
  },
  { event: 'status', data: { phase: 'thinking' } },
  { event: 'status', data: { phase: 'tool', label: 'Reading p. 4 · §2.1' } },
  {
    event: 'status',
    data: { phase: 'retrying', label: 'Trying again', attempt: 1, delay_ms: 1000 },
  },
  { event: 'text', data: { delta: 'This sentence is ' } },
  { event: 'citations', data: { items: [CITATION] } },
  { event: 'usage', data: RUN },
  { event: 'done', data: { status: 'complete', error: null, message_id: ANSWER.message_id } },
  {
    event: 'done',
    data: {
      status: 'error',
      error: { code: 'budget_exhausted', retryable: false, message: 'Daily budget used.' },
      message_id: ANSWER.message_id,
    },
  },
];
const SSE_MODEL: Record<SseEvent['event'], string> = {
  run: 'SseRun',
  status: 'SseStatus',
  text: 'SseText',
  citations: 'SseCitations',
  usage: 'RunSummary',
  done: 'SseDone',
};

const SUMMARY: Summary = {
  generation: 1,
  model: 'MiniMax-M3',
  prompt_version: 'summary-v1',
  created_at: T,
  status: 'partial',
  bullets: [
    { text: 'YOLO frames detection as one regression.', citations: [CITATION], supported: true },
    { text: 'It is fast.', citations: [], supported: false },
  ],
};

const BOARD: Board = {
  board_id: 'brd_01K63A9W4XJ7Q2N8R5T0V3Y6ZJ',
  paper_id: PAPER.paper_id,
  title: 'YOLO',
  viewport: { x: -120, y: 40.5, zoom: 0.8 },
  created_at: T,
  updated_at: T,
};
const EXCERPT: CanvasNode = {
  node_id: 'cn_0f9e8d7c-aaaa-4bbb-8ccc-123456789abc',
  board_id: BOARD.board_id,
  kind: 'excerpt',
  group_id: null,
  x: 10,
  y: 20,
  w: 240,
  h: 120,
  z: 0,
  title: null,
  body: '',
  source_anchor: TEXT_ANCHOR,
  source_message_id: null,
  version: 1,
  created_at: T,
  updated_at: T,
};
const NOTE: CanvasNode = {
  ...EXCERPT,
  node_id: 'cn_0f9e8d7c-aaaa-4bbb-8ccc-123456789abd',
  kind: 'note',
  group_id: 'cn_0f9e8d7c-aaaa-4bbb-8ccc-123456789abe',
  title: 'Why one pass',
  body: 'Speed comes from one evaluation.',
  source_anchor: null,
  version: 4,
};
const EDGE: CanvasEdge = {
  edge_id: 'ce_0f9e8d7c-aaaa-4bbb-8ccc-123456789abf',
  board_id: BOARD.board_id,
  from_node_id: NOTE.node_id,
  to_node_id: EXCERPT.node_id,
  kind: 'supports',
  label: null,
};

// ─── the tests ────────────────────────────────────────────────────────────────────────────────

describe('contracts.spec — lib/api/types.ts against contracts/api (exported from pydantic)', () => {
  it('ErrorCode is exactly errors.py’s enum, and the client knows every code', () => {
    // `satisfies` makes this object exactly the union: a missing or an extra key fails tsc.
    const CODES = {
      auth_required: true,
      invalid_credentials: true,
      email_taken: true,
      not_found: true,
      validation_failed: true,
      empty_upload: true,
      payload_too_large: true,
      unsupported_media_type: true,
      not_parsed: true,
      not_failed: true,
      busy: true,
      stale_version: true,
      generation_not_found: true,
      anchor_incomplete: true,
      anchor_mismatch: true,
      budget_exhausted: true,
      agent_unavailable: true,
      not_configured: true,
      internal: true,
      not_implemented: true,
    } satisfies Record<ErrorCode, true>;
    const errors = load('contracts/api/errors.schema.json') as {
      $defs: { ErrorEnvelope: { properties: { code: { enum: string[] } } } };
    };
    const exported = errors.$defs.ErrorEnvelope.properties.code.enum;
    expect([...exported].sort()).toEqual(Object.keys(CODES).sort());
    for (const code of exported) expect(isErrorCode(code), code).toBe(true);
    expect(isErrorCode('email_in_use')).toBe(false);
  });

  it('RunErrorCode is exactly the agent contract’s', () => {
    const RUN_CODES = {
      provider_auth: true,
      rate_limited: true,
      quota: true,
      upstream_unavailable: true,
      timeout: true,
      aborted: true,
      bad_request: true,
      tool_failed: true,
      tool_budget_exhausted: true,
      output_truncated: true,
      agent_unavailable: true,
      internal: true,
    } satisfies Record<RunErrorCode, true>;
    const events = load('contracts/agent/run-events.schema.json') as {
      $defs: { RunErrorCode: { enum: string[] } };
    };
    expect([...events.$defs.RunErrorCode.enum].sort()).toEqual(Object.keys(RUN_CODES).sort());
  });

  it('library, highlight, thread, summary and canvas samples validate', () => {
    expectValid('papers', 'JobSummary', JOB);
    expectValid('papers', 'LibraryPaper', PAPER);
    expectValid('papers', 'LibraryPaper', {
      ...PAPER,
      processing: 'failed',
      job: { ...JOB, state: 'dead_letter', step: null, error_code: 'pdf_unreadable' },
      generation: null,
      parser_version: null,
      page_count: null,
      original_filename: null,
    } satisfies LibraryPaper);
    expectValid('highlights', 'Highlight', HIGHLIGHT);
    expectValid('threads', 'RunSummary', RUN);
    expectValid('threads', 'Citation', CITATION);
    for (const message of [ANSWER, FAILED, QUESTION]) expectValid('threads', 'Message', message);
    expectValid('threads', 'Thread', THREAD);
    expectValid('threads', 'Thread', {
      ...THREAD,
      kind: 'ask',
      origin_anchor: null,
    } satisfies Thread);
    expectValid('threads', 'ThreadDetail', { thread: THREAD, messages: [QUESTION, ANSWER] });
    expectValid('summary', 'Summary', SUMMARY);
    expectValid('summary', 'SummaryStatus', {
      state: 'ready',
      summary: SUMMARY,
    } satisfies SummaryStatus);
    expectValid('summary', 'SummaryStatus', {
      state: 'none',
      summary: null,
    } satisfies SummaryStatus);
    expectValid('boards', 'Board', BOARD);
    expectValid('boards', 'Board', { ...BOARD, viewport: null } satisfies Board);
    expectValid('boards', 'CanvasNode', EXCERPT);
    expectValid('boards', 'CanvasNode', NOTE);
    expectValid('boards', 'CanvasEdge', EDGE);
    const view: BoardView = { board: BOARD, nodes: [EXCERPT, NOTE], edges: [EDGE] };
    expectValid('boards', 'BoardView', view);
    expectValid('boards', 'BoardView', { board: null, nodes: [], edges: [] } satisfies BoardView);
    const bucket = { runs: 2, input_tokens: 4279, output_tokens: 311, cost_usd_est: 0.0016 };
    const usage: UsageTotals = {
      since: T,
      ...bucket,
      budget_usd: 1,
      by_kind: { explain: bucket, ask: { ...bucket, runs: 0 }, summary: bucket },
    };
    expectValid('usage', 'UsageTotals', usage);
  });

  it('every browser SSE event’s data validates against its model', () => {
    for (const { event, data } of EVENTS) expectValid('sse', SSE_MODEL[event], data);
  });

  it('the request bodies the feature modules send validate against the request models', () => {
    const create: CreateHighlightBody = {
      highlight_id: HIGHLIGHT.highlight_id,
      color: 'green',
      note: 'the grid',
      anchors: [{ anchor: TEXT_ANCHOR }],
      resolutions: [
        {
          anchor_id: TEXT_ANCHOR.id,
          generation: 1,
          tier: 1,
          state: 'anchored',
          block_ids: ['blk_dog5ufrf3mc2bwqy'],
          score: 1,
          resolver_version: 'anchoring@1.0.0',
        },
      ],
    };
    expectValid('highlights', 'HighlightCreate', create);
    expectValid('highlights', 'HighlightCreate', {
      highlight_id: HIGHLIGHT.highlight_id,
      color: 'pink',
      anchors: [{ anchor: TEXT_ANCHOR }],
    } satisfies CreateHighlightBody);
    for (const patch of [{ color: 'blue' }, { note: null }, {}] satisfies UpdateHighlightBody[]) {
      expectValid('highlights', 'HighlightPatch', patch);
    }
    const put: PutResolutionsBody = {
      generation: 2,
      items: [
        {
          anchor_id: LEGACY_ANCHOR.id,
          tier: 3,
          state: 'approximate',
          block_ids: ['blk_5zsa4uze7d6kq6zl'],
          score: 0.8,
          reason: 'block_text_changed',
          resolver_version: 'anchoring@1.0.0',
          upgraded_anchor: LEGACY_ANCHOR,
        },
      ],
    };
    expectValid('highlights', 'ResolutionsPut', put);
    for (const body of [
      { kind: 'explain', anchor: TEXT_ANCHOR },
      { kind: 'ask', question: 'What does YOLO predict?' },
    ] satisfies CreateThreadBody[]) {
      expectValid('threads', 'ThreadCreate', body);
    }
    const follow: FollowUpBody = { question: 'And that?', retry_of: FAILED.message_id };
    expectValid('threads', 'FollowUp', follow);
    const node: CreateNodeBody = {
      node_id: EXCERPT.node_id,
      kind: 'excerpt',
      x: 0,
      y: 0,
      w: 240,
      h: 120,
      source_anchor: TEXT_ANCHOR,
    };
    expectValid('boards', 'NodeCreate', node);
    const patchNode: PatchNodeBody = { version: 3, x: 12.5, y: -4, group_id: null, title: null };
    expectValid('boards', 'NodePatch', patchNode);
    const edge: CreateEdgeBody = {
      edge_id: EDGE.edge_id,
      from_node_id: NOTE.node_id,
      to_node_id: EXCERPT.node_id,
      kind: 'derives_from',
      label: 'because',
    };
    expectValid('boards', 'EdgeCreate', edge);
    expectValid('boards', 'EdgePatch', {
      kind: 'contradicts',
      label: null,
    } satisfies PatchEdgeBody);
    expectValid('boards', 'BoardPatch', {
      title: 'YOLO',
      viewport: { x: 0, y: 0, zoom: 1 },
    } satisfies PatchBoardBody);
  });

  it('the schemas refuse what the contract forbids (the check is not vacuous)', () => {
    expectInvalid('highlights', 'Highlight', { ...HIGHLIGHT, owner_id: 'own_x' });
    expectInvalid('highlights', 'Highlight', { ...HIGHLIGHT, color: 'red' });
    expectInvalid('highlights', 'Highlight', {
      ...HIGHLIGHT,
      created_at: '2026-09-25T15:09:25+00:00',
    });
    const { anchors: _dropped, ...withoutAnchors } = HIGHLIGHT;
    expectInvalid('highlights', 'Highlight', withoutAnchors);
    expectInvalid('papers', 'LibraryPaper', { ...PAPER, processing: 'pending' });
    expectInvalid('sse', 'SseStatus', { phase: 'tool', label: null });
    expectInvalid('threads', 'ThreadCreate', { kind: 'explain', question: 'x', extra: true });
    expectInvalid('errors', 'ErrorEnvelope', { detail: 'x', code: 'teapot', retryable: false });
  });
});

describe('contracts.spec — the agent contract (hand-written) and its recorded streams', () => {
  const fixtures = readdirSync(`${REPO}contracts/agent/fixtures`).filter((f) => f.endsWith('.sse'));

  it('there are the eight recorded streams', () => {
    expect(fixtures.sort()).toEqual(
      [
        'aborted-partial',
        'auth-error',
        'explain-ok',
        'followup-ok',
        'stall-timeout',
        'summary-ok',
        'tool-budget',
        'upstream-503-retry-ok',
      ].map((name) => `${name}.sse`),
    );
  });

  it('every frame of every stream validates against run-events.schema.json', () => {
    const frameOf = validator('run-events');
    let frames = 0;
    for (const file of fixtures) {
      const text = readFileSync(`${REPO}contracts/agent/fixtures/${file}`, 'utf8');
      expect(text.endsWith('\n\n'), file).toBe(true);
      for (const block of text.slice(0, -2).split('\n\n')) {
        if (block === ': ping') continue;
        const [eventLine, dataLine, ...rest] = block.split('\n');
        expect(rest, `${file}: a frame is two lines`).toEqual([]);
        expect(eventLine?.startsWith('event: ') && dataLine?.startsWith('data: '), block).toBe(
          true,
        );
        const frame = {
          event: (eventLine ?? '').slice('event: '.length),
          data: JSON.parse((dataLine ?? '').slice('data: '.length)) as unknown,
        };
        expect(frameOf(frame), `${file}: ${JSON.stringify(frameOf.errors)}`).toBe(true);
        frames += 1;
      }
    }
    expect(frames).toBeGreaterThan(100);
  });

  it('the run-request examples validate, and a summary with a seed does not', () => {
    const request = validator('run-request');
    for (const name of ['explain', 'followup', 'summary']) {
      const body = load(`contracts/agent/examples/run-request-${name}.json`);
      expect(request(body), `${name}: ${JSON.stringify(request.errors)}`).toBe(true);
    }
    const summary = load('contracts/agent/examples/run-request-summary.json') as Record<
      string,
      unknown
    >;
    const explain = load('contracts/agent/examples/run-request-explain.json') as Record<
      string,
      unknown
    >;
    expect(request({ ...summary, seed: explain['seed'] })).toBe(false);
  });

  it('a ToolResult is one shape in the hand-written and the exported schema', () => {
    const result = { text: '[b3] (p. 2 · 2. Unified Detection · paragraph) …', handles: ['b3'] };
    expectValid('internal-tools', 'ToolResult', result);
    expectValid('internal', 'ToolResult', result);
    expectValid('internal', 'ToolResult', { ...result, next_cursor: null });
    expectInvalid('internal-tools', 'ToolResult', { text: 'x', handles: ['3'] });
  });
});

describe('contracts.spec — anchors from both producers', () => {
  const examples = readdirSync(EXAMPLES).filter((f) => f.endsWith('.json'));

  it('every example is an Anchor v1, and a Highlight carrying it is valid by the API’s schema', () => {
    expect(examples).toContain('legacy-0001.json');
    for (const file of examples) {
      const anchor = JSON.parse(readFileSync(`${EXAMPLES}${file}`, 'utf8')) as Anchor;
      const validate = validator('anchor-v1');
      expect(validate(anchor), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
      const highlight: Highlight = {
        ...HIGHLIGHT,
        anchors: [{ anchor_id: anchor.id, ordinal: 0, anchor, resolution: null }],
      };
      expectValid('highlights', 'Highlight', highlight);
    }
  });
});
