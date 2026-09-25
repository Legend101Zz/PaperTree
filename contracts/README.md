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
