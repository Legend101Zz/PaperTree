/**
 * S5d (#209) — ink on the notebook page against the real API and web (no agent needed):
 *
 *   upload Attention → a page (`POST /papers/{id}/notebook/pages`) → pick up the pen → draw a
 *   stroke with the mouse → its POST lands → reload → the stroke is there, at the same place →
 *   the stroke eraser across it → its DELETE lands → reload → gone → axe with the ink tools out,
 *   at 1440 and 390, daylight and lamp-lit.
 *
 * The corpus PDF is fetched, not committed: the spec SKIPS, loudly, without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, upload, waitParsed } from '../s4/support';
import { api, tokenInit } from '../s7/support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const AXE = join(REPO, 'apps', 'web', 'node_modules', 'axe-core', 'axe.min.js');

test.describe('S5d — ink on the notebook page', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent; run research/benchmarks/fetch_corpus.sh.',
  );

  test('a drawn stroke survives a reload, and an erased one stays gone', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(300_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const token = await register(stack.apiUrl, `e2e-s5d-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);
    const pageId = `np_${crypto.randomUUID()}`;
    const created = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/notebook/pages`, {
      page_id: pageId,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await tokenInit(page, token);
    await page.goto(`/paper/${paperId}/notebook/${pageId}`);
    const tools = page.getByRole('toolbar', { name: 'Notebook tools' });
    await expect(tools).toBeVisible();

    // ── 1. the pen, a stroke with the mouse, saved ──
    const pen = tools.getByRole('button', { name: 'Pen', exact: true });
    await pen.click();
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    const box = (await page.locator('.pt-nb-surface').boundingBox())!;
    const [x0, y0] = [box.x + 200, box.y + 160];
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url().endsWith(`/notebook/pages/${pageId}/strokes`),
    );
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 24; i += 1) await page.mouse.move(x0 + i * 10, y0 + (i % 6) * 4);
    await page.mouse.up();
    expect((await saved).status()).toBe(201);
    const ink = page.locator('.pt-nb-ink [data-stroke-id]');
    await expect(ink).toHaveCount(1);
    const drawn = (await ink.boundingBox())!;
    await page.screenshot({ path: shot('s5d-ink-drawn-1440.png') });

    // ── 2. reload: the stroke is there, where it was drawn ──
    await page.reload();
    await expect(ink).toHaveCount(1);
    const back = (await ink.boundingBox())!;
    expect(Math.abs(back.x - drawn.x) + Math.abs(back.y - drawn.y)).toBeLessThan(1.5);
    const stored = (await api(stack.apiUrl, token, 'GET', `/notebook/pages/${pageId}`)).json as {
      strokes: { tool: string; colour: string }[];
    };
    expect(stored.strokes).toMatchObject([{ tool: 'pen', colour: 'pen' }]);

    // ── 3. the stroke eraser across it: one DELETE ──
    await tools.getByRole('button', { name: 'Stroke eraser' }).click();
    const erased = page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' && r.url().includes(`/notebook/pages/${pageId}/strokes/`),
    );
    await page.mouse.move(x0 + 120, y0 - 30);
    await page.mouse.down();
    await page.mouse.move(x0 + 120, y0 + 60, { steps: 8 });
    await page.mouse.up();
    expect((await erased).status()).toBe(204);
    await expect(ink).toHaveCount(0);

    // ── 4. reload: still gone ──
    await page.reload();
    await expect(tools).toBeVisible();
    await expect(ink).toHaveCount(0);

    // ── 5. axe with the ink tools out ──
    await tools.getByRole('button', { name: 'Highlighter' }).click();
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme });
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
