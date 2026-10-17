/**
 * s5c-notebook-fixtures — a dived notebook page as the API returns it, and a fetch stub that plays
 * the notebook, thread and paper routes (#208). The words, handles, locators and usage are the
 * stored demo answer on "Attention Is All You Need" (thr_01M508X9PC9K9HKHSVB2J9W1A1); the Anchors
 * are trimmed to the selectors the page reads. The page was seeded by the real Dive in route.
 */
import { vi } from 'vitest';

import { API_BASE_URL } from '@/lib/api/client';
import type { NotebookItemWire, NotebookPageView } from '@/features/notebook/api/notebookApi';
import type { Citation, Message } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

export const PAPER = 'ppr_G9AYN750E5MG1NRBMGSQJ4N5JM';
export const PAGE = 'np_demo00001';
export const THREAD = 'thr_01M508X9PC9K9HKHSVB2J9W1A1';
export const ANSWER = 'msg_01M508X9PCVH6CHJJDJEGDTC7V';
const T = '2026-10-15T17:14:13.068Z';

export function anchor(id: string, block: string, page: number, exact: string): Anchor {
  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id,
    doc: { paperId: PAPER, pdfSha256: 'sha256:x', parserVersion: '1.0.0', textStreamId: 't' },
    targetKind: 'text',
    provenanceClass: 'source',
    selectors: [
      { type: 'BlockSelector', blockId: block, blockTextHash: 'sha256:y' },
      { type: 'PageSelector', index: page },
      { type: 'TextQuoteSelector', exact, prefix: '', suffix: '', exactNormalised: exact },
    ],
    created: { mode: 'source', at: T, client: 'test' },
  } as Anchor;
}

const PASSAGES = [
  [
    'b1',
    'cit_01M508XDXJZ53PJB6PCJRHGGHQ',
    'blk_tutvxcaxihp3krt6',
    0,
    1,
    'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
  ],
  [
    'b6',
    'cit_01M508XDXK03NKVPV114QJ4S18',
    'blk_p5c47m5apz2jj3x4',
    1,
    2,
    'Recurrent models typically factor computation along the symbol positions.',
  ],
  [
    'b7',
    'cit_01M508XDXM3C5GPT2QQ5M6B7C1',
    'blk_poxmdnipnwgirpwh',
    1,
    3,
    'Attention mechanisms have become an integral part of compelling sequence modeling.',
  ],
  [
    'b8',
    'cit_01M508XDXN01143W5T8WRE920F',
    'blk_jyinmieamvqrzmap',
    1,
    4,
    'In this work we propose the Transformer, a model architecture eschewing recurrence.',
  ],
] as const;

export const CITATIONS: Citation[] = PASSAGES.map(
  ([marker, id, block, page, para, exact], ordinal) => ({
    citation_id: `c_${marker}`,
    ordinal,
    marker,
    page_index: page,
    anchor: anchor(id, block, page, exact),
    supported: true,
    locator: {
      passage_key: `g1:${block}`,
      page_index: page,
      para_index: para,
      section_heading: null,
    },
  }),
);

export const CONTENT = [
  "The passage states the paper's central proposal: a new, simple network architecture called the Transformer, built only from attention mechanisms, with recurrence and convolutions removed entirely [b1].",
  'The motivation is that the best models connect encoder to decoder through attention [b1]. This inherently sequential nature prevents parallelization within a training example [b6]. And attention, which models dependencies regardless of their distance in the sequence [b7], was used together with a recurrent network [b7].',
  'So the move is to make attention the whole model rather than an add-on [b8]. The Introduction makes the same point [b8].',
  'Why it matters: 28.4 BLEU on WMT 2014 English-to-German [b1], new single-model state of the art [b1]; twelve hours on eight P100 GPUs [b8]. It generalizes to parsing [b1].',
  "This is my reading, not the paper's claim: the passages given here do not describe how position is handled.",
].join('\n\n');

export const ORIGIN = anchor(
  '57e2bb26-0af6-47bf-876d-5a3142893105',
  'blk_tutvxcaxihp3krt6',
  0,
  'We propose a new simple network architecture, the Transformer.',
);

const USER: Message = {
  message_id: 'msg_01M508X9PC3B0BNHTBV7TEH25V',
  thread_id: THREAD,
  ordinal: 0,
  role: 'user',
  content: 'Explain this passage.',
  status: 'complete',
  error: null,
  generation: 1,
  run: null,
  citations: [],
  created_at: T,
  completed_at: T,
};

export const ANSWER_MESSAGE: Message = {
  ...USER,
  message_id: ANSWER,
  ordinal: 1,
  role: 'assistant',
  content: CONTENT,
  citations: CITATIONS,
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
    input_tokens: 6000,
    output_tokens: 776,
    cache_read_tokens: null,
    reasoning_tokens: null,
    cost_usd_est: 0.0027,
    first_text_ms: null,
    latency_ms: null,
    retries: 0,
    tool_calls: 0,
  },
};

function item(
  id: string,
  kind: NotebookItemWire['kind'],
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  body: string,
  a: Anchor | null = null,
): NotebookItemWire {
  return {
    item_id: id,
    page_id: PAGE,
    kind,
    x,
    y,
    w,
    h,
    z,
    body,
    anchor: a,
    version: 1,
    created_at: T,
    updated_at: T,
  };
}

const EXCHANGE_BODY = JSON.stringify({
  call: { text: 'Explain this passage.', origin_anchor: ORIGIN },
  ai: { message_id: ANSWER, model: 'MiniMax-M3.1-Flash-Preview', content: CONTENT },
});

export function pageView(extra: NotebookItemWire[] = []): NotebookPageView {
  return {
    page: {
      page_id: PAGE,
      paper_id: PAPER,
      title: 'Dive in: the Transformer’s central proposal',
      template: 'dot',
      source_thread_id: THREAD,
      source_message_id: ANSWER,
      version: 1,
      created_at: T,
      updated_at: T,
    },
    items: [
      item('ni_exchange01', 'exchange', 48, 48, 864, 320, 0, EXCHANGE_BODY),
      ...CITATIONS.map((c, i) =>
        item(
          `ni_quote000${String(i + 1)}`,
          'quote',
          48 + (i % 3) * 296,
          392 + Math.floor(i / 3) * 164,
          272,
          140,
          i + 1,
          c.anchor.selectors[2]?.type === 'TextQuoteSelector' ? c.anchor.selectors[2].exact : '',
          c.anchor,
        ),
      ),
      ...extra,
    ],
    strokes: [],
  };
}

export { item as wireItem };

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
  /** Whether the request asked to outlive the page. */
  readonly keepalive: boolean;
}

/**
 * Stubs `fetch` with the routes the notebook page calls. Item writes echo back with the version
 * bumped; `onWrite` may answer instead (a 409, say), or hold the request (a promise) to keep it in
 * flight; `boardFails` makes the board unreadable.
 */
export function stubApi(
  view: NotebookPageView,
  onWrite?: (call: Call) => Response | null | Promise<Response | null>,
  options: { readonly boardFails?: boolean } = {},
): Call[] {
  const calls: Call[] = [];
  const server = new Map(view.items.map((i) => [i.item_id, i]));
  let page = view.page;
  let board: { board: unknown; nodes: Record<string, unknown>[]; edges: unknown[] } = {
    board: null,
    nodes: [],
    edges: [],
  };
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.slice(API_BASE_URL.length);
      const method = init.method ?? 'GET';
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call = { method, path, body, keepalive: init.keepalive === true };
      calls.push(call);
      if (method === 'GET' && path === `/notebook/pages/${PAGE}`) return json(200, view);
      if (method === 'GET' && path === `/papers/${PAPER}/threads/${THREAD}`) {
        return json(200, { thread: {}, messages: [USER, ANSWER_MESSAGE] });
      }
      if (method === 'GET' && path === '/papers') {
        return json(200, [{ paper_id: PAPER, title: 'Attention Is All You Need' }]);
      }
      const on = (kind: string) => [...server.values()].filter((i) => i.kind === kind).length;
      const counts = {
        quotes: on('quote'),
        stickies: on('sticky'),
        text: on('text'),
        shapes: on('shape'),
        strokes: view.strokes.length,
      };
      if (method === 'GET' && path === `/papers/${PAPER}/notebook/pages`) {
        return json(200, [
          {
            page_id: PAGE,
            title: view.page.title,
            template: page.template,
            counts,
            version: page.version,
            updated_at: T,
          },
        ]);
      }
      if (method === 'GET' && path === `/papers/${PAPER}/board`) {
        if (options.boardFails === true) return json(500, { detail: 'down', code: 'internal' });
        // A notebook card's counts are computed on read, from the page as it is now (S6a).
        return json(200, { ...board, nodes: board.nodes.map((n) => ({ ...n, counts })) });
      }
      if (method === 'GET' && path.startsWith(`/papers/${PAPER}/notebook/search?`)) {
        const q = new URLSearchParams(path.split('?')[1]).get('q') ?? '';
        const hits = [...server.values()].filter((i) => i.body.includes(q));
        return json(
          200,
          hits.map((i) => ({
            page_id: PAGE,
            page_title: view.page.title,
            item_id: i.item_id,
            kind: i.kind,
            snippet: i.body,
          })),
        );
      }
      if (method === 'GET') return json(200, {});
      const answered = (await onWrite?.(call)) ?? null;
      if (answered !== null) return answered;
      if (method === 'PATCH' && path === `/notebook/pages/${PAGE}`) {
        page = { ...page, ...(body as object), version: page.version + 1 };
        return json(200, page);
      }
      if (method === 'POST' && path === `/papers/${PAPER}/board/nodes`) {
        // Idempotent on node_id, as the server is: a retried or second send gets the stored card.
        const stored = board.nodes.find((n) => n['node_id'] === body?.['node_id']);
        if (stored !== undefined) return json(201, { board: { board_id: 'brd_1' }, node: stored });
        const node = { ...body, board_id: 'brd_1', counts, version: 1 };
        board = { ...board, nodes: [...board.nodes, node] };
        return json(201, { board: { board_id: 'brd_1' }, node });
      }
      const id = String(body?.['item_id'] ?? path.split('?')[0]?.split('/').at(-1));
      if (method === 'DELETE') {
        server.delete(id);
        return new Response(null, { status: 204 });
      }
      const before = server.get(id) ?? item(id, 'text', 0, 0, 1, 1, 0, '');
      const { version: _seen, ...fields } = body ?? {};
      const after = {
        ...before,
        ...fields,
        version: method === 'POST' ? 1 : before.version + 1,
      } as NotebookItemWire;
      server.set(id, after);
      return json(method === 'POST' ? 201 : 200, after);
    }),
  );
  return calls;
}
