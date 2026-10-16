-- 0010_plate.sql — the figure a person chose as a paper's cover plate (v0.2 S3, #200).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- Additive only (one new table), so no existing row is rebuilt and BACKUP_BEFORE_VERSIONS is
-- unchanged. It arrives AFTER 0011 was merged: the runner applies every version a database is
-- missing, lower ones included (a database already at 0011 gets 0010 on its next start; see
-- tests/test_0010_plate.py), and nothing here depends on 0011 or the other way round.
--
-- USER-OWNED, so it is keyed to the PAPER (paper_owners), never to a generation, and dies only
-- with the paper. The chosen figure is an ANCHOR (the GAP-A1 D6 design), never a bare block id: a
-- block id is content-derived and dies with a re-parse (AGENTS.md §4). The CHECK holds the anchor
-- to this row's paper; that it names a FIGURE of that paper is the API's check (422), because the
-- figure set belongs to a generation and this row outlives generations. No row = the typographic
-- cover, the default (#103: float detection misses some figures).

CREATE TABLE paper_plate (
  owner_id    TEXT NOT NULL,
  paper_id    TEXT NOT NULL,
  anchor_json TEXT NOT NULL CHECK (json_valid(anchor_json)
                 AND json_extract(anchor_json, '$.doc.paperId') = paper_id),
  chosen_at   TEXT NOT NULL,
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
