// User types
export interface User {
  id: string;
  email: string;
  created_at: string;
}

// Paper types
export interface OutlineItem {
  title: string;
  level: number;
  start_idx: number;
  end_idx: number;
}

export interface Paper {
  id: string;
  user_id: string;
  title: string;
  filename: string;
  created_at: string;
  page_count?: number;
  extracted_text?: string;
  outline?: OutlineItem[];
}

// Highlight types
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  section_path: string[];
}

export interface Highlight {
  id: string;
  paper_id: string;
  user_id: string;
  mode: "pdf" | "book";
  selected_text: string;
  page_number?: number;
  rects?: Rect[];
  anchor?: TextAnchor;
  created_at: string;
}

// Explanation types
export interface Explanation {
  id: string;
  paper_id: string;
  highlight_id: string;
  user_id: string;
  parent_id?: string;
  question: string;
  answer_markdown: string;
  model: string;
  created_at: string;
  is_pinned: boolean;
  is_resolved: boolean;
  children?: Explanation[];
}

// Canvas types
export interface CanvasNode {
  id: string;
  type: "paper" | "highlight" | "explanation";
  position: { x: number; y: number };
  data: {
    label: string;
    content?: string;
    highlightId?: string;
    explanationId?: string;
  };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface Canvas {
  id: string;
  paper_id: string;
  user_id: string;
  elements: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  };
  updated_at: string;
}

// Reader settings
export interface ReaderSettings {
  theme: "light" | "dark" | "sepia";
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  mode: "pdf" | "book";
}

// Search result
export interface SearchResult {
  text: string;
  start_idx: number;
  end_idx: number;
  context_before: string;
  context_after: string;
}
