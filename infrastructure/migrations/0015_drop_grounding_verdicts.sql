-- 0015_drop_grounding_verdicts.sql — the grounding verdict is no longer computed or stored
-- (v0.3, #351, 2026-11-20).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- Owner ruling (#339/#340): an AI answer is a tutor, not an auditor. The UI and the wire stopped
-- showing a verdict in Wave 1; the API stopped computing it here, so both columns are dead:
--
--   ai_citations.supported        plain DROP COLUMN: nothing indexes it, no CHECK names it but its
--                                 own column CHECK, which goes with it. Rows are untouched.
--   ai_diagram_parts.supported    REBUILT: table CHECKs name it (`(cite_quote IS NULL) =
--                                 (supported IS NULL)`, `supported IS NOT 1 OR anchor_json IS NOT
--                                 NULL`), and SQLite refuses to drop a column a table CHECK uses.
--                                 The rebuilt table keeps every other CHECK, the UNIQUEs, the FK
--                                 and the index; a part's quote, Anchor, block hint and page stay
--                                 (the web's source line reads them). Nothing references this
--                                 table, so no child is rebuilt. 15 is in BACKUP_BEFORE_VERSIONS.
ALTER TABLE ai_citations DROP COLUMN supported;
--;;
CREATE TABLE ai_diagram_parts_new (
  part_id     TEXT    PRIMARY KEY,
  owner_id    TEXT    NOT NULL,
  message_id  TEXT    NOT NULL,
  letter      TEXT    NOT NULL CHECK (letter GLOB '[A-L]'),
  ordinal     INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 11),
  label       TEXT    NOT NULL CHECK (length(label) >= 1),
  note        TEXT    NOT NULL DEFAULT '',          -- the part's one-line text (`text` on the wire)
  part_kind   TEXT    NOT NULL CHECK (part_kind IN ('input', 'step', 'output', 'concept')),
  after_json  TEXT    NOT NULL CHECK (json_valid(after_json) AND json_type(after_json) = 'array'),
  edge_json   TEXT    NOT NULL CHECK (json_valid(edge_json) AND json_type(edge_json) = 'array'),
  cite_quote  TEXT,                                 -- the model's quote
  anchor_json TEXT    CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
  generation  INTEGER NOT NULL CHECK (generation >= 1),
  block_id    TEXT,                                 -- hint only; never an FK
  page_index  INTEGER CHECK (page_index IS NULL OR page_index >= 0),
  CHECK (letter = char(65 + ordinal)),
  CHECK (json_array_length(edge_json) = json_array_length(after_json)),
  CHECK (anchor_json IS NULL OR cite_quote IS NOT NULL),
  CHECK ((anchor_json IS NULL) = (block_id IS NULL) AND (anchor_json IS NULL) = (page_index IS NULL)),
  UNIQUE (owner_id, part_id),
  UNIQUE (message_id, letter),
  FOREIGN KEY (owner_id, message_id) REFERENCES ai_messages (owner_id, message_id)
    ON DELETE CASCADE
) STRICT;
--;;
INSERT INTO ai_diagram_parts_new
  (part_id, owner_id, message_id, letter, ordinal, label, note, part_kind, after_json, edge_json,
   cite_quote, anchor_json, generation, block_id, page_index)
  SELECT part_id, owner_id, message_id, letter, ordinal, label, note, part_kind, after_json,
         edge_json, cite_quote, anchor_json, generation, block_id, page_index
    FROM ai_diagram_parts;
--;;
DROP TABLE ai_diagram_parts;
--;;
ALTER TABLE ai_diagram_parts_new RENAME TO ai_diagram_parts;
--;;
CREATE INDEX ai_diagram_parts_by_message ON ai_diagram_parts (owner_id, message_id, ordinal);
