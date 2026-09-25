/**
 * lib/api/boards — contracts.md §2.7 (canvas). Owned by S7 after S0.
 *
 * Rows, not a blob: one drag-end is one PATCH of one node. `GET /papers/{id}/board` NEVER writes; a
 * board is created by the first `createNode` (an explicit send). The server answers 501 until S7.
 */
import { request } from './client';
import type { Anchor, Board, CanvasEdge, CanvasNode, EdgeKind } from './types';

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
  /** Required for `explanation`. */
  readonly source_message_id?: string;
  readonly group_id?: string | null;
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
}

export interface CreateEdgeBody {
  /** Client-minted `ce_` + uuid. */
  readonly edge_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly kind: EdgeKind;
  readonly label?: string | null;
}

export interface PatchEdgeBody {
  readonly kind?: EdgeKind;
  readonly label?: string | null;
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
  patchBoard: (boardId: string, body: PatchBoardBody) =>
    request<Board>(`/boards/${seg(boardId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
};
