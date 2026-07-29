// Row shapes.
//
// These mirror the columns in infrastructure/migrations/*.sql EXACTLY, snake_case and all.
// There is deliberately no rename/ORM layer: a second naming of every field is a second
// representation, and second representations drift — which is the failure this rewrite
// exists to remove. JSON columns come back as strings; callers that want the parsed shape
// use the `@papertree/document-ir` types and `JSON.parse`, so no half-parsed hybrid exists.

export interface PaperRow {
  readonly owner_id: string;
  readonly paper_id: string;
  readonly generation: number;
  readonly source_hash: string;
  readonly ir_version: string;
  readonly coordinate_space: string;
  readonly parser_name: string;
  readonly parser_version: string;
  readonly parser_config_hash: string;
  readonly parser_profile: string | null;
  readonly parsed_at: string;
  readonly status: string;
  readonly partial_reason: string | null;
  readonly metadata: string;
  readonly sections: string;
  readonly references_json: string;
  readonly confidence: string;
  readonly created_at: string;
}

export interface PageRow {
  readonly owner_id: string;
  readonly paper_id: string;
  readonly generation: number;
  readonly page_id: string;
  readonly page_index: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly user_unit: number;
  readonly crop_box: string;
  readonly media_box: string;
  readonly image: string | null;
  readonly has_text_layer: number;
  readonly is_scanned: number;
  readonly confidence: number;
}

export interface BlockRow {
  readonly owner_id: string;
  readonly paper_id: string;
  readonly generation: number;
  readonly block_id: string;
  readonly page_index: number;
  readonly type: string;
  readonly flow: string;
  readonly order: number;
  readonly doc_order: number | null;
  readonly parent_id: string | null;
  readonly prev_id: string | null;
  readonly next_id: string | null;
  readonly child_ids: string | null;
  readonly polygon: string;
  readonly bbox_x0: number;
  readonly bbox_y0: number;
  readonly bbox_x1: number;
  readonly bbox_y1: number;
  readonly text: string | null;
  readonly text_normalised: string | null;
  readonly content_hash: string | null;
  readonly spans: string | null;
  readonly payload: string | null;
  readonly source: string;
  readonly confidence: number;
  readonly provenance: string;
  readonly repairs: string | null;
  readonly alternatives: string | null;
}

export interface RelationRow {
  readonly owner_id: string;
  readonly paper_id: string;
  readonly generation: number;
  readonly type: string;
  readonly from_block: string;
  readonly to_block: string;
  readonly confidence: number;
  readonly provenance: string;
}

export interface HighlightRow {
  readonly highlight_id: string;
  readonly owner_id: string;
  readonly paper_id: string;
  readonly generation: number;
  readonly color: string;
  readonly note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AnchorRow {
  readonly anchor_id: string;
  readonly owner_id: string;
  readonly highlight_id: string;
  readonly paper_id: string;
  readonly generation: number;
  readonly block_id: string;
  readonly tier: number;
  readonly char_start: number | null;
  readonly char_end: number | null;
  readonly text_quote: string | null;
  readonly quote_prefix: string | null;
  readonly quote_suffix: string | null;
  readonly content_hash: string | null;
  readonly polygon: string;
  readonly bbox_x0: number;
  readonly bbox_y0: number;
  readonly bbox_x1: number;
  readonly bbox_y1: number;
  readonly resolved_at: string;
}

export interface DerivationRow {
  readonly derivation_id: string;
  readonly owner_id: string;
  readonly paper_id: string;
  readonly generation: number;
  readonly parent_derivation_id: string | null;
  readonly kind: string;
  readonly author_kind: string;
  readonly model_id: string;
  readonly prompt_hash: string;
  readonly content: string;
  readonly derived_from: string;
  readonly created_at: string;
}

export interface UserRow {
  readonly user_id: string;
  readonly email: string;
  readonly created_at: string;
}

/**
 * One row of the highlights ⋈ anchors ⋈ blocks join — the query that resolves a
 * highlight onto the geometry it points at. It exists in this package rather than in the
 * reader because the join is the findings.md §F3 bug class: three tables, and the v1 code
 * put the ownership filter on the first one only.
 */
export interface ResolvedHighlightRow {
  readonly highlight_id: string;
  readonly anchor_id: string;
  readonly block_id: string;
  readonly tier: number;
  readonly color: string;
  readonly note: string | null;
  readonly text_quote: string | null;
  /** The anchor's recorded content hash. */
  readonly anchor_content_hash: string | null;
  /** The block's CURRENT content hash. A mismatch is a tier-1 hit on changed content. */
  readonly block_content_hash: string | null;
  readonly block_text: string | null;
  readonly page_index: number;
  readonly block_polygon: string;
}

/** A derivation plus its depth below the traversal root. */
export interface DerivationTreeRow extends DerivationRow {
  readonly depth: number;
}
