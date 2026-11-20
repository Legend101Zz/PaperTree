/**
 * v0.3 #344 / #342 / #349 - the split view, journey step 7 of #347 (and step 9's "p. 3" click), on
 * the real stack with the faux agent.
 *
 * "Attention Is All You Need", abstract. Select a passage, Send to board, Board beside: the paper
 * stays on the left, the real board opens on the right with the card in the middle of the pane (the
 * card and its open ask box as a pair), glowing once. The divider drags and takes the keyboard, is
 * remembered; either side folds to a strip; B toggles the board; Explain and the board share the
 * right side; Esc closes the board on its own level. A passage dragged across the divider lands
 * where it is dropped. A card's "p. n" flashes the paper while the board stays put, and the first
 * branch widens the board by folding the paper to a strip, one click to restore.
 *
 * The corpus PDF is fetched, not committed; the spec SKIPS, loudly, without it. Nothing here
 * asserts the faux agent's words, only the structure the board builds from them.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../harness/test';
import { openReader } from '../rfix/support';
import { drag, pointsFor, readingControls, REPO, reveal, SCROLLER } from '../s4/support';

const PDF = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');
const BAR = '[role="toolbar"][aria-label="Selection actions"]';
const PANE = { role: 'complementary' as const, name: 'Board' };

async function select(page: Page, from: string, to: string): Promise<void> {
  await reveal(page, from);
  const points = await pointsFor(page, from, to);
  await drag(page, points.from, points.to);
  await expect(page.locator(BAR)).toBeVisible();
}

const boardWidth = (page: Page): Promise<string> =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--pt-board-width'));

test.describe('v0.3 #344 - the split view', () => {
  test.skip(
    !existsSync(PDF),
    `SKIPPED: ${PDF} is absent. The corpus PDFs are fetched, not committed - run ` +
      './research/benchmarks/fetch_corpus.sh, then re-run this spec.',
  );

  test('Board beside: the card lands in the middle, the divider is remembered, B and Esc, drop, p. n', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(900_000);
    const { page, paperId } = await openReader(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'split',
    );

    // ── Send to board → Board beside ──
    await select(page, 'The dominant sequence transduction', 'decoder.');
    await page.getByRole('button', { name: 'Send to board', exact: true }).click();
    await page
      .getByRole('group', { name: 'Send to board' })
      .getByRole('button', { name: /^Board beside/ })
      .click();
    const pane = page.getByRole(PANE.role, { name: PANE.name });
    await expect(pane).toBeVisible();
    expect(page.url()).toContain('/read'); // the paper never left
    await expect(page.locator('html')).toHaveAttribute('data-pt-board', 'open');

    // The card is in the middle of the pane, as a pair with its open ask box; it glows once; it is
    // as tall as its text, never past 60% of the pane.
    const passage = pane.locator('.react-flow__node-excerpt');
    await expect(passage).toHaveCount(1);
    await expect(passage).toHaveClass(/pt-tn--arrived/, { timeout: 10_000 });
    const stage = (await pane.getByTestId('canvas-stage').boundingBox())!;
    await expect(pane.locator('.pt-ask')).toBeVisible();
    const pair = [(await passage.boundingBox())!, (await pane.locator('.pt-ask').boundingBox())!];
    const left = Math.min(...pair.map((b) => b.x));
    const right = Math.max(...pair.map((b) => b.x + b.width));
    expect(left).toBeGreaterThanOrEqual(stage.x - 1);
    expect(right).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect((left + right) / 2).toBeGreaterThan(stage.x + stage.width * 0.3);
    expect((left + right) / 2).toBeLessThan(stage.x + stage.width * 0.7);
    expect((await passage.boundingBox())!.height).toBeLessThanOrEqual(stage.height * 0.6 + 2);

    // The reader's own Split steps aside: the word is the board's.
    const modes = await readingControls(page, (controls) =>
      controls
        .getByRole('radiogroup', { name: 'Reading mode' })
        .getByRole('radio')
        .allTextContents(),
    );
    expect(modes).toEqual(['Source', 'Guided']);

    // ── the divider: keyboard, remembered ──
    const divider = page.getByRole('separator', { name: 'Resize paper and board' });
    const was = Number(await divider.getAttribute('aria-valuenow'));
    await divider.focus();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowLeft');
    const grown = Number(await divider.getAttribute('aria-valuenow'));
    expect(grown).toBeGreaterThan(was);
    const width = await boardWidth(page);

    // Esc, one level per press: the ask box first, the pane stays; then the board closes.
    await passage.click({ position: { x: 24, y: 8 } });
    await page.keyboard.press('Escape');
    await expect(pane).toBeVisible();
    for (let i = 0; i < 4 && (await pane.isVisible()); i += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    await expect(pane).toBeHidden();

    // B brings it back at the same width, also after a reload: the last split is remembered.
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('b');
    await expect(pane).toBeVisible();
    expect(await boardWidth(page)).toBe(width);
    await page.reload();
    await expect(page.locator(SCROLLER)).toBeVisible();
    await page.keyboard.press('b');
    await expect(pane).toBeVisible();
    expect(await boardWidth(page)).toBe(width);

    // ── fold either side to a strip; one click restores ──
    await pane.getByRole('button', { name: 'Hide the paper' }).click();
    await expect(page.locator('.pt-split__strip')).toBeVisible();
    await page.locator('.pt-split__strip').getByRole('button', { name: 'Show the paper' }).click();
    await expect(page.locator('.pt-split__strip')).toHaveCount(0);

    // ── Explain and the board share the right side ──
    await page.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Explain' })).toBeVisible();
    await expect(pane).toBeHidden();
    await page.getByRole('button', { name: 'Close explain panel' }).click();
    await page.getByRole('button', { name: /^Board beside/ }).click();
    await expect(pane).toBeVisible();

    // ── a passage dragged across: a cross and a footprint follow, the card lands at the drop ──
    await select(page, 'We propose a new simple network', 'entirely.');
    const points = await pointsFor(page, 'We propose a new simple network', 'entirely.');
    const target = (await pane.getByTestId('canvas-stage').boundingBox())!;
    const drop = { x: target.x + target.width * 0.5, y: target.y + target.height * 0.75 };
    await page.mouse.move(points.from.x + 10, points.from.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 12 });
    await expect(pane.locator('.pt-drop__cross')).toBeVisible();
    await expect(pane.locator('.pt-drop__foot')).toBeVisible();
    await page.mouse.up();
    await expect(pane.locator('.react-flow__node-excerpt')).toHaveCount(2);
    const landed = pane.locator('.react-flow__node-excerpt').last();
    const box = (await landed.boundingBox())!;
    expect(Math.abs(box.x - (drop.x - 22))).toBeLessThan(80);
    expect(Math.abs(box.y - (drop.y - 14))).toBeLessThan(80);

    // ── ask on the first card, then "p. n": the paper flashes, the board stays put ──
    const first = pane.locator('.react-flow__node-excerpt').first();
    await first.getByRole('button', { name: 'Ask about this card' }).click();
    await pane.getByLabel('Your question').fill('Why does this help?');
    await pane.getByLabel('Your question').press('Enter');
    const answer = pane.locator('.react-flow__node-explanation').first();
    await expect(answer).toBeVisible({ timeout: 120_000 });
    await expect(answer.locator('.pt-tc__foot')).not.toContainText('writing…', {
      timeout: 120_000,
    });
    const src = pane.locator('.pt-tc__src').first();
    if ((await src.count()) > 0) {
      const before = (await answer.boundingBox())!;
      await src.click();
      await expect(page.locator('svg [data-flash="true"] polygon.pt-flash').first()).toBeVisible({
        timeout: 10_000,
      });
      const after = (await answer.boundingBox())!;
      expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(2);
      expect(page.url()).toContain('/read');
    }

    // ── the first branch widens the board and folds the paper to a strip ──
    // On a word (the middle of a wrapped paragraph can be a gap between lines), and again if the
    // card was still reading its stored text back: words selected before that are not branched.
    const menu = pane.getByRole('menu', { name: 'On the selected words' });
    await expect(async () => {
      const at = await answer
        .locator('.pt-tc__answer p')
        .first()
        .evaluate((p) => {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
            const m = /[A-Za-z]{4,}/.exec(n.textContent ?? '');
            if (m === null) continue;
            const r = document.createRange();
            r.setStart(n, m.index);
            r.setEnd(n, m.index + m[0].length);
            const b = r.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
          }
          return null;
        });
      expect(at).not.toBeNull();
      await page.mouse.dblclick(at!.x, at!.y);
      await expect(menu).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.keyboard.press('Enter');
    await pane.getByLabel('Your question').fill('what is that?');
    await pane.getByLabel('Your question').press('Enter');
    await expect(pane.locator('.react-flow__node-explanation')).toHaveCount(2, {
      timeout: 120_000,
    });
    await expect(page.locator('.pt-split__strip')).toBeVisible();
    await page.locator('.pt-split__strip').getByRole('button', { name: 'Show the paper' }).click();
    await expect(page.locator('.pt-split__strip')).toHaveCount(0);

    // The server holds what the split made: two passages, the answers under them.
    const board = await fetch(`${stack.apiUrl}/papers/${paperId}/board`, {
      headers: {
        authorization: `Bearer ${await page.evaluate(() => window.localStorage.getItem('papertree.session'))}`,
      },
    }).then((r) => r.json() as Promise<{ nodes: { kind: string }[] }>);
    expect(board.nodes.filter((n) => n.kind === 'excerpt')).toHaveLength(2);
  });
});
