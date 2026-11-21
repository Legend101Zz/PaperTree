/**
 * lib/api/boards — contracts.md §2.7 (canvas). Owned by S7 after S0.
 *
 * Rows, not a blob: one drag-end is one PATCH of one node. `GET /papers/{id}/board` NEVER writes; a
 * board is created by the first `createNode` (an explicit send). The server answers 501 until S7.
 */
import { request, streamSse } from './client';
import type {
  Anchor,
  AskLevel,
  AskUses,
  Board,
  BoardBranch,
  CanvasEdge,
  CanvasNode,
  EdgeKind,
  FromPort,
  ParentSpan,
  SseEvent,
  ToPort,
} from './types';

const seg = encodeURIComponent;

export interface BoardView {
  readonly board: Board | null;
  readonly nodes: CanvasNode[];
  readonly edges: CanvasEdge[];
}

export interface CreateNodeBody {
  /** Client-minted `cn_` + uuid: a repeat send is idempotent. */
  readonly node_id: string;
  readonly kind: CanvasNode['kind'];
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title?: string | null;
  readonly body?: string;
  /** Required for `excerpt`, and its `doc.paperId` must be this paper. */
  readonly source_anchor?: Anchor;
  /** Required for `explanation`; optional (a user message) for `question`. */
  readonly source_message_id?: string;
  /** Required for `notebook`. */
  readonly source_page_id?: string;
  /** Required for `diagram`. */
  readonly source_diagram_id?: string;
  readonly group_id?: string | null;
  /**
   * v0.3: the tree fields an Undo of a delete puts back (the ordinary create never sets them: asks
   * and notes go through `ask` and `keepNote`).
   */
  readonly parent_id?: string;
  readonly branch?: BoardBranch;
  readonly parent_span?: ParentSpan;
  readonly question?: string;
  readonly uses?: AskUses;
  readonly offset_x?: number;
  readonly offset_y?: number;
  readonly folded?: boolean;
}

export interface PatchNodeBody {
  /** The version the client last saw; a mismatch is 409 `stale_version`. */
  readonly version: number;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly z?: number;
  readonly title?: string | null;
  readonly body?: string;
  readonly group_id?: string | null;
  readonly source_page_id?: string;
  readonly source_diagram_id?: string;
  /** v0.3 (v03-BOARD-SPEC section 2): the drag offset on top of the Tidy layout, and the fold. */
  readonly offset_x?: number;
  readonly offset_y?: number;
  readonly folded?: boolean;
}

/** The three quick asks of the span menu (rule 8). */
export type QuickAskName = 'simpler' | 'example' | 'diagram';

/** The body of `POST /boards/{board_id}/nodes/{node_id}/asks` (`AskCreate`; v03-BOARD-SPEC section 3). */
export interface AskBody {
  /** Client-minted `cn_` id of the new answer card; a repeat send is idempotent. */
  readonly node_id?: string;
  /** 1..2000. The web always sends it (a quick ask sends its own words); the server takes it optional with `quick`. */
  readonly question: string;
  readonly span?: ParentSpan;
  readonly ask_differently?: boolean;
  readonly quick?: QuickAskName | null;
  readonly uses: AskUses;
  readonly level: AskLevel;
  /**
   * A retry or a re-level of this answer card (rule 6): a failed answer with no branches is
   * replaced in place, any other answer gets a `right` sibling.
   */
  readonly redo_of?: string;
}

/** The body of `POST /boards/{board_id}/nodes/{node_id}/notes` (`NoteCreate`): Keep as note, no AI. */
export interface KeepNoteBody {
  readonly node_id?: string;
  readonly span: ParentSpan;
  readonly text: string;
}

/** The body of `POST /boards/{board_id}/tidy` (`TidyRequest`). */
export interface TidyBody {
  readonly root_id: string;
}

/** The answer to a Tidy (`Tidied`): the cards it changed, with their new versions. */
export interface Tidied {
  readonly nodes: CanvasNode[];
}

export interface CreateEdgeBody {
  /** Client-minted `ce_` + uuid. */
  readonly edge_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly kind: EdgeKind;
  readonly label?: string | null;
  /** Both optional: a v0.1 link has no pins (keyboard links carry both since #213). */
  readonly from_port?: FromPort | null;
  readonly to_port?: ToPort | null;
}

export interface PatchEdgeBody {
  readonly kind?: EdgeKind;
  readonly label?: string | null;
  readonly from_port?: FromPort | null;
  readonly to_port?: ToPort | null;
}

export interface PatchBoardBody {
  readonly title?: string;
  readonly viewport?: Board['viewport'];
}

export const boardsApi = {
  get: (paperId: string) => request<BoardView>(`/papers/${seg(paperId)}/board`),
  /** 201. Creates the board in the same transaction on the first send. */
  createNode: (paperId: string, body: CreateNodeBody) =>
    request<{ board: Board; node: CanvasNode }>(`/papers/${seg(paperId)}/board/nodes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchNode: (boardId: string, nodeId: string, body: PatchNodeBody) =>
    request<CanvasNode>(`/boards/${seg(boardId)}/nodes/${seg(nodeId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteNode: (boardId: string, nodeId: string) =>
    request<void>(`/boards/${seg(boardId)}/nodes/${seg(nodeId)}`, { method: 'DELETE' }),
  createEdge: (boardId: string, body: CreateEdgeBody) =>
    request<CanvasEdge>(`/boards/${seg(boardId)}/edges`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchEdge: (boardId: string, edgeId: string, body: PatchEdgeBody) =>
    request<CanvasEdge>(`/boards/${seg(boardId)}/edges/${seg(edgeId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteEdge: (boardId: string, edgeId: string) =>
    request<void>(`/boards/${seg(boardId)}/edges/${seg(edgeId)}`, { method: 'DELETE' }),
  /**
   * A card asked from a card (v03-BOARD-SPEC section 3): SSE `node` first (the new answer card, with
   * its id, parent, branch, span and `source_message_id`), then the thread's `run`, `status`, `text`,
   * `citations`, `usage` and `done`. A refusal before the stream (409, 429, 503) throws from the
   * first `next()`, as on a thread.
   */
  ask: (
    boardId: string,
    nodeId: string,
    body: AskBody,
    signal?: AbortSignal,
  ): AsyncGenerator<SseEvent> =>
    streamSse(`/boards/${seg(boardId)}/nodes/${seg(nodeId)}/asks`, body, signal),
  /** Keep as note: a `note` child (branch `right`) on the words. No AI call. 201. */
  keepNote: (boardId: string, nodeId: string, body: KeepNoteBody) =>
    request<CanvasNode>(`/boards/${seg(boardId)}/nodes/${seg(nodeId)}/notes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /**
   * Tidy: every offset of the tree under `rootId` back to 0, versions bumped. The answer is the
   * cards it changed with their new versions, so the board needs no second read.
   */
  tidy: (boardId: string, rootId: string) =>
    request<Tidied>(`/boards/${seg(boardId)}/tidy`, {
      method: 'POST',
      body: JSON.stringify({ root_id: rootId } satisfies TidyBody),
    }),
  patchBoard: (boardId: string, body: PatchBoardBody) =>
    request<Board>(`/boards/${seg(boardId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
};
