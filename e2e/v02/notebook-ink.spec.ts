/**
 * S5d (#209) — ink on the notebook page against the real API and web (no agent needed):
 *
 *   upload Attention → a page (`POST /papers/{id}/notebook/pages`) → pick up the pen → draw a
 *   stroke with the mouse → its POST lands → reload → the stroke is there, at the same place →
 *   the stroke eraser across it → its DELETE lands → reload → gone → a typed note → the lasso
 *   round it → the menu → axe with the tool bar and the lasso menu open, at 1440 and 1180, daylight
 *   and lamp-lit → Make sticky → reload → the note is a sticky.
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

  test('a stroke survives a reload, an erased one stays gone, a lassoed note becomes a sticky', async ({
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

    // ── 5. a typed note, and the lasso round it: the menu opens on Ask about this ──
    const words = 'Q: without recurrence, how does it know word order?';
    await tools.getByRole('button', { name: 'Text', exact: true }).click();
    const typed = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/notebook/pages/${pageId}/items`),
    );
    await page.getByRole('textbox', { name: 'Typed note' }).fill(words);
    await page.keyboard.press('Escape');
    expect((await typed).status()).toBe(201);
    const note = (await page.getByRole('button', { name: `Typed note: ${words}` }).boundingBox())!;
    await page.keyboard.press('l');
    await page.mouse.move(note.x - 16, note.y - 16);
    await page.mouse.down();
    for (const [x, y] of [
      [note.x + note.width + 16, note.y - 16],
      [note.x + note.width + 16, note.y + note.height + 16],
      [note.x - 16, note.y + note.height + 16],
      [note.x - 18, note.y - 10],
    ] as const) {
      await page.mouse.move(x, y, { steps: 6 });
    }
    await page.mouse.up();
    const menu = page.getByRole('menu', { name: 'Lasso selection: 1 note' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Ask about this' })).toBeFocused();
    await page.screenshot({ path: shot('s5d-lasso-menu-1440.png') });

    // ── 6. axe with the tool bar and the lasso menu open, on the desktop and on the tablet's rail.
    //    The phone does not offer the lasso (S5e, #210: it is put down there, and the stack shows);
    //    notebook-dive.spec checks the phone. ──
    for (const [width, height] of [
      [1440, 900],
      [1180, 820],
    ] as const) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height });
        await scheme(page, colorScheme);
        await expect(menu).toBeVisible();
        // All five actions on screen, beside the rail too.
        const at = (await menu.boundingBox())!;
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x + at.width).toBeLessThanOrEqual(width);
        expect(at.y + at.height).toBeLessThanOrEqual(height);
        expect(await axeSerious(page), `${String(width)} ${colorScheme}`).toEqual([]);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await scheme(page, 'light');

    // ── 7. Make sticky: the note becomes a sticky, and stays one after a reload ──
    const stuck = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/notebook/pages/${pageId}/items`),
    );
    await menu.getByRole('menuitem', { name: 'Make sticky' }).click();
    expect((await stuck).status()).toBe(201);
    await expect(page.getByRole('button', { name: `Sticky note: ${words}` })).toBeVisible();
    await expect
      .poll(async () => {
        const view = (await api(stack.apiUrl, token, 'GET', `/notebook/pages/${pageId}`)).json as {
          items: { kind: string; body: string }[];
        };
        return view.items.map((i) => `${i.kind}:${i.body}`);
      })
      .toEqual([`sticky:${words}`]);
    await page.reload();
    await expect(page.getByRole('button', { name: `Sticky note: ${words}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Typed note: ${words}` })).toHaveCount(0);
    await context.close();
  });
});

/**
 * Daylight or lamp-lit, as the "Aa" choice sets it (`data-pt-theme`). An OS scheme emulated after
 * load does not reach a page that does not mount `useTheme` (the no-flash script reads it once), so
 * the spec sets the choice itself, and checks that the lamp-lit page colour really applies.
 */
async function scheme(page: Page, colorScheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme });
  await page.evaluate(
    (s) => document.documentElement.setAttribute('data-pt-theme', s),
    colorScheme,
  );
  const ground = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--pt-page').trim(),
  );
  expect(ground).toBe(colorScheme === 'dark' ? '#2c251f' : '#faf8f3');
  // Buttons fade their background (`.pt-button` transition): axe must see the colours they settle
  // on, not a frame of the fade (a loaded machine showed a false contrast failure there).
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
}

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
