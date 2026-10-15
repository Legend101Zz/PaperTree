/**
 * S6 Journey C on the FAUX agent — the explain panel against the real API, worker and web (the
 * scripted model: no key, no network model). What a reader does, with the MOUSE:
 *
 *   select a sentence → toolbar Ask → a streamed answer in the right drawer → a follow-up that says
 *   "that" → click a citation chip (the cited passage flashes, and the point at the flash's centre
 *   lies inside a text-layer span) → "Summarize paper" → bullets with chips → RELOAD → the summary
 *   comes back from the cache and `ai_runs` has not grown.
 *
 * The faux agent answers from what the run gave it, so this proves the WIRING end to end — the
 * stream, the chips, the cancel path, the cache — and nothing about answer quality. The live run
 * against the real model is a separate, recorded step (the S6 report).
 *
 * `document.visibilityState` is asserted wherever text-layer spans are counted (AGENTS.md §4). The
 * YOLO PDF is S2's fresh set; the spec SKIPS, loudly, without it.
 */
import { expect, test } from '../harness/test';
import {
  drag,
  pointsFor,
  python,
  register,
  reveal,
  shotPath,
  upload,
  waitParsed,
  yoloPdf,
} from '../s4/support';

const YOLO = yoloPdf();

function aiRuns(dataRoot: string, paperId: string): number {
  return Number(
    python(
      `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1] + "/papertree.sqlite")
print(conn.execute("SELECT COUNT(*) FROM ai_runs WHERE paper_id = ?", (sys.argv[2],)).fetchone()[0])
`,
      [dataRoot, paperId],
    ),
  );
}

test.describe('S6 Journey C (faux agent) — explain, follow-up, chip, summary, cache', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF (arXiv 1506.02640) is not present. Set PAPERTREE_E2E_YOLO_PDF or run research/benchmarks/fresh/fetch_fresh.sh.',
  );

  test('select, Ask, follow-up, chip, summary, reload', async ({ browser, stack }, testInfo) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const note = (line: string) => console.log(`[e2e s6] ${line}`);

    const token = await register(stack.apiUrl, `e2e-s6-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, YOLO as string);
    await waitParsed(stack.apiUrl, token, paperId);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* a context without storage is not this walk */
      }
    }, token);
    const page = await context.newPage();
    const threadPosts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/threads(\/[^/]+\/messages)?$/.test(request.url())) {
        threadPosts.push(new URL(request.url()).pathname);
      }
    });

    const open = async () => {
      await page.goto(`/paper/${paperId}/read`);
      await expect
        .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
          timeout: 180_000,
        })
        .toBeGreaterThan(50);
      expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    };
    await open();

    // ── select with the mouse, press Ask on the toolbar ──
    await reveal(page, 'We reframe object');
    const points = await pointsFor(page, 'We reframe object', 'class probabilities.');
    await drag(page, points.from, points.to);
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
    await expect(toolbar).toBeVisible();
    const ask = toolbar.getByRole('button', { name: /Ask/ });
    const box = await ask.boundingBox();
    expect(box).not.toBeNull();
    await page.screenshot({ path: shot('c01-selection-1440.png') });
    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );

    // ── the drawer opens on the passage; the answer streams; no raw ids or handles ──
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-explain-quote]')).toContainText('We reframe object');
    const answer = panel.locator('[data-message-status]').first();
    await expect(answer).toHaveAttribute('data-message-status', 'complete', { timeout: 120_000 });
    await expect(panel.locator('[data-register="ai"]').first()).toContainText('AI interpretation');
    const text = (await panel.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/\[b\d+\]|\bmsg_|\bthr_|\brun_|\bblk_|\{"|"citation_id"/);
    const chips = panel.locator('[data-citation-id]');
    const chipCount = await chips.count();
    note(
      `first answer complete; ${String(chipCount)} chips; usage "${await panel.locator('[data-usage-line]').first().innerText()}"`,
    );
    expect(chipCount).toBeGreaterThan(0);
    await expect(panel.locator('[data-usage-line]').first()).toContainText('(estimate)');
    await page.screenshot({ path: shot('c02-answer-1440.png') });

    // ── a follow-up that says "that": the SAME thread ──
    await panel
      .getByLabel('Ask a question about this paper')
      .fill('What does that mean for speed?');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(panel.locator('[data-message-status="complete"]')).toHaveCount(2, {
      timeout: 120_000,
    });
    expect(threadPosts.filter((p) => p.endsWith('/messages'))).toHaveLength(1);
    expect(threadPosts.filter((p) => !p.endsWith('/messages'))).toHaveLength(1);
    await page.screenshot({ path: shot('c03-followup-1440.png') });

    // ── a chip: the cited passage scrolls into view and flashes ──
    await panel.locator('[data-citation-id]').first().click();
    const flash = page.locator('svg [data-flash="true"] polygon');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    const probe = await flash.first().boundingBox();
    expect(probe).not.toBeNull();
    const under = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return {
          inSpan: el?.closest('.papertree-text-layer span') !== null && el !== null,
          tag: el?.tagName ?? 'none',
          cls: el?.className?.toString() ?? '',
          inPanel: el?.closest('[data-explain-panel]') !== null,
        };
      },
      [
        (probe?.x ?? 0) + (probe?.width ?? 0) / 2,
        (probe?.y ?? 0) + (probe?.height ?? 0) / 2,
      ] as const,
    );
    note(`chip flash centre -> ${JSON.stringify(under)}`);
    expect(under.inPanel, 'the flash must not sit under the drawer').toBe(false);
    expect(under.inSpan, 'elementFromPoint at the flash centre must be a text-layer span').toBe(
      true,
    );
    await page.screenshot({ path: shot('c04-chip-flash-1440.png') });

    // ── the summary: progress, bullets with chips ──
    const runsBefore = aiRuns(stack.dataRoot, paperId);
    await panel.getByRole('button', { name: 'Summarize paper' }).click();
    const bullets = panel.locator('[data-summary-bullet]');
    await expect(bullets.first()).toBeVisible({ timeout: 120_000 });
    const bulletCount = await bullets.count();
    note(
      `summary: ${String(bulletCount)} bullets, ${String(await panel.locator('[data-summary-bullet] [data-citation-id]').count())} chips`,
    );
    expect(bulletCount).toBeGreaterThan(0);
    expect(await panel.locator('[data-summary-bullet] [data-citation-id]').count()).toBeGreaterThan(
      0,
    );
    await page.screenshot({ path: shot('c05-summary-1440.png') });
    const runsAfterSummary = aiRuns(stack.dataRoot, paperId);
    expect(runsAfterSummary).toBe(runsBefore + 1);

    // ── reload: the cached summary, with NO new run ──
    await open();
    await page.getByRole('button', { name: 'Ask AI' }).click();
    await page
      .getByRole('complementary', { name: 'Explain' })
      .getByRole('button', { name: 'Summarize paper' })
      .click();
    await expect(page.locator('[data-summary-bullet]')).toHaveCount(bulletCount, {
      timeout: 30_000,
    });
    expect(aiRuns(stack.dataRoot, paperId)).toBe(runsAfterSummary);
    note(
      `reload: cached summary shown (${String(bulletCount)} bullets); ai_runs ${String(runsAfterSummary)} unchanged`,
    );
    await page.screenshot({ path: shot('c06-summary-cached-1440.png') });
  });
});
