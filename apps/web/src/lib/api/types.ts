/**
 * lib/api/types — the browser's mirror of the wire contract (contracts.md §5, fixed in S0).
 *
 * HAND-WRITTEN, and checked from the other side: `test/contracts.spec.ts` (wave 2 of S0) validates
 * these shapes with ajv against `contracts/api/*.schema.json`, which is exported from the API's
 * pydantic models. A field added here and not there fails that spec, and so does the reverse.
 *
 * CHANGE ONLY THROUGH A CONTRACTS PR. Every later slice imports from this file, so an edit inside a
 * feature PR silently changes the contract for every other slice (slice-plan.md §0).
 *
 * `Anchor` and `AnchorFailureReason` are RE-EXPORTED from `@papertree/anchoring`, never redeclared:
 * the persisted anchor is that package's record verbatim (contracts.md §6), and a second
 * declaration here is exactly the "two types competing for one job" the repo's anti-slop rule
 * forbids.
 *
 * `LibraryPaper`, `Highlight` and the AI/canvas types describe the server AFTER the slice that
 * implements each route lands (S1, S4, S5, S7). Until then the server answers 501 on the new routes,
 * and `GET /papers` still returns the pre-S1 row shape (`papers.ts::PaperListRow`).
 */
import type { Anchor, AnchorFailureReason } from '@papertree/anchoring';

export type { Anchor, AnchorFailureReason } from '@papertree/anchoring';

export type ErrorCode =
  | 'auth_required'
  | 'invalid_credentials'
  | 'email_taken'
  | 'not_found'
  | 'validation_failed'
  | 'empty_upload'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'not_parsed'
  | 'not_failed'
  | 'busy'
  | 'stale_version'
  | 'generation_not_found'
  | 'anchor_incomplete'
  | 'anchor_mismatch'
  | 'budget_exhausted'
  | 'agent_unavailable'
  | 'not_configured'
  | 'internal';

export type RunErrorCode =
  | 'provider_auth'
  | 'rate_limited'
  | 'quota'
  | 'upstream_unavailable'
  | 'timeout'
  | 'aborted'
  | 'bad_request'
  | 'tool_failed'
  | 'tool_budget_exhausted'
  | 'output_truncated'
  | 'agent_unavailable'
  | 'internal';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail: string,
    readonly retryable: boolean,
  ) {
    super(detail);
  }
}

export type Processing = 'queued' | 'reading' | 'ready' | 'partial' | 'failed';

export interface JobSummary {
  job_id: string;
  kind: 'parse';
  state: 'pending' | 'running' | 'succeeded' | 'dead_letter' | 'cancelled';
  step: 'parse' | 'persist' | 'promote' | null;
  done: number;
  total: number;
  attempt: number;
  max_attempts: number;
  error_code: string | null;
}

export interface LibraryPaper {
  paper_id: string;
  title: string;
  authors: string[];
  original_filename: string | null;
  source_hash: string;
  page_count: number | null;
  processing: Processing;
  job: JobSummary | null;
  generation: number | null;
  parser_version: string | null;
  highlight_count: number;
  created_at: string;
  updated_at: string;
}

export interface ResolutionWire {
  generation: number;
  tier: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  state: 'anchored' | 'approximate' | 'orphan';
  block_ids: string[];
  score: number | null;
  reason: AnchorFailureReason | null;
  resolver_version: string;
}

export interface AnchorWire {
  anchor_id: string;
  ordinal: number;
  anchor: Anchor;
  resolution: ResolutionWire | null;
}

export type HighlightColor = 'amber' | 'green' | 'blue' | 'pink' | 'purple';

export interface Highlight {
  highlight_id: string;
  color: HighlightColor;
  note: string | null;
  created_generation: number;
  created_at: string;
  updated_at: string;
  anchors: AnchorWire[];
}

export interface Citation {
  citation_id: string;
  ordinal: number;
  marker: string;
  page_index: number;
  anchor: Anchor;
  supported: boolean | null;
}

export interface RunSummary {
  run_id: string;
  model: string;
  provider: string;
  agent_sdk: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd_est: number | null;
  first_text_ms: number | null;
  latency_ms: number | null;
  retries: number;
  tool_calls: number;
}

export interface Message {
  message_id: string;
  thread_id: string;
  ordinal: number;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'complete' | 'partial' | 'error' | 'aborted';
  error: { code: RunErrorCode | ErrorCode; retryable: boolean; message: string } | null;
  generation: number;
  run: RunSummary | null;
  citations: Citation[];
  created_at: string;
  completed_at: string | null;
}

export interface Thread {
  thread_id: string;
  kind: 'explain' | 'ask';
  title: string;
  origin_anchor: Anchor | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export type SseEvent =
  | {
      event: 'run';
      data: {
        run_id: string;
        thread_id: string | null;
        user_message_id: string | null;
        message_id: string;
        generation: number;
      };
    }
  | {
      event: 'status';
      data: {
        phase: 'thinking' | 'tool' | 'retrying' | 'writing';
        label?: string;
        attempt?: number;
        delay_ms?: number;
      };
    }
  | { event: 'text'; data: { delta: string } }
  | { event: 'citations'; data: { items: Citation[] } }
  | { event: 'usage'; data: RunSummary }
  | {
      event: 'done';
      data: {
        status: 'complete' | 'partial' | 'error' | 'aborted';
        error: { code: RunErrorCode | ErrorCode; retryable: boolean; message: string } | null;
        message_id: string;
      };
    };

export interface Summary {
  generation: number;
  model: string;
  prompt_version: string;
  created_at: string;
  status: 'complete' | 'partial';
  bullets: { text: string; citations: Citation[]; supported: boolean }[];
}

export interface Board {
  board_id: string;
  paper_id: string;
  title: string;
  viewport: { x: number; y: number; zoom: number } | null;
  created_at: string;
  updated_at: string;
}

export interface CanvasNode {
  node_id: string;
  board_id: string;
  kind: 'excerpt' | 'explanation' | 'note' | 'group';
  group_id: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  title: string | null;
  body: string;
  source_anchor: Anchor | null;
  source_message_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type EdgeKind =
  | 'supports'
  | 'contradicts'
  | 'derives_from'
  | 'answers'
  | 'compares'
  | 'references'
  | 'relates';

export interface CanvasEdge {
  edge_id: string;
  board_id: string;
  from_node_id: string;
  to_node_id: string;
  kind: EdgeKind;
  label: string | null;
}
