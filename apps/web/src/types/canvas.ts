// apps/web/src/types/canvas.ts
/**
 * Canvas types — Maxly-style exploration canvas.
 */

export type CanvasNodeType =
  | "paper"
  | "page_super"
  | "exploration"
  | "ai_response"
  | "note"
  | "diagram";

export type ContentType =
  | "plain"
  | "markdown"
  | "latex"
  | "mermaid"
  | "code"
  | "mixed";

export type AskMode =
  | "explain_simply"
  | "explain_math"
  | "derive_steps"
  | "intuition"
  | "pseudocode"
  | "diagram"
  | "custom";

export type NodeStatus = "idle" | "loading" | "error" | "complete";

export interface CanvasNodePosition {
  x: number;
  y: number;
}

export interface CanvasNodeData {
  label: string;
  content?: string;
  content_type: ContentType;
  // Page super
  page_number?: number;
  page_summary?: string;
  // Exploration
  selected_text?: string;
  highlight_id?: string;
  explanation_id?: string;
  // AI
  question?: string;
  ask_mode?: AskMode;
  model?: string;
  model_name?: string;
  tokens_used?: number;
  // Source
  source_page?: number;
  source_highlight_id?: string;
  // UI
  is_collapsed: boolean;
  status: NodeStatus;
  tags?: string[];
  color?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  position: CanvasNodePosition;
  data: CanvasNodeData;
  parent_id?: string;
  children_ids?: string[];
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  edge_type?: "default" | "branch" | "followup" | "note";
}

export interface CanvasElements {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface Canvas {
  id: string;
  paper_id: string;
  user_id: string;
  elements: CanvasElements;
  updated_at: string;
}

// API request/response types
export interface ExploreRequest {
  highlight_id: string;
  question: string;
  ask_mode: AskMode;
  page_number: number;
}

export interface AskFollowupRequest {
  parent_node_id: string;
  question: string;
  ask_mode: AskMode;
}

export interface AddNoteRequest {
  content: string;
  parent_node_id?: string;
  position?: CanvasNodePosition;
}

export interface ExploreResponse {
  canvas_id: string;
  exploration_node: CanvasNode;
  ai_node: CanvasNode;
  page_node?: CanvasNode;
  new_edges: CanvasEdge[];
}
