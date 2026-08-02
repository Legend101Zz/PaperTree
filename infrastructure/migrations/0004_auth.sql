-- 0004_auth.sql — credentials and sessions, so an HTTP caller can be resolved to a user_id.
--
-- Applied by the SAME runner as 0001_core.sql (packages/db/{src/migrate.ts,
-- python/papertree_db/migrate.py}), and the statement separator is the same `--;;` line.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS AT ALL
--
-- `packages/db`'s module docstring says outright that none of its four ownership gates
-- authenticates anybody: `owner_for(user_id)` takes an ALREADY-VERIFIED user_id and hands
-- back an opaque per-connection handle. Something upstream has to do the verifying, and
-- until `services/api` (#74) there was no upstream — so `users` (0001_core.sql:38) carries
-- `user_id`, `email`, `created_at` and no credential column at all.
--
-- #74 says "porting v1's JWT from auth/utils.py is legitimate and cheap". The port is not
-- available as stated: v1 kept its users in MongoDB with a bcrypt field on the user
-- document, and that field has no column here. A migration was required either way.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A SESSION TABLE RATHER THAN THE JWT
--
-- Given a migration was needed regardless, the choice between "bcrypt hash + signed JWT"
-- and "scrypt hash + opaque token row" is a real one, and it was made on two grounds.
--
--   1. DEPENDENCIES. #74's sibling ruling (#78 §6) requires a measured lockfile delta for
--      any new dependency, and cites `packages/evaluation`, where one `docling>=2.0` line
--      took the lock from 22 packages to 100+. v1's scheme needs `python-jose[cryptography]`
--      — which builds `cryptography`, a large Rust wheel — plus `bcrypt`. This scheme needs
--      neither: `hashlib.scrypt` and `secrets` are stdlib, exactly as `packages/jobs` is
--      "stdlib only by design".
--
--   2. REVOCATION. A JWT is valid until it expires because nothing consults storage. A row
--      can be deleted. `POST /auth/logout` is one DELETE here and is not expressible there
--      without adding the very table this migration adds.
--
-- This is not a new scheme. An opaque random bearer token in a table is the oldest one
-- there is; #74's "inventing a new scheme is not in scope" is about not designing crypto,
-- and no crypto is designed here.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NEITHER TABLE CARRIES owner_id
--
-- `OWNED_TABLES` in packages/db/python/tests/test_ownership.py is the tenant data: papers,
-- pages, blocks, relations, highlights, anchors, derivations. These two are IDENTITY, which
-- is what owner_id is derived FROM — an owner_id column here would be circular. `users`
-- itself has none for the same reason. The test enumerates owned tables explicitly rather
-- than scanning, so this addition is silent there on purpose rather than by luck.

CREATE TABLE user_credentials (
  -- One row per user, or none: a user created by `create_user` alone can exist without a
  -- password, which is what the worker's test fixtures do.
  user_id       TEXT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,

  -- `scrypt$n$r$p$<salt-b64>$<hash-b64>`. The PARAMETERS ARE IN THE STRING, so raising the
  -- cost later does not invalidate existing rows — verification reads n/r/p from the row it
  -- is checking, and only new rows get the new cost. A bare digest with the cost in the
  -- code is a migration nobody can perform.
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;
--;;

CREATE TABLE sessions (
  -- The SHA-256 of the bearer token, never the token. A read of this table does not yield a
  -- credential, which is the whole reason to store a hash of a high-entropy random value
  -- rather than the value. No salt and no work factor: the input is 256 bits of CSPRNG
  -- output, so there is nothing to brute-force and a slow KDF would only cost latency on
  -- every request.
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,

  -- ISO-8601 UTC, string-comparable, same convention as every other timestamp in 0001_core.
  expires_at TEXT NOT NULL
) STRICT;
--;;

-- For revoke-all-sessions-for-a-user, and for the ON DELETE CASCADE to be cheap.
CREATE INDEX sessions_user ON sessions (user_id);
--;;

-- Expiry is enforced in the WHERE clause of the lookup, not by a sweeper. A row that has
-- expired is not a valid session whether or not anything has deleted it yet; this index
-- makes the housekeeping delete cheap when someone adds one.
CREATE INDEX sessions_expires_at ON sessions (expires_at);
