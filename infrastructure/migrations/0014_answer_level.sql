-- 0014_answer_level.sql — the level an AI answer was written at, and the answer it is a sibling of
-- (v0.3, #339, 2026-11-20).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- Additive only (two nullable columns on ai_messages), so no row is rebuilt and
-- BACKUP_BEFORE_VERSIONS is unchanged.
--
--   level       'new' | 'familiar' | 'expert': the reader's level the answer was written for.
--               NULL on a user message, a diagram or summary answer, and every answer stored before
--               0014 (the API reads an older explain/ask answer as 'familiar').
--   sibling_of  the message_id of the FIRST answer to the same question, set on an answer made by
--               "change level" (FollowUp.relevel_of): it answers the same user turn at another
--               level, so it is not a new question. NULL on a first answer. A hint, never an FK: the
--               group's first answer dies with its thread, and the API reads the group from it.
ALTER TABLE ai_messages ADD COLUMN level TEXT
  CHECK (level IS NULL OR level IN ('new', 'familiar', 'expert'));
--;;
ALTER TABLE ai_messages ADD COLUMN sibling_of TEXT;
