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
 *   keys + enums  a sample only shows the keys it HAS, so an optional key added on one side, a
 *                 defaulted server field, or a widened enum (`color: string`) slipped past the
 *                 samples (S0 review S3). In tsc, `KEYS_ARE_EXACT` holds every type's keys to its
 *                 schema's `properties` (the schemas are imported, so TypeScript knows their
 *                 property names) and its optional keys to `OPTIONAL`, which the test holds to
 *                 the schema's `required`; `ENUMS` lists every enum-valued key's values, held to
 *                 the schema by value and to the type by `Equal<…>`. Any other widening (a
 *                 `number` key typed `string`) is still the samples' to catch.
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

import type {
  BoardView,
  CreateEdgeBody,
  CreateNodeBody,
  PatchBoardBody,
  boardsApi,
} from '@/lib/api/boards';
import type { PatchEdgeBody, PatchNodeBody } from '@/lib/api/boards';
import { isErrorCode } from '@/lib/api/client';
import type {
  CreateHighlightBody,
  PutResolutionsBody,
  ResolutionIn,
  ResolutionItem,
  UpdateHighlightBody,
} from '@/lib/api/highlights';
import type { SummaryStatus, summaryApi } from '@/lib/api/summary';
import type { CreateThreadBody, FollowUpBody, threadsApi } from '@/lib/api/threads';
import type {
  Anchor,
  AnchorWire,
  Board,
  CanvasEdge,
  CanvasNode,
  Citation,
  ErrorCode,
  Highlight,
  JobSummary,
  LibraryPaper,
  Message,
  ResolutionWire,
  RunErrorCode,
  RunSummary,
  SseEvent,
  Summary,
  Thread,
} from '@/lib/api/types';
import type { UsageBucket, UsageTotals } from '@/lib/api/usage';

import boardsSchema from '../../../contracts/api/boards.schema.json';
import highlightsSchema from '../../../contracts/api/highlights.schema.json';
import papersSchema from '../../../contracts/api/papers.schema.json';
import sseSchema from '../../../contracts/api/sse.schema.json';
import summarySchema from '../../../contracts/api/summary.schema.json';
import threadsSchema from '../../../contracts/api/threads.schema.json';
import usageSchema from '../../../contracts/api/usage.schema.json';

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

// `satisfies` makes each object exactly its union: a missing or an extra key fails tsc.
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

// ─── every key and every enum (S0 review S3) ──────────────────────────────────────────────────

/** The exported schemas AS TYPES: TypeScript types a JSON import, keeping every property name. */
const SCHEMAS = {
  papers: papersSchema,
  highlights: highlightsSchema,
  threads: threadsSchema,
  sse: sseSchema,
  summary: summarySchema,
  usage: usageSchema,
  boards: boardsSchema,
};
type Schemas = typeof SCHEMAS;
/** The property names of `<group>.schema.json#/$defs/<model>`, at type level. */
type SchemaKeys<G extends keyof Schemas, M extends keyof Schemas[G]['$defs']> =
  Schemas[G]['$defs'][M] extends { properties: infer P } ? keyof P : never;
/** The keys `T` lets the sender leave out. */
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
/** Type equality (mutual assignability is not it: `string` and a union of strings pass one way). */
type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
/** An optional key's value as sent: the key is absent rather than `undefined`. */
type Sent<T> = Exclude<T, undefined>;
type SseData<E extends SseEvent['event']> = Extract<SseEvent, { event: E }>['data'];
type MessageErrorT = NonNullable<Message['error']>;
type SummaryRequest = NonNullable<Parameters<(typeof summaryApi)['generate']>[1]>;
type ThreadDetail = Awaited<ReturnType<(typeof threadsApi)['get']>>;
type NodeCreated = Awaited<ReturnType<(typeof boardsApi)['createNode']>>;

/**
 * `<group>.<model>` -> the keys its web type lets the sender leave out, for every §5 type and
 * feature-module request type. With the key sets pinned in tsc below, the test holds this to the
 * schema's `required`: a RESPONSE's optional keys are exactly the schema's (and the export marks
 * a defaulted field the server always sends as required), a REQUEST's optional keys are optional
 * in the schema too (the web may send more than the server requires, never less).
 */
const OPTIONAL = {
  'papers.JobSummary': [],
  'papers.LibraryPaper': [],
  'highlights.ResolutionWire': [],
  'highlights.AnchorWire': [],
  'highlights.Highlight': [],
  'threads.Citation': [],
  'threads.RunSummary': [],
  'threads.MessageError': [],
  'threads.Message': [],
  'threads.Thread': [],
  'threads.ThreadDetail': [],
  'sse.SseRun': [],
  'sse.SseStatus': ['label', 'attempt', 'delay_ms'],
  'sse.SseText': [],
  'sse.SseCitations': [],
  'sse.SseDone': [],
  'sse.MessageError': [],
  'summary.Summary': [],
  'summary.SummaryBullet': [],
  'summary.SummaryStatus': [],
  'boards.Board': [],
  'boards.Viewport': [],
  'boards.CanvasNode': [],
  'boards.CanvasEdge': [],
  'boards.BoardView': [],
  'boards.NodeCreated': [],
  'usage.UsageTotals': [],
  'usage.UsageBucket': [],
  'usage.UsageByKind': [],
  // requests
  'highlights.AnchorV1In': ['subTarget', 'resolution'],
  'highlights.HighlightCreate': ['note', 'resolutions'],
  'highlights.HighlightAnchorIn': [],
  'highlights.HighlightResolutionIn': ['reason'],
  'highlights.HighlightPatch': ['color', 'note'],
  'highlights.ResolutionsPut': [],
  'highlights.ResolutionPutItem': ['reason', 'upgraded_anchor'],
  'threads.ThreadCreate': ['anchor', 'question'],
  'threads.FollowUp': ['retry_of'],
  'summary.SummaryRequest': ['regenerate'],
  'boards.NodeCreate': ['title', 'body', 'source_anchor', 'source_message_id', 'group_id'],
  'boards.NodePatch': ['x', 'y', 'w', 'h', 'z', 'title', 'body', 'group_id'],
  'boards.EdgeCreate': ['label'],
  'boards.EdgePatch': ['kind', 'label'],
  'boards.BoardPatch': ['title', 'viewport'],
} as const;
type Shape = keyof typeof OPTIONAL;
type Opt<K extends Shape> = (typeof OPTIONAL)[K][number];
const REQUESTS = new Set<Shape>([
  'highlights.AnchorV1In',
  'highlights.HighlightCreate',
  'highlights.HighlightAnchorIn',
  'highlights.HighlightResolutionIn',
  'highlights.HighlightPatch',
  'highlights.ResolutionsPut',
  'highlights.ResolutionPutItem',
  'threads.ThreadCreate',
  'threads.FollowUp',
  'summary.SummaryRequest',
  'boards.NodeCreate',
  'boards.NodePatch',
  'boards.EdgeCreate',
  'boards.EdgePatch',
  'boards.BoardPatch',
]);

/**
 * In tsc, each web type has EXACTLY its model's keys (an optional key added on either side, or a
 * field the server gained, fails the type-check) and exactly the optional keys listed above.
 */
const KEYS_ARE_EXACT: true[] = [
  true satisfies Equal<keyof JobSummary, SchemaKeys<'papers', 'JobSummary'>>,
  true satisfies Equal<OptionalKeys<JobSummary>, Opt<'papers.JobSummary'>>,
  true satisfies Equal<keyof LibraryPaper, SchemaKeys<'papers', 'LibraryPaper'>>,
  true satisfies Equal<OptionalKeys<LibraryPaper>, Opt<'papers.LibraryPaper'>>,
  true satisfies Equal<keyof ResolutionWire, SchemaKeys<'highlights', 'ResolutionWire'>>,
  true satisfies Equal<OptionalKeys<ResolutionWire>, Opt<'highlights.ResolutionWire'>>,
  true satisfies Equal<keyof AnchorWire, SchemaKeys<'highlights', 'AnchorWire'>>,
  true satisfies Equal<OptionalKeys<AnchorWire>, Opt<'highlights.AnchorWire'>>,
  true satisfies Equal<keyof Highlight, SchemaKeys<'highlights', 'Highlight'>>,
  true satisfies Equal<OptionalKeys<Highlight>, Opt<'highlights.Highlight'>>,
  true satisfies Equal<keyof Citation, SchemaKeys<'threads', 'Citation'>>,
  true satisfies Equal<OptionalKeys<Citation>, Opt<'threads.Citation'>>,
  true satisfies Equal<keyof RunSummary, SchemaKeys<'threads', 'RunSummary'>>,
  true satisfies Equal<OptionalKeys<RunSummary>, Opt<'threads.RunSummary'>>,
  true satisfies Equal<keyof MessageErrorT, SchemaKeys<'threads', 'MessageError'>>,
  true satisfies Equal<OptionalKeys<MessageErrorT>, Opt<'threads.MessageError'>>,
  true satisfies Equal<keyof Message, SchemaKeys<'threads', 'Message'>>,
  true satisfies Equal<OptionalKeys<Message>, Opt<'threads.Message'>>,
  true satisfies Equal<keyof Thread, SchemaKeys<'threads', 'Thread'>>,
  true satisfies Equal<OptionalKeys<Thread>, Opt<'threads.Thread'>>,
  true satisfies Equal<keyof ThreadDetail, SchemaKeys<'threads', 'ThreadDetail'>>,
  true satisfies Equal<OptionalKeys<ThreadDetail>, Opt<'threads.ThreadDetail'>>,
  true satisfies Equal<keyof SseData<'run'>, SchemaKeys<'sse', 'SseRun'>>,
  true satisfies Equal<OptionalKeys<SseData<'run'>>, Opt<'sse.SseRun'>>,
  true satisfies Equal<keyof SseData<'status'>, SchemaKeys<'sse', 'SseStatus'>>,
  true satisfies Equal<OptionalKeys<SseData<'status'>>, Opt<'sse.SseStatus'>>,
  true satisfies Equal<keyof SseData<'text'>, SchemaKeys<'sse', 'SseText'>>,
  true satisfies Equal<OptionalKeys<SseData<'text'>>, Opt<'sse.SseText'>>,
  true satisfies Equal<keyof SseData<'citations'>, SchemaKeys<'sse', 'SseCitations'>>,
  true satisfies Equal<OptionalKeys<SseData<'citations'>>, Opt<'sse.SseCitations'>>,
  true satisfies Equal<keyof SseData<'usage'>, SchemaKeys<'sse', 'RunSummary'>>,
  true satisfies Equal<keyof SseData<'done'>, SchemaKeys<'sse', 'SseDone'>>,
  true satisfies Equal<OptionalKeys<SseData<'done'>>, Opt<'sse.SseDone'>>,
  true satisfies Equal<keyof NonNullable<SseData<'done'>['error']>, SchemaKeys<'sse', 'MessageError'>>,
  true satisfies Equal<OptionalKeys<NonNullable<SseData<'done'>['error']>>, Opt<'sse.MessageError'>>,
  true satisfies Equal<keyof Summary, SchemaKeys<'summary', 'Summary'>>,
  true satisfies Equal<OptionalKeys<Summary>, Opt<'summary.Summary'>>,
  true satisfies Equal<keyof Summary['bullets'][number], SchemaKeys<'summary', 'SummaryBullet'>>,
  true satisfies Equal<OptionalKeys<Summary['bullets'][number]>, Opt<'summary.SummaryBullet'>>,
  true satisfies Equal<keyof SummaryStatus, SchemaKeys<'summary', 'SummaryStatus'>>,
  true satisfies Equal<OptionalKeys<SummaryStatus>, Opt<'summary.SummaryStatus'>>,
  true satisfies Equal<keyof Board, SchemaKeys<'boards', 'Board'>>,
  true satisfies Equal<OptionalKeys<Board>, Opt<'boards.Board'>>,
  true satisfies Equal<keyof NonNullable<Board['viewport']>, SchemaKeys<'boards', 'Viewport'>>,
  true satisfies Equal<OptionalKeys<NonNullable<Board['viewport']>>, Opt<'boards.Viewport'>>,
  true satisfies Equal<keyof CanvasNode, SchemaKeys<'boards', 'CanvasNode'>>,
  true satisfies Equal<OptionalKeys<CanvasNode>, Opt<'boards.CanvasNode'>>,
  true satisfies Equal<keyof CanvasEdge, SchemaKeys<'boards', 'CanvasEdge'>>,
  true satisfies Equal<OptionalKeys<CanvasEdge>, Opt<'boards.CanvasEdge'>>,
  true satisfies Equal<keyof BoardView, SchemaKeys<'boards', 'BoardView'>>,
  true satisfies Equal<OptionalKeys<BoardView>, Opt<'boards.BoardView'>>,
  true satisfies Equal<keyof NodeCreated, SchemaKeys<'boards', 'NodeCreated'>>,
  true satisfies Equal<OptionalKeys<NodeCreated>, Opt<'boards.NodeCreated'>>,
  true satisfies Equal<keyof UsageTotals, SchemaKeys<'usage', 'UsageTotals'>>,
  true satisfies Equal<OptionalKeys<UsageTotals>, Opt<'usage.UsageTotals'>>,
  true satisfies Equal<keyof UsageBucket, SchemaKeys<'usage', 'UsageBucket'>>,
  true satisfies Equal<OptionalKeys<UsageBucket>, Opt<'usage.UsageBucket'>>,
  true satisfies Equal<keyof UsageTotals['by_kind'], SchemaKeys<'usage', 'UsageByKind'>>,
  true satisfies Equal<OptionalKeys<UsageTotals['by_kind']>, Opt<'usage.UsageByKind'>>,
  // requests
  true satisfies Equal<keyof Anchor, SchemaKeys<'highlights', 'AnchorV1In'>>,
  true satisfies Equal<OptionalKeys<Anchor>, Opt<'highlights.AnchorV1In'>>,
  true satisfies Equal<keyof CreateHighlightBody, SchemaKeys<'highlights', 'HighlightCreate'>>,
  true satisfies Equal<OptionalKeys<CreateHighlightBody>, Opt<'highlights.HighlightCreate'>>,
  true satisfies Equal<
    keyof CreateHighlightBody['anchors'][number],
    SchemaKeys<'highlights', 'HighlightAnchorIn'>
  >,
  true satisfies Equal<
    OptionalKeys<CreateHighlightBody['anchors'][number]>,
    Opt<'highlights.HighlightAnchorIn'>
  >,
  true satisfies Equal<keyof ResolutionIn, SchemaKeys<'highlights', 'HighlightResolutionIn'>>,
  true satisfies Equal<OptionalKeys<ResolutionIn>, Opt<'highlights.HighlightResolutionIn'>>,
  true satisfies Equal<keyof UpdateHighlightBody, SchemaKeys<'highlights', 'HighlightPatch'>>,
  true satisfies Equal<OptionalKeys<UpdateHighlightBody>, Opt<'highlights.HighlightPatch'>>,
  true satisfies Equal<keyof PutResolutionsBody, SchemaKeys<'highlights', 'ResolutionsPut'>>,
  true satisfies Equal<OptionalKeys<PutResolutionsBody>, Opt<'highlights.ResolutionsPut'>>,
  true satisfies Equal<keyof ResolutionItem, SchemaKeys<'highlights', 'ResolutionPutItem'>>,
  true satisfies Equal<OptionalKeys<ResolutionItem>, Opt<'highlights.ResolutionPutItem'>>,
  true satisfies Equal<keyof CreateThreadBody, SchemaKeys<'threads', 'ThreadCreate'>>,
  true satisfies Equal<OptionalKeys<CreateThreadBody>, Opt<'threads.ThreadCreate'>>,
  true satisfies Equal<keyof FollowUpBody, SchemaKeys<'threads', 'FollowUp'>>,
  true satisfies Equal<OptionalKeys<FollowUpBody>, Opt<'threads.FollowUp'>>,
  true satisfies Equal<keyof SummaryRequest, SchemaKeys<'summary', 'SummaryRequest'>>,
  true satisfies Equal<OptionalKeys<SummaryRequest>, Opt<'summary.SummaryRequest'>>,
  true satisfies Equal<keyof CreateNodeBody, SchemaKeys<'boards', 'NodeCreate'>>,
  true satisfies Equal<OptionalKeys<CreateNodeBody>, Opt<'boards.NodeCreate'>>,
  true satisfies Equal<keyof PatchNodeBody, SchemaKeys<'boards', 'NodePatch'>>,
  true satisfies Equal<OptionalKeys<PatchNodeBody>, Opt<'boards.NodePatch'>>,
  true satisfies Equal<keyof CreateEdgeBody, SchemaKeys<'boards', 'EdgeCreate'>>,
  true satisfies Equal<OptionalKeys<CreateEdgeBody>, Opt<'boards.EdgeCreate'>>,
  true satisfies Equal<keyof PatchEdgeBody, SchemaKeys<'boards', 'EdgePatch'>>,
  true satisfies Equal<OptionalKeys<PatchEdgeBody>, Opt<'boards.EdgePatch'>>,
  true satisfies Equal<keyof PatchBoardBody, SchemaKeys<'boards', 'BoardPatch'>>,
  true satisfies Equal<OptionalKeys<PatchBoardBody>, Opt<'boards.BoardPatch'>>,
];

/**
 * `<model>.<key>` -> every value the web's type allows (`null` included where it is nullable),
 * for EVERY enum-valued key of every model in `OPTIONAL`: the test fails on an enum key missing
 * here.
 * `ENUM_TYPES_ARE_EXACT` holds each list to its TypeScript type in tsc, so a widened key
 * (`color: string`) fails the type-check, and the test holds it to the schema's values.
 */
const ENUMS = {
  'JobSummary.kind': ['parse'],
  'JobSummary.state': ['pending', 'running', 'succeeded', 'dead_letter', 'cancelled'],
  'JobSummary.step': ['parse', 'persist', 'promote', null],
  'LibraryPaper.processing': ['queued', 'reading', 'ready', 'partial', 'failed'],
  'ResolutionWire.state': ['anchored', 'approximate', 'orphan'],
  'ResolutionWire.reason': [
    'block_id_missing',
    'block_text_changed',
    'quote_below_threshold',
    'quote_too_short_no_context',
    'no_geometric_overlap',
    'section_not_found',
    'page_out_of_range',
    'no_selectors',
    null,
  ],
  'Highlight.color': ['amber', 'green', 'blue', 'pink', 'purple'],
  'Message.role': ['user', 'assistant'],
  'Message.status': ['streaming', 'complete', 'partial', 'error', 'aborted'],
  'Thread.kind': ['explain', 'ask'],
  'SseStatus.phase': ['thinking', 'tool', 'retrying', 'writing'],
  'SseDone.status': ['complete', 'partial', 'error', 'aborted'],
  'Summary.status': ['complete', 'partial'],
  'SummaryStatus.state': ['none', 'running', 'ready', 'partial', 'failed'],
  'CanvasNode.kind': ['excerpt', 'explanation', 'note', 'group'],
  'CanvasEdge.kind': [
    'supports',
    'contradicts',
    'derives_from',
    'answers',
    'compares',
    'references',
    'relates',
  ],
  'AnchorV1In.anchorVersion': [1],
  'AnchorV1In.offsetUnit': ['unicode'],
  'AnchorV1In.targetKind': [
    'text',
    'guided_para',
    'equation',
    'equation_part',
    'figure',
    'figure_region',
    'table_row',
    'table_cell',
    'algorithm',
    'citation',
  ],
  'AnchorV1In.provenanceClass': ['source', 'ai_generated'],
} as const;
type Values<K extends keyof typeof ENUMS> = (typeof ENUMS)[K][number];
/** The enum keys whose values are not a list above: the two error-code unions (the ErrorCode and
 * RunErrorCode tests above), the request-side twins of the response enums (the same TS types),
 * and the one known widening. */
const ENUMS_ELSEWHERE: Record<string, string> = {
  'MessageError.code': 'CODES ∪ RUN_CODES',
  'JobSummary.error_code':
    'the web types it `string | null`, WIDER than the four §2.2 codes (api-report §3 item 6)',
  'HighlightCreate.color': 'Highlight.color',
  'HighlightPatch.color': 'Highlight.color',
  'HighlightResolutionIn.state': 'ResolutionWire.state',
  'HighlightResolutionIn.reason': 'ResolutionWire.reason',
  'ResolutionPutItem.state': 'ResolutionWire.state',
  'ResolutionPutItem.reason': 'ResolutionWire.reason',
  'ThreadCreate.kind': 'Thread.kind',
  'NodeCreate.kind': 'CanvasNode.kind',
  'EdgeCreate.kind': 'CanvasEdge.kind',
  'EdgePatch.kind': 'CanvasEdge.kind',
};
const ENUM_TYPES_ARE_EXACT: true[] = [
  true satisfies Equal<JobSummary['kind'], Values<'JobSummary.kind'>>,
  true satisfies Equal<JobSummary['state'], Values<'JobSummary.state'>>,
  true satisfies Equal<JobSummary['step'], Values<'JobSummary.step'>>,
  true satisfies Equal<LibraryPaper['processing'], Values<'LibraryPaper.processing'>>,
  true satisfies Equal<ResolutionWire['state'], Values<'ResolutionWire.state'>>,
  true satisfies Equal<ResolutionWire['reason'], Values<'ResolutionWire.reason'>>,
  true satisfies Equal<Highlight['color'], Values<'Highlight.color'>>,
  true satisfies Equal<Message['role'], Values<'Message.role'>>,
  true satisfies Equal<Message['status'], Values<'Message.status'>>,
  true satisfies Equal<MessageErrorT['code'], keyof typeof CODES | keyof typeof RUN_CODES>,
  true satisfies Equal<
    NonNullable<SseData<'done'>['error']>['code'],
    keyof typeof CODES | keyof typeof RUN_CODES
  >,
  true satisfies Equal<Thread['kind'], Values<'Thread.kind'>>,
  true satisfies Equal<SseData<'status'>['phase'], Values<'SseStatus.phase'>>,
  true satisfies Equal<SseData<'done'>['status'], Values<'SseDone.status'>>,
  true satisfies Equal<Summary['status'], Values<'Summary.status'>>,
  true satisfies Equal<SummaryStatus['state'], Values<'SummaryStatus.state'>>,
  true satisfies Equal<CanvasNode['kind'], Values<'CanvasNode.kind'>>,
  true satisfies Equal<CanvasEdge['kind'], Values<'CanvasEdge.kind'>>,
  true satisfies Equal<Anchor['anchorVersion'], Values<'AnchorV1In.anchorVersion'>>,
  true satisfies Equal<Anchor['offsetUnit'], Values<'AnchorV1In.offsetUnit'>>,
  true satisfies Equal<Anchor['targetKind'], Values<'AnchorV1In.targetKind'>>,
  true satisfies Equal<Anchor['provenanceClass'], Values<'AnchorV1In.provenanceClass'>>,
  // the request-side twins (ENUMS_ELSEWHERE): the same values as their response enums
  true satisfies Equal<CreateHighlightBody['color'], Highlight['color']>,
  true satisfies Equal<Sent<UpdateHighlightBody['color']>, Highlight['color']>,
  true satisfies Equal<ResolutionIn['state'], ResolutionWire['state']>,
  true satisfies Equal<Sent<ResolutionIn['reason']>, ResolutionWire['reason']>,
  true satisfies Equal<ResolutionItem['state'], ResolutionWire['state']>,
  true satisfies Equal<Sent<ResolutionItem['reason']>, ResolutionWire['reason']>,
  true satisfies Equal<CreateThreadBody['kind'], Thread['kind']>,
  true satisfies Equal<CreateNodeBody['kind'], CanvasNode['kind']>,
  true satisfies Equal<CreateEdgeBody['kind'], CanvasEdge['kind']>,
  true satisfies Equal<Sent<PatchEdgeBody['kind']>, CanvasEdge['kind']>,
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Def = { properties?: Record<string, Json>; required?: string[] };

function defOf(group: string, model: string): Def {
  const schema = load(`contracts/api/${group}.schema.json`) as { $defs: Record<string, Def> };
  const def = schema.$defs[model];
  if (def === undefined) throw new Error(`${group}.schema.json has no $defs.${model}`);
  return def;
}

/** A property's allowed values when it is an enum (`enum`, `const`, or an `anyOf` of them and
 * `null`); `undefined` when it is not. */
function enumValues(property: Json): (Json | null)[] | undefined {
  if (property === null || typeof property !== 'object' || Array.isArray(property)) return;
  if ('const' in property) return [property['const'] ?? null];
  const listed = property['enum'];
  if (Array.isArray(listed)) return listed;
  const branches = property['anyOf'];
  if (!Array.isArray(branches)) return;
  const values: (Json | null)[] = [];
  let found = false;
  for (const branch of branches) {
    const inner = enumValues(branch);
    if (inner !== undefined) {
      values.push(...inner);
      found = true;
    } else if (typeof branch === 'object' && branch !== null && !Array.isArray(branch)) {
      if (branch['type'] === 'null') values.push(null);
    }
  }
  return found ? values : undefined;
}

const sortedKeys = (values: readonly (Json | null)[]): string[] =>
  [...new Set(values.map((value) => JSON.stringify(value)))].sort();

/** What is wrong with `shape`'s presence against `def` (tsc has already pinned the key SETS). */
function shapeProblems(shape: Shape, def: Def): string[] {
  const optional = new Set<string>(OPTIONAL[shape]);
  const required = new Set(def.required ?? []);
  const keys = Object.keys(def.properties ?? {});
  const problems = [...optional]
    .filter((key) => !keys.includes(key))
    .map((key) => `${shape}.${key}: listed optional, not in the schema`);
  for (const key of keys) {
    const web = optional.has(key) ? 'optional' : 'required';
    const schema = required.has(key) ? 'required' : 'optional';
    const wrong = REQUESTS.has(shape) ? web === 'optional' && schema === 'required' : web !== schema;
    if (wrong) problems.push(`${shape}.${key}: web ${web}, schema ${schema}`);
  }
  return problems;
}

/** What is wrong with `model`'s enum-valued keys against `ENUMS`; each one met is added to `seen`. */
function enumProblems(model: string, def: Def, seen: Set<string>): string[] {
  const problems: string[] = [];
  const codes = [...Object.keys(CODES), ...Object.keys(RUN_CODES)];
  for (const [key, property] of Object.entries(def.properties ?? {})) {
    const values = enumValues(property);
    if (values === undefined) continue;
    const name = `${model}.${key}`;
    seen.add(name);
    const twin = ENUMS_ELSEWHERE[name];
    let listed: readonly (Json | null)[] | undefined;
    if (name === 'MessageError.code') listed = codes;
    else if (name in ENUMS) listed = ENUMS[name as keyof typeof ENUMS];
    else if (twin !== undefined && twin in ENUMS) listed = ENUMS[twin as keyof typeof ENUMS];
    else if (twin === undefined) {
      problems.push(`${name}: an enum with no list in ENUMS`);
      continue;
    }
    if (listed === undefined) continue; // a documented exemption (ENUMS_ELSEWHERE)
    const schema = JSON.stringify(sortedKeys(values).map((value) => JSON.parse(value) as Json));
    const web = JSON.stringify(sortedKeys(listed).map((value) => JSON.parse(value) as Json));
    if (schema !== web) problems.push(`${name}: schema ${schema}, web ${web}`);
  }
  return problems;
}

// ─── the tests ────────────────────────────────────────────────────────────────────────────────

describe('contracts.spec — lib/api/types.ts against contracts/api (exported from pydantic)', () => {
  it('ErrorCode is exactly errors.py’s enum, and the client knows every code', () => {
    const errors = load('contracts/api/errors.schema.json') as {
      $defs: { ErrorEnvelope: { properties: { code: { enum: string[] } } } };
    };
    const exported = errors.$defs.ErrorEnvelope.properties.code.enum;
    expect([...exported].sort()).toEqual(Object.keys(CODES).sort());
    for (const code of exported) expect(isErrorCode(code), code).toBe(true);
    expect(isErrorCode('email_in_use')).toBe(false);
  });

  it('RunErrorCode is exactly the agent contract’s', () => {
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

describe('contracts.spec — every key, its presence and every enum, against the schemas', () => {
  const shapes = Object.keys(OPTIONAL) as Shape[];
  const split = (shape: Shape): [string, string] => {
    const [group = '', model = ''] = shape.split('.');
    return [group, model];
  };

  it('every type’s optional keys are the schema’s (tsc pins the key sets themselves)', () => {
    expect(KEYS_ARE_EXACT.every(Boolean) && ENUM_TYPES_ARE_EXACT.every(Boolean)).toBe(true);
    for (const shape of shapes) expect(shapeProblems(shape, defOf(...split(shape)))).toEqual([]);
  });

  it('every enum-valued key is listed, with exactly the schema’s values', () => {
    const seen = new Set<string>();
    for (const shape of shapes) {
      const [group, model] = split(shape);
      expect(enumProblems(model, defOf(group, model), seen)).toEqual([]);
    }
    // Nothing listed is stale: every list names an enum key some model in OPTIONAL has.
    for (const name of [...Object.keys(ENUMS), ...Object.keys(ENUMS_ELSEWHERE)]) {
      expect(seen.has(name), `${name} is listed but no model in OPTIONAL has it`).toBe(true);
    }
  });

  it('the checks bite: a presence the schema contradicts, a value or an enum it adds', () => {
    const board = defOf('boards', 'Board');
    const loose = { ...board, required: (board.required ?? []).filter((k) => k !== 'title') };
    expect(shapeProblems('boards.Board', loose)).toEqual([
      'boards.Board.title: web required, schema optional',
    ]);
    const status = defOf('sse', 'SseStatus');
    expect(shapeProblems('sse.SseStatus', { ...status, required: ['phase', 'label'] })).toEqual([
      'sse.SseStatus.label: web optional, schema required',
    ]);
    const patch = defOf('highlights', 'HighlightPatch');
    expect(shapeProblems('highlights.HighlightPatch', { ...patch, required: ['color'] })).toEqual([
      'highlights.HighlightPatch.color: web optional, schema required',
    ]);
    // A request key the web always sends may be optional on the server: not a problem.
    const put = defOf('highlights', 'HighlightResolutionIn');
    expect(put.required).not.toContain('score');
    expect(shapeProblems('highlights.HighlightResolutionIn', put)).toEqual([]);

    const highlight = defOf('highlights', 'Highlight');
    const colour = { enum: ['amber', 'green', 'blue', 'pink', 'purple', 'red'], type: 'string' };
    const red = { ...highlight, properties: { ...highlight.properties, color: colour } };
    expect(enumProblems('Highlight', red, new Set())).toEqual([
      'Highlight.color: schema ["amber","blue","green","pink","purple","red"], web ["amber","blue","green","pink","purple"]',
    ]);
    const archived = { enum: ['yes', 'no'], type: 'string' };
    const extra = { ...board, properties: { ...board.properties, archived } };
    expect(enumProblems('Board', extra, new Set())).toEqual([
      'Board.archived: an enum with no list in ENUMS',
    ]);
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
    expectValid('internal-tools', 'ToolResult', { ...result, next_cursor: null });
    // The API always SENDS `next_cursor` (null when the tool does not page); §4's `next_cursor?`
    // is what the agent's side accepts.
    expectValid('internal', 'ToolResult', { ...result, next_cursor: null });
    expectInvalid('internal', 'ToolResult', result);
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
