/**
 * v0.3 #348 - select an image in a paper and ask the AI about it, on the real stack with the faux
 * agent (journey step of #347). Acceptance list of the issue, one test each:
 *
 *   - click Figure 2 in ResNet (page 2) -> Explain -> an `image` thread, the crop at the top of the
 *     panel, a tutor-shaped answer;
 *   - Alt+drag a rectangle over Figure 1 -> resize it -> Ask... with a question -> a `figure_region`
 *     thread;
 *   - Send to board -> Board beside -> an image card with its crop, caption and "Figure 2 . p. 2";
 *     an ask on it grows an answer to its right, and words in that answer branch again;
 *   - a figure and a paragraph together (Shift) -> `with_text_anchor`;
 *   - the dark page keeps the figure's colours and the selection is drawn in the page's own tokens
 *     on Light, Sepia and Dark;
 *   - keyboard only: Tab to a float, Enter, Escape; the area tool by arrow keys.
 *
 * The corpus PDF is fetched, not committed; the spec SKIPS, loudly, without it. Nothing here
 * asserts the faux agent's words, only the requests the web sends and the structure it builds.
 * (A non-vision model never being sent an image is the agent's and the API's test, not the web's.)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Locator, Page, Request } from '@playwright/test';

import { expect, test } from '../harness/test';
import { openReader } from '../rfix/support';
import { drag, pointsFor, REPO, reveal } from '../s4/support';

const PDF = join(REPO, 'research', 'benchmarks', 'corpus', 'resnet-cvpr-2col.pdf');
const BAR = '[role="toolbar"][aria-label="Selection actions"]';
const FRAME = '[data-pt-imgframe]';

interface ThreadBody {
  readonly kind: string;
  readonly anchor: {
    readonly targetKind: string;
    readonly selectors: readonly { readonly type: string; readonly quads?: readonly unknown[] }[];
  };
  readonly question?: string;
  readonly with_text_anchor?: { readonly targetKind: string };
}

/** The next request that starts a thread (not a follow-up). */
function threadCreate(page: Page): Promise<Request> {
  return page.waitForRequest(
    (r) => r.method() === 'POST' && /\/papers\/[^/]+\/threads$/.test(r.url()),
  );
}

const float = (page: Page, label: string): Locator =>
  page.locator(`.pt-imgfloat[aria-label^="${label}, page"]`);

/** Scrolls the caption's words into view, then returns a point inside the float's own box. */
async function pointInFloat(
  page: Page,
  label: string,
  words: string,
): Promise<{ x: number; y: number }> {
  await reveal(page, words);
  const box = await float(page, label).boundingBox();
  if (box === null) throw new Error(`${label} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.3 };
}

/** Whether a token's colour is what the element is drawn in: the page's own, not a literal. */
async function drawnInToken(page: Page, selector: string, token: string): Promise<boolean> {
  return page.evaluate(
    ([sel, name]) => {
      const el = document.querySelector(sel as string);
      if (el === null) return false;
      const probe = document.createElement('span');
      probe.style.color = `var(${name as string})`;
      document.body.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).borderTopColor === want;
    },
    [selector, token] as const,
  );
}

test.describe('v0.3 #348 - select an image and ask about it', () => {
  // Each test opens its own reader context on a rendered PDF; close it when the test ends, so six
  // of them are not all alive (and painting) by the last test of the file.
  const opened: { close(): Promise<void> }[] = [];
  const open = async (...args: Parameters<typeof openReader>): ReturnType<typeof openReader> => {
    const reader = await open(...args);
    opened.push(reader.context);
    return reader;
  };
  test.afterEach(async () => {
    await Promise.all(opened.splice(0).map((context) => context.close().catch(() => undefined)));
  });

  test.skip(
    !existsSync(PDF),
    `SKIPPED: ${PDF} is absent. The corpus PDFs are fetched, not committed - run ` +
      './research/benchmarks/fetch_corpus.sh, then re-run this spec.',
  );

  test('click Figure 2, Explain: an image thread, the crop at the top, a tutor answer', async ({
    browser,
    stack,
  }) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(900_000);
    const { page } = await open(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'img-explain',
    );
    const at = await pointInFloat(page, 'Figure 2', 'Residual learning:');

    // One click selects the whole float, caption included; the menu is the text menu's.
    await page.mouse.move(at.x, at.y);
    await expect(float(page, 'Figure 2')).toHaveAttribute('data-hover', '');
    await page.mouse.click(at.x, at.y);
    await expect(page.locator(FRAME)).toHaveAttribute('data-origin', 'float');
    await expect(page.locator(BAR)).toBeVisible();
    const names = await page
      .locator(`${BAR} button`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(names.slice(0, 4)).toEqual(['Explain', 'Ask…', 'Send to board', 'Note']);

    const created = threadCreate(page);
    await page.locator(BAR).getByRole('button', { name: 'Explain', exact: true }).click();
    const body = (await created).postDataJSON() as ThreadBody;
    expect(body.kind).toBe('image');
    expect(body.anchor.targetKind).toBe('figure');
    expect(body.anchor.selectors.map((s) => s.type)).not.toContain('TextQuoteSelector');
    expect(body.anchor.selectors.filter((s) => s.type === 'ShapeSelector')).toHaveLength(1);

    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-explain-crop] img')).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('[data-explain-crop]')).toContainText('p. 2');
    await expect(panel.locator('[data-message-status="complete"]').first()).toBeVisible({
      timeout: 180_000,
    });
  });

  test('Alt+drag a rectangle over Figure 1, resize it, Ask with a question: a figure_region thread', async ({
    browser,
    stack,
  }) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(900_000);
    const { page } = await open(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'img-area',
    );
    const at = await pointInFloat(page, 'Figure 1', 'Training error (left)');
    const figure = (await float(page, 'Figure 1').boundingBox())!;

    // Alt+drag over the left panel; then widen it by its east handle.
    await page.keyboard.down('Alt');
    await drag(
      page,
      { x: figure.x + 4, y: figure.y + 4 },
      { x: at.x - 20, y: figure.y + figure.height * 0.6 },
    );
    await page.keyboard.up('Alt');
    const frame = page.locator(FRAME);
    await expect(frame).toHaveAttribute('data-origin', 'area');
    await expect(frame.locator('.pt-imghandle')).toHaveCount(8);
    const was = (await frame.boundingBox())!;
    const east = (await frame.locator('[data-handle="e"]').boundingBox())!;
    await drag(
      page,
      { x: east.x + east.width / 2, y: east.y + east.height / 2 },
      { x: east.x + 30, y: east.y },
    );
    expect((await frame.boundingBox())!.width).toBeGreaterThan(was.width + 10);

    await page.getByRole('button', { name: 'Ask…', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel.locator('[data-explain-crop] img')).toBeVisible({ timeout: 30_000 });
    const created = threadCreate(page);
    await panel.getByRole('textbox').fill('Why is the deeper net worse?');
    await panel.getByRole('textbox').press('Enter');
    const body = (await created).postDataJSON() as ThreadBody;
    expect(body).toMatchObject({ kind: 'image', question: 'Why is the deeper net worse?' });
    expect(body.anchor.targetKind).toBe('figure_region');
    await expect(panel.locator('[data-message-status="complete"]').first()).toBeVisible({
      timeout: 180_000,
    });
  });

  test('Send to board, Board beside: an image card with its crop and caption; ask on it, branch from the answer', async ({
    browser,
    stack,
  }) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(900_000);
    const { page, paperId, token } = await open(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'img-board',
    );
    const at = await pointInFloat(page, 'Figure 2', 'Residual learning:');
    await page.mouse.click(at.x, at.y);
    await page.getByRole('button', { name: 'Send to board', exact: true }).click();
    await page
      .getByRole('group', { name: 'Send to board' })
      .getByRole('button', { name: /^Board beside/ })
      .click();

    const pane = page.getByRole('complementary', { name: 'Board' });
    const card = pane.locator('.react-flow__node-excerpt');
    await expect(card).toHaveCount(1);
    await expect(card.locator('img')).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Figure 2 · p. 2');
    await expect(card).toContainText('Residual learning');

    await card.getByRole('button', { name: 'Ask about this card' }).click();
    await pane.getByLabel('Your question').fill('Why does the shortcut help?');
    await pane.getByLabel('Your question').press('Enter');
    const answer = pane.locator('.react-flow__node-explanation').first();
    await expect(answer).toBeVisible({ timeout: 120_000 });
    await expect(answer.locator('.pt-tc__foot')).not.toContainText('writing…', {
      timeout: 120_000,
    });
    // The answer grows to the right of the picture.
    expect((await answer.boundingBox())!.x).toBeGreaterThan((await card.boundingBox())!.x + 100);

    // Double-click a real word. The paragraph's own centre can land on punctuation, which selects
    // one character, and a one-character selection opens no menu.
    const wordAt = await answer
      .locator('.pt-tc__answer p')
      .first()
      .evaluate((p) => {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          const m = /[A-Za-z]{4,}/.exec(n.textContent ?? '');
          if (m === null) continue;
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          const r = range.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return null;
      });
    expect(wordAt).not.toBeNull();
    await page.mouse.dblclick(wordAt!.x, wordAt!.y);
    await expect(pane.getByRole('menu', { name: 'On the selected words' })).toBeVisible();
    await page.keyboard.press('Enter');
    await pane.getByLabel('Your question').fill('what is that?');
    await pane.getByLabel('Your question').press('Enter');
    await expect(pane.locator('.react-flow__node-explanation')).toHaveCount(2, {
      timeout: 120_000,
    });

    const board = (await fetch(`${stack.apiUrl}/papers/${paperId}/board`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((r) => r.json())) as {
      nodes: { kind: string; source_anchor: ThreadBody['anchor'] | null }[];
    };
    const root = board.nodes.find((n) => n.kind === 'excerpt');
    expect(root?.source_anchor?.targetKind).toBe('figure');
  });

  test('a figure and a paragraph together: Shift keeps the words, the ask sends with_text_anchor', async ({
    browser,
    stack,
  }) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(900_000);
    const { page } = await open(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'img-pair',
    );
    await reveal(page, 'Deeper neural networks');
    const points = await pointsFor(page, 'Deeper neural', 'difficult to train');
    await drag(page, points.from, points.to);
    const at = await pointInFloat(page, 'Figure 1', 'Training error (left)');
    await page.keyboard.down('Shift');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up('Shift');
    await expect(page.locator(FRAME)).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('Deeper');

    const created = threadCreate(page);
    await page.locator(BAR).getByRole('button', { name: 'Explain', exact: true }).click();
    const body = (await created).postDataJSON() as ThreadBody;
    expect(body.kind).toBe('image');
    expect(body.with_text_anchor?.targetKind).toBe('text');
  });

  test('Light, Sepia and Dark: the selection is drawn in the page tokens and the figure keeps its colours', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const { page } = await open(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'img-dark',
    );
    const at = await pointInFloat(page, 'Figure 2', 'Residual learning:');
    await page.mouse.click(at.x, at.y);
    await expect(page.locator(FRAME)).toBeVisible();
    for (const choice of ['Light', 'Sepia', 'Dark'] as const) {
      const aa = page.getByRole('button', { name: 'Reading settings' });
      if ((await aa.getAttribute('aria-expanded')) !== 'true') await aa.click();
      await page
        .getByRole('radiogroup', { name: 'Page' })
        .getByRole('radio', { name: choice })
        .click();
      await expect(page.locator(FRAME)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-pt-page', choice.toLowerCase());
      expect(await drawnInToken(page, FRAME, '--pt-pdf-img-edge'), choice).toBe(true);
    }
    // Dark: the figure is drawn back on a mat from the page's own pixels, never inverted.
    await expect(page.locator('.papertree-page [data-papertree-mat]').first()).toBeVisible();
  });

  test('keyboard only: Tab to a float, Enter selects, Escape lets go; the area tool by arrow keys', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const { page } = await open(
      browser,
      stack.apiUrl,
      PDF,
      { width: 1440, height: 900 },
      'img-keys',
    );
    await pointInFloat(page, 'Figure 1', 'Training error (left)');
    const first = float(page, 'Figure 1');
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(FRAME)).toBeFocused();
    await expect(page.locator(BAR)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(FRAME)).toHaveCount(0);

    // The area tool from the keyboard puts a rectangle on the page; the arrows move and resize it.
    const tool = page.getByRole('button', { name: /^Select area/ });
    await tool.focus();
    await page.keyboard.press('Enter');
    const frame = page.locator(FRAME);
    await expect(frame).toBeFocused();
    const was = (await frame.boundingBox())!;
    await page.keyboard.press('Shift+ArrowRight');
    const moved = (await frame.boundingBox())!;
    expect(moved.x).toBeGreaterThan(was.x + 5);
    await page.keyboard.press('Alt+ArrowRight');
    expect((await frame.boundingBox())!.width).toBeGreaterThan(moved.width);

    // Escape, one level per press: the tool is put away first, the selection last.
    await page.keyboard.press('Escape');
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    await expect(frame).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(frame).toHaveCount(0);
  });
});
