-- 0016_board_tree.sql — the board becomes a branching tree (v0.3, #343; v03-BOARD-SPEC §2).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- Additive only (eight columns on canvas_nodes, each nullable or with a default), so no table is
-- rebuilt and BACKUP_BEFORE_VERSIONS is unchanged: every v0.2 card and edge keeps its row, reads
-- as a loose card (parent_id NULL, no branch) and Tidy ignores it.
--
--   parent_id         the card this one hangs from, a node of the SAME board. Plain TEXT, validated
--                     in Python (an ALTER cannot add a composite foreign key), the way
--                     source_page_id is. NULL: a root passage, or a loose v0.2 card.
--   branch            'down' (continues the conversation below its parent) or 'right' (a branch).
--                     NULL exactly when parent_id is NULL (checked in Python).
--   parent_span_json  {start, end, quote}: UTF-16 code units into the parent's stored final answer
--                     text, and the selected words. NULL unless the child starts from a span.
--   question          an answer card's ask, as typed or the quick-ask label; NULL elsewhere.
--   uses_json         {path, paper, level, diagram, extra_node_ids}: what the ask read.
--   offset_x/offset_y the user's drag offset on top of the Tidy layout (the layout is the web's).
--   folded            1 when the subtree under this card is collapsed to a pill.
ALTER TABLE canvas_nodes ADD COLUMN parent_id TEXT;
--;;
ALTER TABLE canvas_nodes ADD COLUMN branch TEXT CHECK (branch IS NULL OR branch IN ('down', 'right'));
--;;
ALTER TABLE canvas_nodes ADD COLUMN parent_span_json TEXT
  CHECK (parent_span_json IS NULL OR json_valid(parent_span_json));
--;;
ALTER TABLE canvas_nodes ADD COLUMN question TEXT;
--;;
ALTER TABLE canvas_nodes ADD COLUMN uses_json TEXT CHECK (uses_json IS NULL OR json_valid(uses_json));
--;;
ALTER TABLE canvas_nodes ADD COLUMN offset_x REAL NOT NULL DEFAULT 0;
--;;
ALTER TABLE canvas_nodes ADD COLUMN offset_y REAL NOT NULL DEFAULT 0;
--;;
ALTER TABLE canvas_nodes ADD COLUMN folded INTEGER NOT NULL DEFAULT 0 CHECK (folded IN (0, 1));
--;;
CREATE INDEX canvas_nodes_by_parent ON canvas_nodes (owner_id, board_id, parent_id);
