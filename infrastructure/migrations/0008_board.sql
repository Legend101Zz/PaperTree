-- 0008 (v0.2, S6a, #211): the board grows three card kinds and typed pins.
--
-- Numbered 0008 because 0006 (library) and 0007 (notebook) are built in parallel. The runner
-- applies by version, so a gap is fine and this file does NOT depend on either of them:
--   * canvas_nodes.source_page_id (notebook card) and source_diagram_id (diagram card) are plain
--     nullable TEXT, NOT foreign keys. notebook_pages comes from 0007 and diagrams from a later
--     slice (S7a); the API checks owner + paper + existence in Python when the table exists.
--
-- A CHECK cannot be altered in SQLite, so canvas_nodes is REBUILT (the 0005 highlights_new
-- pattern): this version is in BACKUP_BEFORE_VERSIONS. canvas_edges is rebuilt too, because
-- DROP TABLE canvas_nodes under foreign_keys=ON would cascade-delete every edge; the new tables
-- point at each other's *_new names, RENAME rewrites those references, and nothing is dropped
-- until both copies are verified. The migration runs in one transaction, so a failure leaves the
-- old schema untouched.
CREATE TABLE canvas_nodes_new (
  node_id            TEXT    PRIMARY KEY,            -- client-minted uuid
  owner_id           TEXT    NOT NULL,
  board_id           TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('excerpt', 'explanation', 'note', 'group',
                                                      'question', 'notebook', 'diagram')),
  group_id           TEXT,
  x                  REAL    NOT NULL,
  y                  REAL    NOT NULL,
  w                  REAL    NOT NULL CHECK (w > 0),
  h                  REAL    NOT NULL CHECK (h > 0),
  z                  INTEGER NOT NULL DEFAULT 0,
  title              TEXT,
  body               TEXT    NOT NULL DEFAULT '',
  source_anchor_json TEXT    CHECK (source_anchor_json IS NULL OR json_valid(source_anchor_json)),
  source_message_id  TEXT,
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  source_page_id     TEXT,                           -- notebook card; validated in Python
  source_diagram_id  TEXT,                           -- diagram card; validated in Python
  CHECK (kind <> 'excerpt' OR source_anchor_json IS NOT NULL),
  CHECK (kind <> 'explanation' OR source_message_id IS NOT NULL),
  CHECK (kind <> 'notebook' OR source_page_id IS NOT NULL),
  CHECK (kind <> 'diagram' OR source_diagram_id IS NOT NULL),
  CHECK (group_id IS NULL OR group_id <> node_id),
  UNIQUE (owner_id, node_id),
  FOREIGN KEY (owner_id, board_id) REFERENCES canvas_boards (owner_id, board_id) ON DELETE CASCADE,
  -- NO ACTION, not SET NULL (see 0005): the trigger below ungroups members before a delete.
  FOREIGN KEY (owner_id, group_id) REFERENCES canvas_nodes_new (owner_id, node_id)
) STRICT;
--;;
INSERT INTO canvas_nodes_new
  (node_id, owner_id, board_id, kind, group_id, x, y, w, h, z, title, body, source_anchor_json,
   source_message_id, version, created_at, updated_at)
  SELECT node_id, owner_id, board_id, kind, group_id, x, y, w, h, z, title, body,
         source_anchor_json, source_message_id, version, created_at, updated_at
    FROM canvas_nodes;
--;;
CREATE TABLE canvas_edges_new (
  edge_id      TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  board_id     TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('supports', 'contradicts', 'derives_from', 'answers',
                                             'compares', 'references', 'relates')),
  label        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  -- NULL on every v0.1 edge and on a keyboard-made link; see papertree_db.canvas PIN_TABLE.
  from_port    TEXT CHECK (from_port IS NULL OR from_port IN ('claim_out', 'answer_out')),
  to_port      TEXT CHECK (to_port IS NULL OR to_port IN ('evidence_in', 'question_in')),
  CHECK (from_node_id <> to_node_id),
  UNIQUE (owner_id, edge_id),
  FOREIGN KEY (owner_id, board_id) REFERENCES canvas_boards (owner_id, board_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, from_node_id) REFERENCES canvas_nodes_new (owner_id, node_id)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, to_node_id) REFERENCES canvas_nodes_new (owner_id, node_id)
    ON DELETE CASCADE
) STRICT;
--;;
INSERT INTO canvas_edges_new
  (edge_id, owner_id, board_id, from_node_id, to_node_id, kind, label, created_at, updated_at)
  SELECT edge_id, owner_id, board_id, from_node_id, to_node_id, kind, label, created_at, updated_at
    FROM canvas_edges;
--;;
-- Abort the whole migration if any row failed to carry (the CHECK fails on 0).
CREATE TEMP TABLE _0008_guard (ok INTEGER NOT NULL CHECK (ok = 1));
--;;
INSERT INTO _0008_guard VALUES
  ((SELECT COUNT(*) FROM canvas_nodes) = (SELECT COUNT(*) FROM canvas_nodes_new));
--;;
INSERT INTO _0008_guard VALUES
  ((SELECT COUNT(*) FROM canvas_edges) = (SELECT COUNT(*) FROM canvas_edges_new));
--;;
DROP TABLE _0008_guard;
--;;
DROP TABLE canvas_edges;
--;;
DROP TABLE canvas_nodes;
--;;
ALTER TABLE canvas_nodes_new RENAME TO canvas_nodes;
--;;
ALTER TABLE canvas_edges_new RENAME TO canvas_edges;
--;;
CREATE TRIGGER canvas_nodes_ungroup_before_delete BEFORE DELETE ON canvas_nodes
  WHEN OLD.kind = 'group'
BEGIN
  UPDATE canvas_nodes SET group_id = NULL WHERE owner_id = OLD.owner_id AND group_id = OLD.node_id;
END;
--;;
CREATE INDEX canvas_nodes_by_board ON canvas_nodes (owner_id, board_id);
--;;
CREATE INDEX canvas_edges_by_board ON canvas_edges (owner_id, board_id);
