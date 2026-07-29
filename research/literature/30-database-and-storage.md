# 30 — Primary Database, Blob Storage and Vector Retrieval for PaperTree

**Research date: 2026-07-29.** All URLs below were fetched on that date unless stated. Version numbers and prices are as observed then.

---

## 0. Verdict up front

**Move off MongoDB to PostgreSQL as the system of record.** The decisive reason is not preference — it is that PaperTree's own requirement ("tens of thousands of blocks per paper with geometry") collides with MongoDB's **16 MiB hard BSON document limit** ([MongoDB limits](https://www.mongodb.com/docs/manual/reference/limits/)). At ~300–500 bytes of BSON per block (id, parent id, type, page, bbox, spans, text), 30k blocks lands at 9–15 MB — inside the limit today, over it the moment per-span or per-glyph geometry is added. So the IR *cannot* be one document; blocks must live in their own collection regardless. Once that is true, Mongo's nested-document ergonomics — the only real reason to be there — are gone, and you are left with a store that has no foreign keys, no joins in the vector path, and no DDL migrations for an IR that you have already decided **will** be versioned.

Day one: **Postgres 17/18 + pgvector + tsvector/pg_trgm + Cloudflare R2.** Growth: same Postgres, plus `pgvectorscale` when embeddings exceed RAM, plus **Qdrant** *only if* ColPali/ColBERT late-interaction retrieval is adopted (pgvector has no MaxSim).

---

## 1. Primary store comparison

| Dimension | PostgreSQL (+JSONB, pgvector) | MongoDB (+Atlas Vector Search) | SQLite / libSQL (+sqlite-vec) |
|---|---|---|---|
| Licence (engine) | PostgreSQL Licence (BSD-style) | **SSPL v1** for Community — see §1.6 | SQLite public domain; **libSQL = MIT** ([LICENSE](https://raw.githubusercontent.com/tursodatabase/libsql/main/LICENSE.md)) |
| Versioned IR w/ stable IDs | Native: PK/FK, `DEFERRABLE` constraints, `CHECK`, generated columns | Application-enforced only | Native FK (must `PRAGMA foreign_keys=ON`) |
| Nested ergonomics | JSONB for type-specific payload; tree via `parent_id` + `ltree`/recursive CTE | Best-in-class *until* 16 MiB bites | JSON1 functions; weaker than JSONB |
| Referential integrity | Real FKs, `ON DELETE RESTRICT` | **None** | Real FKs |
| Migrations / schema evolution | Alembic + DDL, transactional DDL, backfill in a transaction | No DDL; `$jsonSchema` validators are opt-in; drift is silent | DDL is limited (`ALTER TABLE` restricted), but transactional |
| Cross-entity transactions | Default behaviour | Replica-set only; **default 60 s lifetime**, `TransactionTooLargeForCache` ([prod considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/)) | Full ACID, single writer |
| Full-text | tsvector + GIN, pg_trgm; **no IDF** (§1.4) | `$search` (Lucene-based, real BM25) via `mongot` | FTS5 (real BM25) |
| Vector + keyword + structural filter in ONE query | **Yes, arbitrary SQL** (§2) | Yes via `$rankFusion`, but constrained (§2) | Brute-force only |
| Hard limits | field 1 GB, table 32 TB, 1600 cols ([limits](https://www.postgresql.org/docs/current/limits.html)) | **doc 16 MiB**, nesting 100, 64 indexes/collection | practical, not architectural |

### 1.1 Modelling the versioned IR

The right Postgres shape is *not* "one JSONB blob per paper" and *not* "fully normalise everything":

- `documents(id, …)`, `doc_versions(id, document_id, ir_version, extractor, created_at)` — **the IR version is a row, not a field.**
- `blocks(id uuid, doc_version_id, parent_id, ordinal, block_type, page, bbox real[4], text, payload jsonb)` — one row per block. `payload` absorbs per-type variation (table cells, formula LaTeX, figure crop refs), so adding a block type is a data change, not a migration. Tree queries via `WITH RECURSIVE` on `parent_id`, or a materialised `path ltree` column for cheap subtree filters.
- `highlights(id, user_id, doc_version_id, anchors jsonb, block_id_start, block_id_end)` with FKs to `blocks`. Multi-selector anchors are exactly the heterogeneous payload JSONB is for; the *resolved* anchor gets typed columns so it can be indexed and FK'd.

This "typed spine + JSONB flanks" pattern is the mainstream 2026 recommendation: normalise stable, joined, filtered attributes; keep flexible tails in JSONB with GIN `jsonb_path_ops` ([SitePoint JSONB indexing guide](https://www.sitepoint.com/postgresql-jsonb-query-performance-indexing/)). Important caveat: GIN does not index arbitrary JSONPath — `@?`/`@@` fall back to seq scans unless paired with an expression/partial index or generated column. **Any field you filter retrieval on must be a real or generated column, not raw JSONB.**

### 1.2 Schema evolution — the point that decides this

The IR will be versioned. In Postgres, "IR v3 adds `reading_order_confidence` to every block" is: add a nullable column, backfill in batches inside transactions, add a `CHECK` once backfilled, flip `ir_version`. Old versions stay queryable because `doc_versions` is a table. Rollback is a migration down.

In MongoDB the same change is *free to write* and *expensive forever after*: every read path must tolerate documents with and without the field, and nothing authoritatively records which shape a given document has. For a product whose core asset is a canonical IR consumed by highlighting, explanations, canvases and audiobooks, silent shape drift across four consumers is the failure mode that costs months.

### 1.3 Transactional consistency across highlight + block + explanation

Postgres: one `BEGIN … COMMIT`. Nothing more to say, which is the point.

MongoDB: multi-document transactions exist but come with operational caveats — unsupported on standalone (replica set minimum), a **default 60-second** `transactionLifetimeLimitSeconds`, a 5 ms default `maxTransactionLockRequestTimeoutMillis`, and `TransactionTooLargeForCache` aborts under WiredTiger cache pressure. For PaperTree's write pattern (a highlight write that touches blocks + creates an explanation node) this is survivable, but it is a feature you must operate rather than a property you get.

### 1.4 Full-text search quality — the honest gap

Postgres FTS has a documented, structural weakness. From the official docs ([textsearch-controls](https://www.postgresql.org/docs/current/textsearch-controls.html)):

> "It is important to note that the ranking functions do not use any global information, so it is impossible to produce a fair normalization to 1% or 100% as sometimes desired."

> "Ranking can be expensive since it requires consulting the `tsvector` of each matching document, which can be I/O bound and therefore slow."

`ts_rank`/`ts_rank_cd` are term-frequency and cover-density, **not BM25** — there is no IDF. For scientific papers, where the discriminative terms are rare, this materially hurts. Hard limits also apply: a `tsvector` must be **< 1 MB**, lexemes < 2 KB, position values ≤ 16383, ≤ 256 positions per lexeme, `tsquery` < 32768 nodes ([textsearch-limitations](https://www.postgresql.org/docs/current/textsearch-limitations.html)). Indexing a whole paper as one tsvector is therefore borderline; **index per block or per section**, which PaperTree wants anyway for structure-aware retrieval.

MongoDB's legacy `$text` index is worse than Postgres FTS (no collation, cannot combine with geospatial, unavailable on views). Atlas `$search` is Lucene-grade and genuinely better than both — that is Mongo's strongest card.

The Postgres answer to BM25 is **ParadeDB `pg_search`** (Tantivy-backed). Licence verified from the repo LICENSE: **AGPL-3.0** ([LICENSE](https://raw.githubusercontent.com/paradedb/paradedb/dev/LICENSE)); latest on PGXN was **0.24.3** as of late July 2026 ([PGXN](https://pgxn.org/dist/pg_search/)). **Flag: AGPL.** For a hosted commercial product the AGPL network clause is a real question for your lawyers; extension-as-linked-into-postgres muddies it further. Treat pg_search as a decision requiring legal sign-off, not a default.

### 1.5 SQLite / libSQL for the small-scale case

Tempting for a single-user desktop build, wrong for PaperTree. `sqlite-vec` is dual Apache-2.0/MIT and explicitly **pre-v1 — "expect breaking changes"** ([repo](https://github.com/asg017/sqlite-vec)); its `vec0` virtual table does **brute-force KNN** with metadata columns, ≤4 partition keys and ≤16 auxiliary columns ([vec0 docs](https://alexgarcia.xyz/sqlite-vec/features/vec0.html)). Brute force is fine at 10k vectors, unacceptable at 10M. libSQL is MIT and production-ready; the Rust **Turso Database** rewrite is still **beta** in 2026. For a commercial multi-user web app the single-writer model and pre-v1 vector extension are both disqualifying. Use SQLite for local dev fixtures only.

### 1.6 Licences to flag

- **MongoDB Community: SSPL v1.** PaperTree using Mongo as its own app database is *not* the triggering case — the clause targets offering MongoDB *as a service* ([MongoDB SSPL FAQ](https://www.mongodb.com/legal/licensing/server-side-public-license/faq)). But SSPL is not OSI-approved, and it constrains any future "bring your own database"/on-prem OEM motion. `mongot` (the Search/Vector Search process) is also SSPL; it is now available for self-managed Community Edition, with the **MongoDB Kubernetes Operator as the supported self-host path**.
- **pg_search: AGPL-3.0.** Flagged above.
- **VectorChord: dual AGPLv3 / Elastic Licence v2** ([repo](https://github.com/tensorchord/VectorChord)) — v1.1.1 observed. It is the only Postgres extension I verified with native **MaxSim / multi-vector** support, but neither licence arm is clean for a closed commercial product (AGPL copyleft, or ELv2's use restrictions). **Do not adopt without legal review.**
- **pgvector: PostgreSQL Licence. pgvectorscale: PostgreSQL Licence.** Both clean.

---

## 2. The hard requirement: vector + keyword + structural filters in ONE query

This is where the choice is actually made.

**PostgreSQL — full marks.** A single statement can do: a `WITH RECURSIVE` CTE selecting all block ids beneath section 3.2 of `doc_version = X`, a BM25-ish/tsvector-ranked CTE, a `<=>` vector-ranked CTE, and RRF fusion in the outer select — with `block_type IN (…)`, `page BETWEEN …` and `ir_version = …` as ordinary predicates. **The structural filter can be an arbitrary join or graph traversal**, which no vector-native engine allows. For recall under selective filters, pgvector ≥ 0.8.0 provides iterative index scans: `hnsw.iterative_scan` (`strict_order` | `relaxed_order`), `hnsw.max_scan_tuples` (default 20000), `hnsw.scan_mem_multiplier` (default 1), `ivfflat.max_probes`, plus partial indexes and list partitioning ([pgvector README](https://github.com/pgvector/pgvector)). `pgvectorscale` goes further with **label-based filtering applied during graph traversal** (Filtered-DiskANN): a `smallint[]` label column matched with `&&`, not post-filtered ([pgvectorscale](https://github.com/timescale/pgvectorscale)).

**MongoDB — good, but shaped by the engine.** `$rankFusion` implements RRF natively and, since **v8.1**, accepts `$vectorSearch` inside input pipelines ([MongoDB docs](https://www.mongodb.com/docs/atlas/atlas-vector-search/hybrid-search/)); `$scoreFusion` fuses on scores instead of ranks. The constraints: **`$vectorSearch` must be the first stage**, cannot appear in view definitions, `$lookup` sub-pipelines or `$facet`, and its `filter` supports only a limited operator set (`$eq` shorthand, `$and`, `$in`, …) over fields declared as `filter` type in the index ([$vectorSearch docs](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/)). Consequence: you **cannot join to the block tree before the vector search**. "Descendants of section 3.2" must be pre-materialised as an ancestor-path array on every block. That is denormalisation forced by the query engine, and it must be re-materialised on every IR version bump.

**Dedicated stores** have the same payload-filter constraint as Mongo, *plus* a second system to keep consistent with the IR.

---

## 3. Dedicated vector stores

| Store | Licence (verified from LICENSE unless noted) | Hybrid (vector+BM25) | Metadata filtering | Multi-vector / late interaction | Self-host burden | Cost signal |
|---|---|---|---|---|---|---|
| **pgvector** | PostgreSQL Licence | via SQL + tsvector (or pg_search, AGPL) | Full SQL, incl. joins | **None** (no MaxSim) | Zero extra — it is Postgres | Free; cost = your Postgres |
| **pgvectorscale** | PostgreSQL Licence | same as above | Label filtering *during* traversal | None | Extension install | Free |
| **VectorChord** | **AGPLv3 or Elastic v2** ⚠ | via SQL | Full SQL | **Yes** (MaxSim operators) | Extension install | Free / commercial enquiry |
| **Qdrant** | **Apache-2.0** | Yes (sparse+dense) | Payload indexes, filterable HNSW | **Yes** — `MultiVectorConfig(comparator=MAX_SIM)` ([docs](https://qdrant.tech/documentation/concepts/vectors/)) | Single Rust binary — low | Cloud free tier 0.5 vCPU / 1 GB RAM / 4 GB disk ([pricing](https://qdrant.tech/pricing/)); per-resource rates not published |
| **Weaviate** | **BSD-3-Clause** (core) | Yes, native | Yes | **Yes** — GA in v1.30; **MUVERA** encoding in v1.31 (~80 % memory saving, vendor-reported) ([blog](https://weaviate.io/blog/muvera)) | Moderate (Go, module system) | Free sandbox 100k objects/1 GB; **Flex from $45/mo**; **Premium from $400/mo**; storage $0.12–$0.1505/GiB ([pricing](https://weaviate.io/pricing)) |
| **Milvus** | **Apache-2.0** | Yes — `RRFRanker`, `WeightedRanker` | Scalar filtering | Up to **10 vector fields per collection** ([docs](https://milvus.io/docs/multi-vector-search.md)) | **High** — etcd + object store + multiple roles | Free OSS; Zilliz Cloud separate |
| **LanceDB** | **Apache-2.0** | Yes | Yes | **Yes** (multivector + ColBERT rerank, [docs](https://docs.lancedb.com/search/multivector-search)) | Low (embedded) / higher for Cloud | OSS free |
| **Chroma** | **Apache-2.0** | Limited | Yes | Not verified | Low | Chroma Cloud GA; **$2.50 per logical GiB written**; $5 free credits ([pricing](https://docs.trychroma.com/cloud/pricing)) |
| **Turbopuffer** | **Proprietary SaaS** ⚠ vendor-locked | Yes (vector + BM25 + filters) | Yes | Not verified | None (SaaS only) | Plans **Launch $16/mo**, **Scale $256/mo**, **Enterprise ≥$4,096/mo (+35 % usage premium)** ([pricing](https://turbopuffer.com/pricing)); ~$0.02/GB object storage is vendor/blog-reported |

**Reading of this table for PaperTree.** If ColPali-style visual retrieval (note 11) is adopted, **pgvector cannot do it** — there is no MaxSim. The clean answer is **Qdrant**: Apache-2.0, native `MAX_SIM`, single binary, licence question closed. Weaviate is the strongest alternative (BSD-3 + MUVERA is the best memory story) at higher operational weight. Milvus is over-built here. Turbopuffer is a good product but closed-source SaaS with no exit — acceptable only as a strictly derived index.

---

## 4. Blob storage: PDFs, page images, figure crops, audio

| Provider | Storage | Egress | Ops | Free tier | Notes |
|---|---|---|---|---|---|
| **Cloudflare R2** | **$0.015/GB-mo** (IA $0.01) | **$0** | Class A $4.50/M, Class B $0.36/M (IA: $9.00/M, $0.90/M + $0.01/GB retrieval) | 10 GB-mo, 1 M Class A, 10 M Class B | IA has 30-day minimum duration; [pricing](https://developers.cloudflare.com/r2/pricing/) |
| **Backblaze B2** | **$6.95/TB-mo** (≈$0.00695/GB) | Free to **3× stored**, then $0.01/GB; **unlimited free via Cloudflare/Fastly/bunny** | Class A/B/C free; Class D $0.004/10k | First 10 GB | No minimum retention, no minimum file size; [pricing](https://www.backblaze.com/cloud-storage/pricing) |
| **AWS S3 Standard** (us-east-1) | **$0.023/GB-mo** first 50 TB | **~$0.09/GB** after 100 GB/mo free | PUT/COPY/POST/LIST $0.005/1k; GET $0.0004/1k | 100 GB/mo egress aggregated across AWS | [pricing](https://aws.amazon.com/s3/pricing/) — per-GB/request figures corroborated via secondary sources, see §6 |
| **Supabase Storage** | Pro: 100 GB incl., then **$0.0213/GB** | 250 GB incl., then **$0.09/GB** | — | Free: 1 GB storage, 5 GB egress | $25/mo Pro base; [pricing](https://supabase.com/pricing) |
| **Local disk** | ~free | free | — | — | No CDN, no signed URLs, no durability, blocks horizontal scale. Dev only. |

**Recommendation: Cloudflare R2.** For PaperTree the dominant cost is *egress*, not storage: a 40-page paper rendered at 2× produces ~40 page images at 200–500 KB (8–20 MB), and a 30-minute audiobook at 64 kbps mono Opus is ~14 MB. A user reading 20 papers/month pulls ~0.5 GB. At 1,000 such users that is ~500 GB/month: **$45/mo on S3, $0 on R2, $0 on B2-via-Cloudflare.** Storage itself is noise at this scale. Zero egress is not a rounding error, it is the whole decision.

**Serving mechanics that matter here.**

- **Signed URLs.** R2 supports S3-style presigned URLs for GET/HEAD/PUT/DELETE, **max 7 days (604,800 s)**, and — the gotcha — **only against the `<ACCOUNT_ID>.r2.cloudflarestorage.com` S3 endpoint, not custom domains**; POST form uploads are unsupported ([R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)). Presigned traffic therefore bypasses custom-domain CDN config. Serve cacheable assets (page images) via a custom domain with Worker-issued short-lived tokens so the cache works; reserve presigned S3-endpoint URLs for genuinely private artefacts (user-uploaded PDFs).
- **Range requests.** Audio scrubbing depends on HTTP `Range`; R2/B2/S3 are S3-API compatible and serve ranges. Still segment audiobooks per section so the player prefetches rather than range-seeking a 90-minute file.
- **Immutability.** Page images and figure crops are content-addressed derivatives — key them `sha256(pdf)/ir_v{n}/p{page}@{scale}.webp` with `Cache-Control: public, max-age=31536000, immutable`. IR version bumps then become a key-space change, not a cache-invalidation problem.
- **Do not put blobs in the database.** Postgres tolerates 1 GB fields; that is not permission.

---

## 5. Recommendation

### (a) Day one, tiny scale

- **PostgreSQL 17/18**, single instance. Local: Docker Compose (you already have one). Prod: a $12–24/mo VPS, or **Neon Free** (0.5 GB storage, 100 CU-hours, 5 GB egress) / **Supabase Pro $25/mo** for managed backups without ops. Neon Launch at **$0.106/CU-hour + $0.35/GB-mo** is honest pay-as-you-go; Supabase bundles storage + auth.
- **pgvector 0.8.5** in the same database. `halfvec` halves index memory at negligible recall cost. HNSW index; raise `maintenance_work_mem` to 1–2 GB *during builds* — the 64 MB default forces a disk-based build reported at 10–50× slower.
- **tsvector + pg_trgm**, indexed **per block/section**, not per paper (the 1 MB tsvector limit).
- **Cloudflare R2 from day one.** The free tier covers the first 10 GB, and the cost of moving off local disk grows every week you delay.
- **Retrieval = one SQL statement**: recursive-CTE structural filter → tsvector CTE + vector CTE → RRF. Write it as one query from the start; that is the interface you must preserve later.

Realistic day-one bill: **$0–$50/month** total. Compare MongoDB Atlas: M0 free is 512 MB with a **3-index cap** (search+vector combined) and Flex 5 GB is $8–$30/mo with a 10-index cap — and Vector Search at any scale wants dedicated **Search Nodes from ~$0.12–$0.15/hour** on top of the cluster ([Atlas pricing](https://www.mongodb.com/pricing)).

### (b) The shape it must grow into

1. **Postgres stays the system of record.** Every other store is a *derived, rebuildable index*. Enforce this as an architectural rule: if you cannot drop Qdrant and rebuild it from Postgres in an afternoon, you have made a mistake.
2. **Add `pgvectorscale`** when the embedding table exceeds RAM — StreamingDiskANN keeps part of the index on disk and does label filtering during traversal. PostgreSQL-licensed, so no legal work.
3. **Partition `blocks` and `embeddings` by `doc_version_id` range or hash** as papers accumulate; this also gives you cheap IR-version retirement (`DROP PARTITION`).
4. **Add Qdrant only when ColPali lands.** Store page-image multi-vectors there with `MAX_SIM`; keep block-level text embeddings in pgvector. Two-stage: Postgres does structural + keyword narrowing, Qdrant does late-interaction rerank over the surviving page set.
5. **FTS escalation ladder**, in order: tsvector (free, no IDF) → tsvector + a hand-rolled IDF term-weight table (surprisingly effective on a fixed corpus) → Tantivy/Lucene sidecar → pg_search **if and only if AGPL clears legal**.
6. **Blob**: R2 Standard for hot page images/audio, R2 Infrequent Access ($0.01/GB-mo, 30-day min) for original PDFs after ingestion.

---

## 6. Migration path from MongoDB, and its real cost

At PaperTree's current stage this is a **data-access-layer rewrite, not a database migration** — and that reframing is the cost saving.

1. **Audit types first.** Field type variance (a field that is sometimes string, sometimes array) is the commonest cause of blown estimates. Scan the *whole* collection with a `$type` aggregation before writing DDL — at your volume there is no reason to sample.
2. **Land raw.** `mongoexport` to JSONL → `COPY` into `staging.<coll>(doc jsonb)`. Minutes, not days. Staging stays as a rollback artefact until cutover is proven.
3. **Project.** `INSERT INTO blocks SELECT … FROM staging.documents, jsonb_to_recordset(doc->'blocks') AS b(...)`.
4. **Re-derive rather than migrate derived artefacts.** Page images, embeddings and audiobook segments are reproducible from the PDF; re-running ingestion is cheaper and cleaner than migrating them, and it validates the new IR version end-to-end. Migrate only the irreplaceable: users, uploaded PDFs, highlights, explanation trees, canvases.
5. **Highlights are the risky table.** Anchors must resolve against block IDs now issued by Postgres. **Preserve the original block IDs verbatim as `uuid`/`text` PKs** — that turns a re-anchoring project into a column copy. Otherwise you must write and test an anchor-remapping pass.
6. **Cutover.** Freeze writes, run the ETL, verify counts plus a sampled deep-diff, switch. Dual-write/CDC via the oplog is the zero-downtime route and is *not* worth its complexity pre-launch.

**Honest cost estimate: 3–7 engineer-days** if Motor calls are localised in a repository/DAO layer, 2–4 weeks if `motor` imports are scattered across route handlers. The schema design and the Pydantic↔SQLAlchemy boundary are the real work; the bytes move in minutes. **The migration is strictly cheaper now than at any future point**, and it is cheapest of all if done in the same pass as the next IR version bump, since you are rewriting the IR consumers anyway.

**Explicitly distrusted:** 2026 blog posts quoting "$8K–$80K", "100 GB → $150K–$250K", and "zero-downtime CDC adds $50K–$150K" (e.g. [groovyweb](https://www.groovyweb.co/blog/database-migration-mongodb-postgresql-pgvector-2026), [softwaremodernizationservices](https://softwaremodernizationservices.com/migrations/mongodb-to-postgresql/)) are **migration-vendor marketing pages** with unsourced figures describing enterprise estates with thousands of hand-written queries. Not a valid input here; cited only so they can be recognised and dismissed.

---

## 7. What I could not verify

- **pgvector indexable dimension limits.** Storage maxima are confirmed (`vector`/`halfvec` 16,000; `bit` 64,000; `sparsevec` 16,000 non-zero). The *indexable* limits (commonly cited as 2,000 for `vector` and 4,000 for `halfvec` under HNSW) appeared only in a secondary source and I did not confirm them against the README. **Check before committing to an embedding dimensionality.**
- **pgvectorscale latest version and release date.** The GitHub page did not surface a tag; a third-party wiki page said it was last indexed 2026-01-27. Verify the current release before pinning.
- **Qdrant Cloud per-resource pricing.** The pricing page publishes only the free-tier shape (0.5 vCPU / 1 GB RAM / 4 GB disk) and directs to a calculator. No per-GB or per-vCPU rate obtained.
- **Turbopuffer per-unit pricing.** The official pricing page showed only plan minimums (**Launch $16/mo**, Scale $256/mo, Enterprise ≥$4,096/mo) with a JS calculator that did not render. The "$0.02/GB storage" and a conflicting "Launch $64/mo" figure came from third-party blogs and **contradict** the official page — treat both as unverified. Turbopuffer multi-vector/late-interaction support: not verified.
- **AWS S3 exact rates.** The official S3 pricing page did not render its numeric tables to the fetcher. The $0.023/GB-mo (first 50 TB), $0.005/1k PUT, $0.0004/1k GET and ~$0.09/GB egress figures come from secondary aggregators; only the "first 100 GB/month egress free, aggregated across AWS services" statement was read from the AWS page directly. Verify in the console before budgeting.
- **Chroma Cloud read pricing.** Only the write price ($2.50/logical GiB) and a blog-sourced $0.02/GB-mo storage figure were obtained; the read rate was not.
- **MongoDB Atlas Search Node pricing** ($0.12–$0.15/hour) came from the pricing page summary and was not cross-checked against a per-region rate card.
- **Weaviate's per-million-vector-dimension rate.** The pricing page describes dimension-based billing and storage rates ($0.12–$0.1505/GiB) but the dimension rate itself was not extracted.
- **Chroma multi-vector / late-interaction support:** not verified either way.
- **No benchmarks were run.** All latency/recall/memory claims here (MUVERA's ~80 % memory reduction, HNSW build memory ≈ N·D·4·2, "10–50× slower disk-based builds") are **vendor- or blog-reported** and should be treated as directional only. PaperTree's actual retrieval quality on its own IR is unmeasured and should be benchmarked before the ColPali/Qdrant decision is taken.
- **AGPL applicability to Postgres extensions** (pg_search, VectorChord) in a hosted-SaaS context is a legal question I am not qualified to resolve and did not attempt to.
