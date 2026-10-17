/**
 * e2e/v02 — helpers for the notebook walk (S5c, #208).
 *
 * `storeAnswer` turns an answer the faux agent wrote into THE STORED ANSWER (the demo thread's real
 * words and its four cited passages, `services/api/python/tests/data/attention_explain_answer.json`)
 * through the server's own path: Anchors minted by `capture_citation` against this parse, written
 * with `PaperTreeDb.update_message` and `put_citations` (their handle check and resolution strip
 * included), exactly as the API tests mint citations. No SQL by hand, no hand-built Anchor.
 */
import { join } from 'node:path';

import { python, REPO } from '../s4/support';

/** The stored demo answer the walk dives into. */
export const STORED_ANSWER = join(
  REPO,
  'services',
  'api',
  'python',
  'tests',
  'data',
  'attention_explain_answer.json',
);

/**
 * Gives an assistant message the stored answer's words and citations, through the server's path.
 *
 * @param dataRoot - The stack's data root.
 * @param userId - The message's owner (`GET /auth/me`).
 * @param paperId - The paper (its promoted parse mints the Anchors).
 * @param messageId - The assistant message to rewrite.
 * @returns How many citations were stored.
 */
export function storeAnswer(
  dataRoot: string,
  userId: string,
  paperId: string,
  messageId: string,
): number {
  const out = python(
    `
import json, sys, uuid
from datetime import UTC, datetime
from pathlib import Path
from papertree_anchoring import capture_citation
from papertree_api.evidence import DocumentCache
from papertree_db import PaperTreeDb
from papertree_db.ai import CitationIn

root, user, pid, mid, stored_path = sys.argv[1:6]
stored = json.loads(Path(stored_path).read_text())
db = PaperTreeDb(Path(root) / "papertree.sqlite")
try:
    owner = db.owner_for(user)
    gen = db.promoted_generation(owner, pid)
    doc = DocumentCache().get(db, owner, user, pid, gen)
    if doc is None:
        raise SystemExit("no parse to mint Anchors against")
    at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    cites = []
    for c in stored["citations"]:
        cid = "cit_" + uuid.uuid4().hex[:26].upper()
        anchor = capture_citation(doc, c["block_id"], citation_id=cid, at=at)
        cites.append(CitationIn(citation_id=cid, ordinal=c["ordinal"], marker=c["marker"],
                                anchor=dict(anchor), generation=int(gen), block_id=c["block_id"],
                                page_index=c["page_index"], supported=c["supported"]))
    db.update_message(owner, mid, content=stored["content"])
    db.put_citations(owner, mid, cites)
finally:
    db.close()
print(len(cites))
`,
    [dataRoot, userId, paperId, messageId, STORED_ANSWER],
  );
  return Number(out);
}
