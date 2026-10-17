/**
 * S5e (#210) — Dive in from the explain panel, against the real API, worker and web on the FAUX
 * agent (prototype steps 9–10):
 *
 *   upload Attention → an ask through the faux agent → that answer becomes THE STORED ANSWER (its
 *   four cited passages, `support.ts`) → the reader → the header's Explain opens the stored thread →
 *   Dive in on its answer → the page with the exchange and 4 quote cards → Back to the paper lands
 *   on the reader with the panel on that thread → a second Dive in opens the SAME page (one page on
 *   the server) → the tablet layout at 1180 × 820 (the rail, the page named in the bar) → at 390 the
 *   phone stack (the trace as rows, the bar's four tools, no eraser or lasso), a typed note added
 *   there survives a reload → axe at 1440, 1180 and 390, daylight and lamp-lit.
 *
 * The corpus PDF is fetched, not committed: the spec SKIPS, loudly, without it.
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

test.describe('S5e — Dive in, the tablet and phone notebook (faux agent)', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent; run research/benchmarks/fetch_corpus.sh.',
  );

  test('reader → stored thread → Dive in → 4 quote cards → Back lands on the thread', async ({
    browser,
    stack,
  }, testInfo) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const token = await register(stack.apiUrl, `e2e-s5e-${String(Date.now())}@papertree.test`);
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
    const threadId = thread!.thread_id;
    const detail = (await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/threads/${threadId}`))
      .json as { messages: { message_id: string; role: string }[] };
    const answerId = detail.messages.find((m) => m.role === 'assistant')!.message_id;
    const user = await userId(stack.apiUrl, token);
    expect(storeAnswer(stack.dataRoot, user, paperId, answerId)).toBe(4);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await tokenInit(page, token);

    // ── 2. the reader; the header's Explain opens the panel on the stored thread ──
    await page.goto(`/paper/${paperId}/read`);
    await expect(page.locator('.pt-reader').first()).toBeVisible();
    await page.locator('.pt-reader__explain').click();
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel.locator('.pt-exchange')).toHaveCount(1);
    await expect(panel.locator('.pt-trace-row')).toHaveCount(4);

    // ── 3. Dive in: one POST to the Dive-in route, then the page with its 4 quote cards ──
    const dive = panel.getByRole('button', { name: 'Dive in' });
    await dive.scrollIntoViewIfNeeded();
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith(`/papers/${paperId}/notebook/pages`),
    );
    await dive.click();
    const body = (await created).request().postDataJSON() as {
      page_id: string;
      from_message_id: string;
    };
    expect(body.from_message_id).toBe(answerId);
    const pageId = body.page_id;
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/notebook/${pageId}$`));
    const exchange = page.getByRole('region', { name: 'The exchange this page started from' });
    await expect(exchange).toBeVisible();
    await expect(page.locator('.pt-nb-quote')).toHaveCount(4);
    for (const n of [1, 2, 3, 4]) {
      await expect(page.locator(`.pt-nb-quote[data-passage="${String(n)}"]`)).toHaveCount(1);
    }
    // The arrival is over: nothing is left hidden or mid-slide.
    await expect(page.locator('.pt-nb[data-dive]')).toHaveCount(0);
    await page.screenshot({ path: shot('s5e-dived-1440.png') });

    // ── 4. Back to the paper: the reader, with the panel on the thread the page came from ──
    // The link names the thread; the reader consumes `?thread=` as soon as the panel opens on it (so a
    // reload does not reopen it), so the URL holds it only for a moment. Check the link and the outcome,
    // not that moment: polling for it raced the reader on CI (#335).
    const back = page.locator('.pt-nb__bar').getByRole('link', { name: /Back to the paper/ });
    await expect(back).toHaveAttribute(
      'href',
      new RegExp(`/paper/${paperId}/read\\?.*thread=${threadId}`),
    );
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/read(\\?|$)`));
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pt-exchange')).toHaveCount(1);
    await expect(panel.locator('.pt-call-slip')).toContainText(
      "What is the paper's central proposal?",
    );
    await expect(page).not.toHaveURL(/thread=/);

    // ── 5. a second Dive in opens the same page; the server holds one page for the answer ──
    await panel.getByRole('button', { name: 'Dive in' }).click();
    await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/notebook/${pageId}$`));
    await expect(page.locator('.pt-nb-quote')).toHaveCount(4);
    const pages = (await api(stack.apiUrl, token, 'GET', `/papers/${paperId}/notebook/pages`))
      .json as { page_id: string }[];
    expect(pages.map((p) => p.page_id)).toEqual([pageId]);

    // ── 6. the tablet (05b): the rail, the page named in the bar ──
    await page.setViewportSize({ width: 1180, height: 820 });
    const rail = page.getByRole('toolbar', { name: 'Notebook tools' });
    await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
    await expect(page.locator('.pt-nb__bar .pt-nb__title')).toContainText('Dive in:');
    await page.screenshot({ path: shot('s5e-tablet-1180.png') });

    // ── 7. the phone (08c): the stack, the bar's four tools, no eraser or lasso ──
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = page.locator('.pt-nb-stack');
    await expect(phone).toBeVisible();
    await expect(phone.locator('.pt-trace-row')).toHaveCount(4);
    await expect(phone.getByRole('button', { name: 'Read the whole answer' })).toBeVisible();
    const tools = page.getByRole('toolbar', { name: 'Notebook tools' });
    await expect(tools.getByRole('button')).toHaveText(['Text', 'Sticky', 'Highlight', 'Pen: off']);
    await expect(
      page.getByText('Lasso, shapes and templates: on a tablet or computer'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stroke eraser' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lasso' })).toHaveCount(0);
    await page.screenshot({ path: shot('s5e-phone-390.png') });

    // ── 8. a typed note added on the phone is saved, and is there after a reload ──
    const note = 'Typed on the phone: check §3.5.';
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/notebook/pages/${pageId}/items`),
    );
    await tools.getByRole('button', { name: 'Text' }).click();
    await page.getByRole('textbox', { name: 'Typed note' }).fill(note);
    await page.keyboard.press('Escape');
    expect((await saved).status()).toBe(201);
    await page.reload();
    await expect(phone.getByRole('button', { name: `Typed note: ${note}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stroke eraser' })).toHaveCount(0);

    // ── 9. axe: no serious or critical violation at 1440, 1180 and 390, daylight and lamp-lit ──
    for (const [width, height] of [
      [1440, 900],
      [1180, 820],
      [390, 844],
    ] as const) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme });
        await expect(page.locator(width < 768 ? '.pt-trace-row' : '.pt-nb-quote')).toHaveCount(4);
        expect(await axeSerious(page), `${String(width)} ${colorScheme}`).toEqual([]);
      }
    }
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
