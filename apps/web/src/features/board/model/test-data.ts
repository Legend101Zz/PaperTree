/**
 * board/model/test-data — wire rows for the board's tests, cut from the stored Attention thread
 * (`thr_01M508X9PC9K9HKHSVB2J9W1A1` on the demo account): its two asks, its two answers' handles,
 * locators, coverage and runs as the API returned them on 2026-10-16. Test-only.
 */
import type { CanvasNode, Citation, Message } from '@/lib/api/types';

const anchor = (page: number) =>
  ({
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id: `a-${String(page)}`,
    doc: { paperId: 'ppr_1', pdfSha256: 'sha256:x', parserVersion: '1.0.0', textStreamId: 't' },
    targetKind: 'text',
    provenanceClass: 'source',
    selectors: [{ type: 'PageSelector', index: page }],
    created: { mode: 'source', at: '', client: 'test' },
  }) as unknown as Citation['anchor'];

/**
 * A stored citation of a passage, as a thread read returns it.
 *
 * @param marker The model's handle, e.g. `b6`.
 * @param page 0-based page.
 * @param para 1-based paragraph on the page.
 * @param ordinal Its order in the answer.
 * @returns The citation.
 */
export function citation(marker: string, page: number, para: number, ordinal = 0): Citation {
  return {
    citation_id: `cit_${marker}_${String(ordinal)}`,
    ordinal,
    marker,
    page_index: page,
    anchor: anchor(page),
    supported: true,
    locator: {
      passage_key: `g1:blk_${marker}`,
      page_index: page,
      para_index: para,
      section_heading: page === 0 ? 'Abstract' : 'Introduction',
    },
  };
}

const message = (fields: Partial<Message> & Pick<Message, 'message_id' | 'role'>): Message => ({
  thread_id: 'thr_1',
  ordinal: 0,
  content: '',
  status: 'complete',
  error: null,
  generation: 1,
  run: null,
  citations: [],
  created_at: '',
  completed_at: null,
  ...fields,
});

/** The thread: ask 1, answer 1 (b1 b1 b6 b7 b7 b8 …), ask 2, answer 2 (b6 … b1 … b8). */
export const THREAD: readonly Message[] = [
  message({ message_id: 'msg_u1', role: 'user', ordinal: 0, content: 'Explain this passage.' }),
  message({
    message_id: 'msg_a1',
    role: 'assistant',
    ordinal: 1,
    content:
      'The Transformer drops recurrence [b1].\n\nRecurrence is sequential [b6]; attention was used with it [b7] and now alone [b8].',
    citations: [
      citation('b1', 0, 1, 0),
      citation('b6', 1, 2, 1),
      citation('b7', 1, 3, 2),
      citation('b8', 1, 4, 3),
    ],
    coverage: {
      passages: 4,
      citations: 11,
      unresolved_markers: 0,
      paragraphs: 5,
      uncited_paragraphs: [4],
      not_verified: 0,
    },
    run: {
      run_id: 'run_1',
      model: 'MiniMax-M3.1-Flash-Preview',
      provider: 'minimax',
      agent_sdk: 'pi',
      input_tokens: 6286,
      output_tokens: 490,
      cache_read_tokens: null,
      reasoning_tokens: null,
      cost_usd_est: 0.00270918,
      first_text_ms: null,
      latency_ms: null,
      retries: 0,
      tool_calls: 0,
    },
  }),
  message({
    message_id: 'msg_u2',
    role: 'user',
    ordinal: 2,
    content: 'Why does dropping recurrence make training faster?',
  }),
  message({
    message_id: 'msg_a2',
    role: 'assistant',
    ordinal: 3,
    content: "The paper's reason is about sequencing [b6]. It still cites the abstract [b1].",
    citations: [citation('b6', 1, 2, 0), citation('b1', 0, 1, 1)],
    coverage: {
      passages: 3,
      citations: 9,
      unresolved_markers: 0,
      paragraphs: 5,
      uncited_paragraphs: [],
      not_verified: 0,
    },
    run: null,
  }),
];

/**
 * A board row of `kind` with everything else empty.
 *
 * @param kind The card kind.
 * @param fields What to set.
 * @returns The row.
 */
export function cardRow(kind: CanvasNode['kind'], fields: Partial<CanvasNode> = {}): CanvasNode {
  return {
    node_id: `cn_${kind}`,
    board_id: 'brd_1',
    kind,
    group_id: null,
    x: 0,
    y: 0,
    w: 260,
    h: 180,
    z: 0,
    title: null,
    body: '',
    source_anchor: null,
    source_message_id: null,
    source_page_id: null,
    source_diagram_id: null,
    counts: null,
    version: 1,
    created_at: '',
    updated_at: '',
    ...fields,
  };
}
