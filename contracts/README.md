# contracts/

The reader release's wire contracts. The spec is `contracts.md` (ADR-002's companion); this
directory holds the committed schemas and recordings that tests hold both sides of each wire to.
They change only through a contracts PR (slice-plan §0).

| Path | What | Written by | Checked by |
|---|---|---|---|
| `api/*.schema.json` | Every §2 request and response body, the §2.6 browser SSE `data`, the §0 error envelope | **generated**: `uv run python -m papertree_api.contracts export` from `services/api/python/papertree_api/schemas.py` | `services/api/python/tests/test_contract_schemas.py` (drift), `apps/web/test/contracts.spec.ts` (the web's types, with ajv) |
| `agent/run-request.schema.json` | `POST /v1/runs` body (§3.2) | by hand | `tests/test_agent_contracts.py` (+ pydantic `AgentRunRequest`), `contracts.spec.ts` |
| `agent/run-events.schema.json` | the agent's SSE events (§3.2); validates a parsed frame `{event, data}` | by hand | the same two |
| `agent/internal-tools.schema.json` | the four §4 paper tools: params, `ToolResult`, errors | by hand | the same two |
| `agent/fixtures/*.sse` | eight recorded agent streams (YOLO) in the exact §3.2 framing | by hand | framing, pydantic, the schema, and the semantics (deltas = final text, markers = the regex, totals = the sum, one `: ping` per 5 s) |
| `agent/examples/run-request-*.json` | the requests of `explain-ok`, `followup-ok`, `summary-ok` | by hand | both checkers |
| `anchor/anchor-v1.schema.json` | the persisted Anchor (§6): `@papertree/anchoring`'s `Anchor` v1 minus `resolution` | by hand, from `packages/anchoring/src/types.ts` | `packages/anchoring/test/anchor-schema.spec.ts` (every `captureAnchor()` output, with ajv), `tests/test_anchor_examples.py` (field-by-field against pydantic's `AnchorV1`) |
| `anchor/examples/*.json` | real stored anchors | `anchor-schema.spec.ts` (captures); `tests/test_anchor_examples.py` (`legacy-0001`, from a real 0005 migration) | pydantic `AnchorV1` must accept every one; ajv too |

## Regenerating

Every drift check compares **parsed JSON**, so prettier's formatting is never drift. After writing
any JSON here, format it:

```bash
uv run python -m papertree_api.contracts export          # contracts/api, only files that changed
PAPERTREE_WRITE_ANCHOR_EXAMPLES=1 pnpm --filter @papertree/anchoring test   # capture examples
PAPERTREE_WRITE_ANCHOR_EXAMPLES=1 uv run pytest services/api/python/tests/test_anchor_examples.py
pnpm exec prettier --write contracts
```

A stale example or schema fails its test with the command to run; review the diff it produces.
No Python JSON Schema validator is locked (§0: no new Python dependency), so the Python tests use
`services/api/python/tests/jsonschema_lite.py`, which refuses any keyword it does not implement.

## One answer, not one refusal

Two checkers of one record must ACCEPT the same things, or one side stores what the other
refuses (S0 review M1: the pydantic models took an explicit `null` in every optional field that
every schema here refuses, and a highlight with `"subTarget": null` was stored). So beside the
drift test, the answers are compared: `test_contract_schemas.py` (every omittable field's `null`,
against every schema that describes the model), `test_anchor_examples.py` (34 anchor mutations,
`AnchorV1` against `anchor-v1.schema.json`) and `test_agent_contracts.py` (21 edge frames,
`parse_agent_event` against `run-events.schema.json`). The one known difference is on purpose and
pinned: JSON Schema's `integer` takes `2.0`, strict pydantic does not (the schema is the wider).

## Statuses §2.9 does not list

§2.9 ties each code to a status. Four responses have a status no code carries; each keeps its
HTTP status and gets the nearest code, never a guessed one. A proposed addition to §2.9 for the
next contracts PR:

| Response | Status | `code` | Why |
|---|---|---|---|
| a known path, a method it does not serve | 405 (`Allow` kept) | `not_found` | "no such route", as far as a client can act |
| `GET /healthz`, database unreadable | 503 | `internal`, `retryable: true` | not the agent's (`agent_unavailable`) and not configuration's (`not_configured`) |
| `POST /papers/{id}/ask` (pre-release, removed in S5), provider errors | 502 / 504 | `internal` | kept from the pre-release route until S5 deletes it |
| `not_implemented` (an S0 addition to the enum) | 501 | `not_implemented` | every §2 route a later slice builds answers it until then |

A body no parser can read (FastAPI's "There was an error parsing the body", Starlette's
multipart errors) is NOT in this table: it is the 422 `validation_failed` every other bad body
gets (`body: the request body could not be parsed`), not a 400.
