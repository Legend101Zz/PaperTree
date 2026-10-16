/**
 * S5c (#208) — the Dive-in notebook page against the real API, worker and web, on the FAUX agent.
 *
 *   upload Attention → an ask through the faux agent → that answer becomes THE STORED ANSWER (the
 *   demo thread's real words and its four cited passages, `tests/data/attention_explain_answer.json`,
 *   with Anchors built from this parse) → the reader opens → Dive in (through the API: the button is
 *   S5e's, #210) → the page shows the exchange with 4 quote cards numbered 1–4 → a typed note →
 *   reload → it is still there.
 *
 * The faux agent cites at most two passages, so the stored answer is written into SQLite through
 * the workspace's Python; everything the page then does goes through the real routes. The corpus
 * PDF is fetched, not committed: the spec SKIPS, loudly, without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { python, register, REPO, shotPath, upload, waitParsed } from '../s4/support';
import { api, tokenInit } from '../s7/support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const STORED = join(
  REPO,
  'services',
  'api',
  'python',
  'tests',
  'data',
  'attention_explain_answer.json',
);

interface StoredAnswer {
  readonly content: string;
  readonly citations: readonly {
    readonly ordinal: number;
    readonly marker: string;
    readonly block_id: string;
    readonly generation: number;
    readonly page_index: number;
  }[];
}

interface IrBlock {
  readonly block_id: string;
  readonly page_index: number;
  readonly text: string;
  readonly text_normalised: string;
  readonly content_hash: string;
}

/** An Anchor on a whole block of this parse, as the server mints citation Anchors. */
function blockAnchor(paperId: string, sourceHash: string, block: IrBlock, id: string): unknown {
  return {
    anchorVersion: 1,
    offsetUnit: 'unicode',
    id,
    doc: {
      paperId,
      pdfSha256: sourceHash,
      parserVersion: '1.0.0',
      textStreamId: `api/${paperId}/g1/1.0.0`,
    },
    targetKind: 'text',
    provenanceClass: 'source',
    selectors: [
      { type: 'BlockSelector', blockId: block.block_id, blockTextHash: block.content_hash },
      { type: 'PageSelector', index: block.page_index },
      {
        type: 'TextQuoteSelector',
        exact: block.text,
        prefix: '',
        suffix: '',
        exactNormalised: block.text_normalised.replace(/\s+/g, ''),
      },
    ],
    created: { mode: 'source', at: new Date().toISOString(), client: 'e2e/v02' },
  };
}

/** Replaces one assistant message's words and citations with the stored answer's. */
function storeAnswer(
  dataRoot: string,
  messageId: string,
  content: string,
  citations: unknown[],
): void {
  python(
    `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1] + "/papertree.sqlite")
mid, content, cites = sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
owner = conn.execute("SELECT owner_id FROM ai_messages WHERE message_id = ?", (mid,)).fetchone()[0]
conn.execute("UPDATE ai_messages SET content = ? WHERE message_id = ?", (content, mid))
conn.execute("DELETE FROM ai_citations WHERE message_id = ?", (mid,))
for c in cites:
    conn.execute(
        "INSERT INTO ai_citations (citation_id, owner_id, message_id, ordinal, marker, anchor_json,"
        " generation, block_id, page_index, supported) VALUES (?,?,?,?,?,?,?,?,?,1)",
        (c["anchor"]["id"], owner, mid, c["ordinal"], c["marker"], json.dumps(c["anchor"]),
         c["generation"], c["block_id"], c["page_index"]),
    )
conn.commit()
`,
    [dataRoot, messageId, content, JSON.stringify(citations)],
  );
}

test.describe('S5c — the notebook page (faux agent)', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent; run research/benchmarks/fetch_corpus.sh.',
  );

  test('Dive in, four quote cards, a typed note that survives a reload', async ({
    browser,
    stack,
  }, testInfo) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const token = await register(stack.apiUrl, `e2e-s5c-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);

    // ── 1. an answer through the faux agent, then the stored answer's words and passages ──
    const stream = await fetch(`${stack.apiUrl}/papers/${paperId}/threads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ kind: 'ask', question: "What is the paper's central proposal?" }),
    });
    expect(stream.status).toBe(200);
    await stream.text();
    const [thread] = (await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/threads`)).json as {
      thread_id: string;
    }[];
    const detail = (
      await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/threads/${thread!.thread_id}`)
    ).json as {
      messages: { message_id: string; role: string }[];
    };
    const answerId = detail.messages.find((m) => m.role === 'assistant')!.message_id;
    const stored = JSON.parse(readFileSync(STORED, 'utf8')) as StoredAnswer;
    const ir = (await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/ir`)).json as {
      source_hash: string;
      blocks: IrBlock[];
    };
    const cites = stored.citations.map((c) => {
      const block = ir.blocks.find((b) => b.block_id === c.block_id);
      if (block === undefined)
        throw new Error(`block ${c.block_id} is not in this parse: the parser moved`);
      return {
        ...c,
        anchor: blockAnchor(
          paperId,
          ir.source_hash,
          block,
          `cit_e2e${c.marker}${String(Date.now())}`,
        ),
      };
    });
    storeAnswer(stack.dataRoot, answerId, stored.content, cites);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await tokenInit(page, token);

    // ── 2. the reader, then Dive in from the stored answer ──
    await page.goto(`/paper/${paperId}/read`);
    await expect(page.locator('.pt-reader').first()).toBeVisible();
    const pageId = `np_${crypto.randomUUID()}`;
    const dived = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/notebook/pages`, {
      page_id: pageId,
      from_message_id: answerId,
    });
    expect(dived.status, JSON.stringify(dived.json)).toBe(201);

    // ── 3. the page: the exchange, and one quote card per passage, numbered as the markers ──
    await page.goto(`/paper/${paperId}/notebook/${pageId}`);
    const exchange = page.getByRole('region', { name: 'The exchange this page started from' });
    await expect(exchange).toBeVisible();
    await expect(exchange.locator('[data-voice="you"]').first()).toBeVisible();
    await expect(exchange.locator('[data-voice="ai"]')).toBeVisible();
    await expect(page.locator('.pt-nb-quote')).toHaveCount(4);
    for (const n of [1, 2, 3, 4]) {
      await expect(page.locator(`.pt-nb-quote[data-passage="${String(n)}"]`)).toHaveCount(1);
    }
    await expect(exchange).toContainText('Stands on 4 passages · 11 citations');
    await page.screenshot({ path: shot('s5c-notebook-1440.png') });

    // ── 4. a typed note, saved, and still there after a reload ──
    const note = 'Check §3.5 positional encoding (p. 6).';
    await page.getByRole('button', { name: 'Text' }).click();
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/notebook/pages/${pageId}/items`),
    );
    await page.getByRole('textbox', { name: 'Typed note' }).fill(note);
    await page.keyboard.press('Escape');
    expect((await saved).status()).toBe(201);
    await page.reload();
    await expect(page.getByRole('button', { name: `Typed note: ${note}` })).toBeVisible();
    await context.close();
  });
});
