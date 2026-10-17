/**
 * S5c (#208) — the Dive-in notebook page against the real API, worker and web, on the FAUX agent.
 *
 *   upload Attention → an ask through the faux agent → that answer becomes THE STORED ANSWER (the
 *   demo thread's real words and its four cited passages, with Anchors minted by `capture_citation`
 *   against this parse and stored by `update_message` / `put_citations`: `support.ts`) → the reader
 *   opens → Dive in (through the API: the button is S5e's, #210) → the page shows the exchange with
 *   4 quote cards numbered 1–4 → "Show all" opens the answer and the cards move below it → Open
 *   source flashes passage 2 in the reader → a typed note → reload → it is still there → axe at
 *   1440 and 390 in both schemes → Send page to board → the board holds one notebook card pointing
 *   at the page, and the board shows it.
 *
 * The faux agent cites at most two passages, hence the stored answer; everything the page then does
 * goes through the real routes. The corpus PDF is fetched, not committed: the spec SKIPS, loudly,
 * without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, upload, userId, waitParsed } from '../s4/support';
import { api, tokenInit } from '../s7/support';
import { storeAnswer } from './support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const AXE = join(REPO, 'apps', 'web', 'node_modules', 'axe-core', 'axe.min.js');

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
    const user = await userId(stack.apiUrl, token);
    expect(storeAnswer(stack.dataRoot, user, paperId, answerId)).toBe(4);

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

    // ── 3b. "Show all" opens the answer, and the cards move below it instead of covering it ──
    await exchange.getByRole('button', { name: 'Show all 5 paragraphs' }).click();
    await expect(exchange.getByRole('button', { name: 'Collapse' })).toBeVisible();
    const slip = exchange.locator('.pt-ai-slip');
    const slipBox = (await slip.boundingBox())!;
    const cardBox = (await page.locator('.pt-nb-quote').first().boundingBox())!;
    expect(cardBox.y).toBeGreaterThanOrEqual(slipBox.y + slipBox.height);
    const last = exchange.locator('.pt-ai-slip__text').last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = (await last.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('.pt-ai-slip') !== null,
      [lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2] as const,
    );
    expect(hit, 'the point in the last paragraph is the answer, not a card over it').toBe(true);
    await page.screenshot({ path: shot('s5c-notebook-expanded-1440.png'), fullPage: true });
    await exchange.getByRole('button', { name: 'Collapse' }).click();

    // ── 3c. Open source on card 2: the reader opens on the paper and flashes passage 2 ──
    await page.getByRole('button', { name: 'Open source: show passage 2 in the paper' }).click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/read\\?nb=${pageId}&item=`));
    // The flash, or the faint outline it leaves (S4b's phases): either proves it resolved.
    await expect(page.locator('[data-flash]').first()).toBeAttached();
    await page.goBack();
    await expect(page.locator('.pt-nb-quote')).toHaveCount(4);

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

    // ── 4b. a sticky typed and never blurred survives its tab being closed (pagehide, keepalive) ──
    const closing = await context.newPage();
    await tokenInit(closing, token);
    await closing.goto(`/paper/${paperId}/notebook/${pageId}`);
    await expect(closing.locator('.pt-nb-quote')).toHaveCount(4);
    const kept = 'typed, then the tab was closed';
    await closing.getByRole('button', { name: 'Sticky note' }).click();
    await closing.getByRole('textbox', { name: 'Sticky note' }).fill(kept);
    await closing.close({ runBeforeUnload: true });
    await expect
      .poll(async () => {
        const view = (await api(stack.apiUrl, token, 'GET', `/notebook/pages/${pageId}`)).json as {
          items: { body: string }[];
        };
        return view.items.some((i) => i.body === kept);
      })
      .toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: `Sticky note: ${kept}` })).toBeVisible();

    // ── 4c. a note too long for keepalive makes the page warn before it closes ──
    const long = await context.newPage();
    await tokenInit(long, token);
    await long.goto(`/paper/${paperId}/notebook/${pageId}`);
    await expect(long.locator('.pt-nb-quote')).toHaveCount(4);
    await long.getByRole('button', { name: 'Text' }).click();
    await long.getByRole('textbox', { name: 'Typed note' }).fill('x'.repeat(70_000));
    const warned = long.waitForEvent('dialog');
    await long.close({ runBeforeUnload: true });
    const dialog = await warned;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await long.getByRole('textbox', { name: 'Typed note' }).press('Escape');
    await expect(long.getByRole('button', { name: /^Typed note: x{100}/ })).toBeVisible();
    await long.waitForTimeout(1000);
    await long.close();

    // ── 5. axe: no serious or critical violation at 1440 and 390, daylight and lamp-lit ──
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme });
        // A phone reads the page as a stack (S5e, #210): the four passages are its trace rows.
        await expect(page.locator(width < 768 ? '.pt-trace-row' : '.pt-nb-quote')).toHaveCount(4);
        expect(await axeSerious(page), `${String(width)} ${colorScheme}`).toEqual([]);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });

    // ── 6. Send page to board: the board holds one notebook card that points at this page ──
    await page.locator('.pt-nb__bar').getByRole('button', { name: 'Send page to board' }).click();
    await expect(page.getByText('The page is on the board now, as one card.')).toBeVisible();
    const board = (await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/board`)).json as {
      nodes: { kind: string; source_page_id: string | null; counts: { quotes: number } | null }[];
    };
    const cards = board.nodes.filter((n) => n.kind === 'notebook');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ source_page_id: pageId, counts: { quotes: 4 } });
    await expect(page.getByRole('complementary', { name: 'Page' })).toContainText('4 quotes');
    expect(await axeSerious(page), 'with the board card in the panel').toEqual([]);
    await page.getByRole('button', { name: 'Open board' }).click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/board$`));
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    await page.screenshot({ path: shot('s5c-board-with-notebook-card-1440.png') });
    await context.close();
  });
});

/** axe-core's serious and critical violations on the page (axe from apps/web's devDependencies). */
async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: readFileSync(AXE, 'utf8') });
  return page.evaluate(async () => {
    const run = (
      window as unknown as { axe: { run: (c: Document, o: object) => Promise<AxeResults> } }
    ).axe.run;
    const results = await run(document, { resultTypes: ['violations'] });
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

interface AxeResults {
  readonly violations: readonly {
    readonly id: string;
    readonly impact: string | null;
    readonly nodes: readonly { readonly target: readonly string[] }[];
  }[];
}
