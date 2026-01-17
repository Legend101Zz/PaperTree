// apps/web/src/types/index.ts
// User types
export interface User {
  id: string;
  email: string;
  created_at: string;
}

// Bounding box (normalized 0-1)
export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Source location in PDF
export interface SourceLocation {
  page: number;
  bbox?: BoundingBox;
  char_start?: number;
  char_end?: number;
}

// Content blocks
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

// Outline item with block reference
export interface OutlineItem {
  title: string;
  level: number;
  block_id: string;
  page: number;
}

// Image info
export interface ImageInfo {
  id: string;
  page: number;
  mime_type: string;
  bbox: BoundingBox;
}

// Structured content
export interface StructuredContent {
  blocks: ContentBlock[];
  outline: OutlineItem[];
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
}

// Paper types
export interface Paper {
  id: string;
  user_id: string;
  title: string;
  filename: string;
  created_at: string;
  page_count?: number;
}

export interface PaperDetail extends Paper {
  extracted_text?: string;
  outline?: OutlineItem[];
  structured_content?: StructuredContent;
  images?: Record<string, ImageInfo>;
}

// Search
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

// PDF Region mapping
export interface PDFRegion {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Book content section
export interface BookSection {
  id: string;
  title: string;
  level: number;
  content: string; // Markdown with LaTeX/Mermaid
  pdf_pages: number[];
  figures: string[];
}

// LLM-generated book content
export interface BookContent {
  title: string;
  authors?: string;
  tldr: string;
  sections: BookSection[];
  key_figures: Array<{
    id: string;
    caption: string;
    pdf_page: number;
    importance?: string;
  }>;
  generated_at: string;
  model: string;
}

// Smart outline item
export interface SmartOutlineItem {
  id: string;
  title: string;
  level: number;
  section_id: string;
  pdf_page: number;
  description?: string;
}

// Paper types
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
  book_content?: BookContent;
  smart_outline: SmartOutlineItem[];
}

// Highlight types
export interface Highlight {
  id: string;
  paper_id: string;
  user_id: string;
  mode: "pdf" | "book";
  selected_text: string;
  page_number?: number;
  section_id?: string;
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
}

// Reader settings
export interface ReaderSettings {
  theme: "light" | "dark" | "sepia";
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  mode: "pdf" | "book";
  fontFamily: "serif" | "sans" | "mono";
  minimapSize: "small" | "medium" | "large" | "hidden";
  minimapPosition: "right" | "bottom";
}
