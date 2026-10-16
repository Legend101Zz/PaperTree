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
    // #203: Explain runs the answer now (v0.1's Ask); the toolbar's Ask waits for a question.
    const ask = toolbar.getByRole('button', { name: 'Explain this passage' });
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
    // #202: the answer is an AI slip (the AI's voice), its citations numbered passage markers.
    await expect(panel.locator('[data-voice="ai"]').first()).toBeVisible();
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

    // ── a marker: the cited passage scrolls into view and flashes ──
    await panel.locator('[data-citation-id]').first().click();
    const flash = page.locator('svg [data-flash="true"] polygon');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    // Every polygon of the flash, sampled on a grid INSIDE its box. A passage of two lines is one
    // polygon whose box centre is the gap between the lines, so a single centre point proves
    // nothing; the grid hits the text lines, and what is under them must be the page's text layer.
    const boxes = await flash.evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    const under = await page.evaluate((all) => {
      const hits: string[] = [];
      let samples = 0;
      let inPanel = 0;
      for (const box of all) {
        for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
          for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            samples += 1;
            const el = document.elementFromPoint(box.x + box.width * fx, box.y + box.height * fy);
            if (el === null) continue;
            if (el.closest('[data-explain-panel]') !== null) inPanel += 1;
            const span = el.closest('.papertree-text-layer span');
            if (span !== null) hits.push((span.textContent ?? '').trim().slice(0, 40));
          }
        }
      }
      return { samples, inPanel, spanHits: hits.length, spans: Array.from(new Set(hits)) };
    }, boxes);
    note(`chip flash: ${String(boxes.length)} polygon(s), ${JSON.stringify(under)}`);
    expect(under.inPanel, 'the flash must not sit under the drawer').toBe(0);
    expect(
      under.spanHits,
      'the points inside the flash must land on the page text layer (the cited passage)',
    ).toBeGreaterThan(0);
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
    // #203: the header's Explain toggle opens the panel (it replaced the floating "Ask AI").
    await page.getByRole('button', { name: 'Explain', exact: true }).click();
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

    // ── Esc closes the drawer and focus goes back to the header's Explain toggle, not <body> ──
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Explain' })).toHaveCount(0);
    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? 'none',
      text: (document.activeElement?.textContent ?? '').trim(),
    }));
    note(`after Esc, focus is on ${JSON.stringify(focused)}`);
    expect(focused).toEqual({ tag: 'BUTTON', text: 'Explain' });
    await expect(page.getByRole('button', { name: 'Explain', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
