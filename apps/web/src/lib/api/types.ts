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
  // #193: a topic name the person already uses (409).
  | 'topic_exists'
  | 'anchor_incomplete'
  | 'anchor_mismatch'
  | 'budget_exhausted'
  | 'agent_unavailable'
  | 'not_configured'
  | 'internal'
  // S0b contract addition: the 501 every not-yet-built route answers with (services/api errors.py).
  | 'not_implemented';

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

/** The reading mode the reader saves with a place (`PUT /papers/{id}/reading-state`). */
export type ReadingMode = 'source' | 'guided' | 'split';

/** `GET /auth/me` and `PATCH /auth/me`. `display_name` is null until the person sets one. */
export interface Me {
  user_id: string;
  email: string;
  display_name: string | null;
}

/** The caller's place in a paper (#192); pages are zero-based. */
export interface ReadingProgress {
  last_page: number;
  furthest_page: number;
  page_count: number | null;
  opened_at: string;
  finished_at: string | null;
  state: 'reading' | 'finished';
}

/** The topic the caller ACCEPTED for a paper (#193); an unaccepted offer is not here. */
interface LibraryTopic {
  topic_id: string;
  name: string;
  cloth: 'transformers' | 'vision' | 'generative' | 'optimization' | 'language' | 'rl' | null;
  source: 'arxiv_category' | 'manual' | 'model';
  /** `cs.CL` for `arxiv_category`, the model id for `model`, else null. */
  source_detail: string | null;
}

/**
 * The figure the caller chose as a paper's cover (#200), as it is in the promoted parse. The
 * choice itself is stored as an Anchor; `block_id` only says which figure of `…/figures` it is.
 */
export interface LibraryPlate {
  block_id: string;
  page_index: number;
  /** "Figure 1", read from the start of its caption; null when the parser attached none. */
  label: string | null;
  /** The caption as the paper has it, or null. */
  caption_text: string | null;
  /** The crop, signed for about an hour (one URL per ten minutes, so polling keeps it). */
  asset_url: string;
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
  /** v0.2 (#192): the caller's place, or null when they have not started it. */
  reading: ReadingProgress | null;
  /** Year first published (arXiv id, else parser), or null. */
  year: number | null;
  arxiv_id: string | null;
  /** Primary category from the arXiv stamp (`cs.CL`), or null. */
  arxiv_category: string | null;
  thread_count: number;
  has_summary: boolean;
  /** v0.2 (#193): the accepted topic, or null (unshelved, or only offered). */
  topic: LibraryTopic | null;
  /** v0.2 (#200): the caller's notebook pages on this paper. */
  notebook_count: number;
  /** v0.2 (#200): the chosen cover figure, or null for the typographic cover. */
  plate: LibraryPlate | null;
}

/** The bibliography entry behind a library link; `index` is zero-based. */
export interface LibraryReference {
  index: number;
  text: string;
}

/**
 * One real link between two of the caller's papers (`GET /library/links`, #194). Citation links
 * only: `via` gains `'board'` when a board can hold a second paper. Word the label from
 * `matched_by` ("cites it (matched by title)"), never assume it. At most one link per
 * (from, to): `arxiv_id` when any entry matched it, else `title`.
 */
export interface LibraryLink {
  from_paper_id: string;
  to_paper_id: string;
  via: 'citation';
  matched_by: 'arxiv_id' | 'title';
  reference: LibraryReference;
}

/** `GET /library/links`. */
export interface LibraryLinks {
  links: LibraryLink[];
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

/** Where a cited passage sits, derived on read from the parse (never stored; #201). */
export interface PassageLocator {
  /** `g{generation}:{block_id}`: equal keys are the same passage within one answer. */
  passage_key: string;
  page_index: number;
  /** 1-based among the page's body paragraphs; null shows the page only. */
  para_index: number | null;
  section_heading: string | null;
}

export interface Citation {
  citation_id: string;
  ordinal: number;
  marker: string;
  page_index: number;
  anchor: Anchor;
  supported: boolean | null;
  /** On a stored answer read back; absent on the live SSE `citations` event. */
  locator?: PassageLocator;
}

/** How much of an assistant answer is cited (#201). */
export interface MessageCoverage {
  passages: number;
  /** Marker handle occurrences that have a stored citation (`[b1, b8]` counts 2). */
  citations: number;
  /** Occurrences whose handle has no stored citation; never counted in `citations`. */
  unresolved_markers: number;
  paragraphs: number;
  /** 0-based indexes into the list `exchanges.answer_paragraphs` builds (blank-line split, bare
   * Markdown heading lines dropped) of the paragraphs with no marker. */
  uncited_paragraphs: number[];
  /** Stored citations with `supported === false`; an unchecked one (null) is not counted. */
  not_verified: number;
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

/** Where a diagram part's quote was found (v0.2 S7a, #216); `anchor` null: found nowhere. */
export interface DiagramCite {
  citation_id: string | null;
  /** The quote as the model wrote it. */
  quote: string;
  anchor: Anchor | null;
  locator: PassageLocator | null;
  page_index: number | null;
  /** true: verbatim ("cited"); false: with differences or not found ("not verified"). */
  supported: boolean;
}

/** One lettered part of a diagram answer; `cite` null is "inferred, no passage". */
export interface DiagramPart {
  letter: string;
  label: string;
  text: string;
  kind: 'input' | 'step' | 'output' | 'concept';
  /** Earlier letters with an edge into this part. */
  after: string[];
  /** One label (or null) per `after` entry. */
  edge: (string | null)[];
  cite: DiagramCite | null;
}

/** An edge `after` cannot say (a feedback edge). */
export interface DiagramLink {
  source: string;
  target: string;
  label: string | null;
}

/** A diagram thread's answer as a plate; `stopped` is the reader's Stop. */
export interface MessageDiagram {
  title: string | null;
  status: 'streaming' | 'complete' | 'partial' | 'stopped' | 'error';
  parts: DiagramPart[];
  links: DiagramLink[];
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
  /** Only on an assistant message that is `complete` or `partial` (and not a diagram). */
  coverage?: MessageCoverage;
  /** Only on an assistant message of a `diagram` thread. */
  diagram?: MessageDiagram;
  created_at: string;
  completed_at: string | null;
}

export interface Thread {
  thread_id: string;
  kind: 'explain' | 'ask' | 'diagram';
  title: string;
  origin_anchor: Anchor | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  /** The first user message, cut to 160 characters on a word boundary. */
  ask: string;
  /** Status of the thread's last assistant message, null when there is none. */
  last_status: Message['status'] | null;
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
  // A diagram run (v0.2 S7a/S7b): its title, then each part with its quote already resolved, and
  // the feedback edges `after` cannot say. No `text` and no `citations` come on such a run.
  | { event: 'plate'; data: { title: string } }
  | { event: 'part'; data: DiagramPart }
  | { event: 'link'; data: DiagramLink }
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
  /** `group` is the design's "frame". */
  kind: CanvasNodeKind;
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
  /** Notebook card: the notebook page it shows. */
  source_page_id: string | null;
  /** Diagram card: the diagram it shows. */
  source_diagram_id: string | null;
  /** A notebook card's page counts, computed on read; null on every other kind. */
  counts: NotebookCardCounts | null;
  version: number;
  created_at: string;
  updated_at: string;
}

type CanvasNodeKind =
  'excerpt' | 'explanation' | 'note' | 'group' | 'question' | 'notebook' | 'diagram';

interface NotebookCardCounts {
  quotes: number;
  stickies: number;
  text: number;
  shapes: number;
  strokes: number;
}

/** The typed pins (DESIGN.md section 5): brass out-pins and open in-pins. */
export type FromPort = 'claim_out' | 'answer_out';
export type ToPort = 'evidence_in' | 'question_in';

export type EdgeKind =
  'supports' | 'contradicts' | 'derives_from' | 'answers' | 'compares' | 'references' | 'relates';

export interface CanvasEdge {
  edge_id: string;
  board_id: string;
  from_node_id: string;
  to_node_id: string;
  kind: EdgeKind;
  label: string | null;
  /** The pins the thread was drawn between; null on every v0.1 edge. */
  from_port: FromPort | null;
  to_port: ToPort | null;
  created_at: string;
}
