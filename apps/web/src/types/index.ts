// ============ USER TYPES ============
export interface User {
  id: string;
  email: string;
  created_at: string;
}

// ============ PDF/CONTENT TYPES ============
export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SourceLocation {
  page: number;
  bbox?: BoundingBox;
  char_start?: number;
  char_end?: number;
}

export interface PDFRegion {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

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

// ============ PAGE SUMMARY (NEW) ============
export interface PageSummary {
  page: number; // 0-indexed
  title: string;
  summary: string; // Markdown content
  key_concepts: string[];
  has_math: boolean;
  has_figures: boolean;
  generated_at: string;
  model: string;
  error?: boolean;
}

export interface PageSummaryStatus {
  total_pages: number;
  generated_pages: number[]; // 0-indexed
  default_limit: number;
}

// ============ CONTENT BLOCKS ============
export interface BaseBlock {
  id: string;
  type: string;
  source: SourceLocation;
}

export interface HeadingBlock extends BaseBlock {
  type: "heading";
  level: number;
  content: string;
}

export interface TextBlock extends BaseBlock {
  type: "text";
  content: string;
}

export interface MathBlock extends BaseBlock {
  type: "math";
  latex?: string;
  image_id?: string;
  alt_text: string;
  display: boolean;
}

export interface FigureBlock extends BaseBlock {
  type: "figure";
  image_id: string;
  caption?: string;
  figure_number?: string;
}

export interface ListBlock extends BaseBlock {
  type: "list";
  items: string[];
  ordered: boolean;
}

export interface CodeBlock extends BaseBlock {
  type: "code";
  content: string;
  language?: string;
}

export interface TableBlock extends BaseBlock {
  type: "table";
  headers: string[];
  rows: string[][];
  caption?: string;
}

export type ContentBlock =
  | HeadingBlock
  | TextBlock
  | MathBlock
  | FigureBlock
  | ListBlock
  | CodeBlock
  | TableBlock;

// ============ OUTLINE/NAVIGATION ============
export interface OutlineItem {
  title: string;
  level: number;
  block_id: string;
  page: number;
}

export interface SmartOutlineItem {
  id: string;
  title: string;
  level: number;
  section_id: string; // "page-0", "page-1", etc.
  pdf_page: number;
  description?: string;
}

// ============ IMAGE INFO ============
export interface ImageInfo {
  id: string;
  page: number;
  mime_type: string;
  bbox: BoundingBox;
}

// ============ STRUCTURED CONTENT ============
export interface StructuredContent {
  blocks: ContentBlock[];
  outline: OutlineItem[];
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
}

// ============ BOOK CONTENT (UPDATED) ============
export interface BookSection {
  id: string;
  title: string;
  level: number;
  content: string;
  pdf_pages: number[];
  figures: string[];
}

export interface BookContent {
  title: string;
  authors?: string;
  tldr: string;
  sections: BookSection[]; // Legacy
  page_summaries: PageSummary[]; // NEW: page-by-page
  summary_status?: PageSummaryStatus; // NEW
  key_figures: Array<{
    id: string;
    caption: string;
    pdf_page: number;
    importance?: string;
  }>;
  generated_at: string;
  model: string;
}

// ============ PAPER TYPES ============
export interface Paper {
  id: string;
  user_id: string;
  title: string;
  filename: string;
  created_at: string;
  page_count?: number;
  has_book_content: boolean;
}

export interface PaperDetail extends Paper {
  extracted_text?: string;
  outline?: OutlineItem[];
  structured_content?: StructuredContent;
  images?: Record<string, ImageInfo>;
  book_content?: BookContent;
  smart_outline: SmartOutlineItem[];
}

// ============ SEARCH ============
export interface SearchResultItem {
  block_id: string;
  block_type: string;
  text: string;
  context_before: string;
  context_after: string;
  source: SourceLocation;
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResultItem[];
}

// ============ HIGHLIGHT TYPES ============
export interface Highlight {
  id: string;
  paper_id: string;
  user_id: string;
  mode: "pdf" | "book";
  selected_text: string;
  page_number?: number;
  section_id?: string;
  rects?: Rect[];
  anchor?: TextAnchor;
  created_at: string;
}

// ============ ASK MODES ============
export type AskMode =
  | "explain_simply"
  | "explain_math"
  | "derive_steps"
  | "intuition"
  | "pseudocode"
  | "diagram"
  | "custom";

export const ASK_MODE_LABELS: Record<AskMode, string> = {
  explain_simply: "Explain Simply",
  explain_math: "Explain Mathematically",
  derive_steps: "Derive Step-by-Step",
  intuition: "Build Intuition",
  pseudocode: "Convert to Pseudocode",
  diagram: "Make a Diagram",
  custom: "Custom Question",
};

export const ASK_MODE_ICONS: Record<AskMode, string> = {
  explain_simply: "💡",
  explain_math: "📐",
  derive_steps: "📝",
  intuition: "🧠",
  pseudocode: "💻",
  diagram: "📊",
  custom: "💬",
};

// ============ EXPLANATION TYPES ============
export interface Explanation {
  id: string;
  paper_id: string;
  highlight_id: string;
  user_id: string;
  parent_id?: string;
  question: string;
  answer_markdown: string;
  model: string;
  ask_mode: AskMode;
  created_at: string;
  is_pinned: boolean;
  is_resolved: boolean;
  canvas_node_id?: string;
  children?: Explanation[];
}

// ============ CANVAS TYPES (ENHANCED) ============
export type CanvasNodeType =
  | "paper"
  | "excerpt"
  | "question"
  | "answer"
  | "followup"
  | "note"
  | "diagram";

export type ContentType =
  | "plain"
  | "markdown"
  | "latex"
  | "mermaid"
  | "code"
  | "mixed";

export interface SourceReference {
  paper_id: string;
  page_number?: number;
  section_id?: string;
  section_path?: string[];
  highlight_id?: string;
  block_id?: string;
}

export interface ExcerptContext {
  selected_text: string;
  expanded_text: string;
  section_title?: string;
  section_path?: string[];
  nearby_equations?: string[];
  nearby_figures?: string[];
  paragraph_context?: string;
}

export interface CanvasNodeData {
  label: string;
  content?: string;
  content_type: ContentType;
  excerpt?: ExcerptContext;
  question?: string;
  ask_mode?: AskMode;
  source?: SourceReference;
  highlight_id?: string;
  explanation_id?: string;
  is_collapsed: boolean;
  tags?: string[];
  color?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CanvasNodePosition {
  x: number;
  y: number;
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
  edge_type?: "default" | "followup" | "reference";
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

// ============ READER SETTINGS ============
export interface ReaderSettings {
  theme: "light" | "dark" | "sepia";
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  mode: "pdf" | "book";
  fontFamily: "serif" | "sans" | "mono";
  minimapWidth: number;
  invertPdf: boolean;
  invertMinimap: boolean;
}
