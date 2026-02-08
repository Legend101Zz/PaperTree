export type HighlightCategory =
  | "key_finding"
  | "question"
  | "methodology"
  | "definition"
  | "important"
  | "review_later";

export const CATEGORY_COLORS: Record<HighlightCategory, string> = {
  key_finding: "#22c55e",
  question: "#f59e0b",
  methodology: "#3b82f6",
  definition: "#8b5cf6",
  important: "#ef4444",
  review_later: "#6b7280",
};

export const CATEGORY_LABELS: Record<HighlightCategory, string> = {
  key_finding: "🎯 Key Finding",
  question: "❓ Question",
  methodology: "🔬 Methodology",
  definition: "📖 Definition",
  important: "⭐ Important",
  review_later: "🔖 Review Later",
};

export interface HighlightPosition {
  page_number: number;
  rects: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  text_start: number;
  text_end: number;
}

export interface Highlight {
  id: string;
  user_id: string;
  book_id: string;
  text: string;
  position: HighlightPosition;
  category: HighlightCategory;
  color: string;
  note?: string;
  tags: string[];
  explanation_id?: string;
  canvas_node_id?: string;
  created_at: string;
  updated_at: string;
}

export interface HighlightExplanation {
  id: string;
  highlight_id: string;
  user_id: string;
  book_id: string;
  mode: string;
  prompt: string;
  response: string;
  model_name: string;
  model_metadata: {
    model: string;
    tokens_used: number;
    cost_estimate: number;
  };
  tokens_used: number;
  created_at: string;
}

export interface CreateHighlightInput {
  book_id: string;
  text: string;
  position: HighlightPosition;
  category?: HighlightCategory;
  note?: string;
  tags?: string[];
}

export interface UpdateHighlightInput {
  category?: HighlightCategory;
  note?: string;
  tags?: string[];
}

export type ExplanationMode =
  | "explain"
  | "summarize"
  | "critique"
  | "derive"
  | "define"
  | "diagram"
  | "related";
