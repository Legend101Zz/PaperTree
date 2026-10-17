/**
 * S8 (#218): the prototype's whole flow (frame 12, DESIGN.md §11 F3) as one walk, on the real
 * stack with the FAUX agent, at 1440 and 390 in daylight and lamp-lit:
 *
 *   1 library · 2 search "atten" · 3 pull out (Enter) · 4 open (Enter) · 5 Read · 6 select a passage
 *   · 7 Explain · 8 marker 2 flashes its passage · 9 Dive in · 10 the notebook page · 11 the board
 *   · 12 a thread from the plate's brass pin · 13 Link as · 14 supports
 *
 * After every step: the motion has settled, the scheme's own tokens are on (#269), no "verified",
 * "fact-checked" or "accurate" is on screen, and axe finds nothing serious or critical. On the way:
 * the three voices (`data-voice`), marker 2's flash lands on passage 2's words, the usage line says
 * "estimate", and the supports thread has its colour AND its second cue (solid with +, its tag).
 *
 * At 390 each step takes the phone's own path, and where the phone does not offer a step by design
 * the walk asserts what it offers instead: there is no pull-out (a book lying flat has no row to turn
 * out of, #199), so a tap takes the book down into its bottom sheet, and the sheet's "Open the book"
 * opens the spread; the reader's controls are in the header's "Reading options" menu; the explain
 * panel is a sheet whose pinned footer holds the usage line and Dive in; the notebook is the phone
 * stack (no lasso, shapes or templates: it says so); the board threads by tap, pin then pin. Taps
 * throughout, except: the search is typed, Escape closes the menu, the passage is selected with a
 * mouse drag (Playwright has no touch text selection, as in phone-reader.spec), and the sheet is
 * raised with its grip slider's arrow key (no spec drags the grip by touch yet). At 1440 the walk
 * focuses the book before Enter: Enter in the search opens its card, not the pull-out (#313).
 *
 * The prototype's board already holds a plate and a passage when the walk reaches it. Here they are
 * made through the API's own routes just before step 11: a faux diagram run (`[faux:diagram]`) on
 * §3.2.1's first paragraph (an Anchor minted by `capture_anchor`, so its five quoted parts are
 * cited), and a passage card holding the Anchor the reader sent for step 7's selection (p. 1).
 * They land while the notebook page is open, as another tab's would; the page then reaches the
 * board through its own "Send page to board", and must cover neither (it did, before #218's fix).
 *
 * The PDF is the committed corpus's; the spec SKIPS, loudly, without it.
 */
import { existsSync } from 'node:fs';

import { expect, test } from '../harness/test';
import {
  drag,
  pointsFor,
  register,
  reveal,
  shotPath,
  upload,
  userId,
  waitParsed,
} from '../s4/support';
import { getBoard, tokenInit } from '../s7/support';
import {
  ATTENTION,
  centre,
  checkStep,
  drawPlate,
  mintAnchor,
  placeCard,
  steadyCentre,
} from './flow-support';

import type { Page } from '@playwright/test';

const JOURNEYS = [
  { width: 1440, scheme: 'light' },
  { width: 1440, scheme: 'dark' },
  { width: 390, scheme: 'light' },
  { width: 390, scheme: 'dark' },
] as const;

const SENTENCE = ['We propose a new simple network architecture', 'entirely.'] as const;

/** The text-layer words under the flashed passage's polygons. */
async function flashedWords(page: Page): Promise<string> {
  return page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('svg [data-flash] polygon')).map((p) =>
      p.getBoundingClientRect(),
    );
    return Array.from(document.querySelectorAll('.papertree-text-layer span[data-item-index]'))
      .filter((s) => {
        const r = s.getBoundingClientRect();
        return boxes.some(
          (b) =>
            r.bottom > b.top + 1 && r.top < b.bottom - 1 && r.right > b.left && r.left < b.right,
        );
      })
      .map((s) => s.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ');
  });
}

/** Letters only, lower case: the text layer and the parse break lines and hyphens differently. */
const letters = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');

test.describe('S8: the prototype flow, 14 steps, at 1440 and 390, both schemes (faux agent)', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.use({ actionTimeout: 20_000 });

  for (const { width, scheme } of JOURNEYS) {
    test(`${String(width)} ${scheme}: library → … → supports`, async ({ browser, stack }, info) => {
      test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
      test.setTimeout(600_000);
      const phone = width < 768;
      const token = await register(
        stack.apiUrl,
        `e2e-s8-flow-${String(width)}-${scheme}-${String(Date.now())}@papertree.test`,
      );
      const paperId = await upload(stack.apiUrl, token, ATTENTION);
      await waitParsed(stack.apiUrl, token, paperId);
      const context = await browser.newContext({
        viewport: { width, height: phone ? 844 : 900 },
        colorScheme: scheme,
        deviceScaleFactor: 1,
        hasTouch: phone,
      });
      const page = await context.newPage();
      await tokenInit(page, token);
      let n = 0;
      const step = async (name: string, body: () => Promise<void>): Promise<void> => {
        n += 1;
        const label = `${String(n)} ${name} (${String(width)} ${scheme})`;
        await test.step(label, async () => {
          await body();
          await checkStep(page, scheme, label);
          const file = `s8-flow-${String(width)}-${scheme}-${String(n).padStart(2, '0')}.png`;
          await page.screenshot({ path: shotPath(file, info.outputPath('shots')) });
        });
      };
      const book = page.locator(`[aria-label="Your shelf"] button[data-paper-id="${paperId}"]`);
      // The opened book (S3); on a phone the catalogue sheet is a dialog too, so not by role alone.
      const spread = page.locator('[role="dialog"][data-book-stage]');

      await step('library', async () => {
        await page.goto('/dashboard');
        await expect(book).toBeVisible({ timeout: 60_000 });
        // A phone lays the books flat in stacks (08a); a short library stands face-out (01c).
        await expect(book).toHaveClass(phone ? /pt-flatbook/ : /pt-cover/);
        await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
      });

      const order = () =>
        page
          .locator('[aria-label="Your shelf"] button[data-paper-id]')
          .evaluateAll((all) => all.map((b) => b.getAttribute('data-paper-id')));
      await step('search "atten"', async () => {
        const before = await order();
        const search = page.getByRole('searchbox', { name: 'Search the library' });
        await search.click();
        await page.keyboard.type('atten', { delay: 40 });
        await expect(book).toHaveAttribute('data-match', 'true');
        const lit = await page.locator('[aria-label="Your shelf"] [data-match="true"]').count();
        await expect(page.locator('.pt-search__count')).toHaveText(
          `${String(lit)} of ${String(before.length)}`,
        );
        // Filters in place: the rest dims (some book is not lit), nothing reorders.
        expect(lit).toBeLessThan(before.length);
        expect(await order()).toEqual(before);
      });

      await step(phone ? 'take it down (the phone has no pull-out)' : 'pull out', async () => {
        if (phone) await book.tap();
        else {
          await book.focus();
          await page.keyboard.press('Enter');
        }
        if (phone) {
          const sheet = page.locator(`[data-card-paper-id="${paperId}"]`);
          await expect(sheet).toHaveClass(/pt-catalogue--sheet/);
          await expect(sheet.getByRole('button', { name: /^Read / })).toBeFocused();
          await expect(spread).toHaveCount(0);
          await expect(book).toHaveAttribute('aria-expanded', 'true');
        } else {
          await expect(spread).toHaveAttribute('data-book-stage', 'pulled');
          await expect(spread.locator('[data-cover="typographic"]')).toContainText(
            '2017 · arXiv 1706.03762',
          );
          await expect(spread.getByRole('button', { name: /^Open Attention/ })).toBeFocused();
          await expect(book).toHaveAttribute('data-pulled', 'true');
        }
      });

      await step('open', async () => {
        if (phone) {
          await page
            .locator(`[data-card-paper-id="${paperId}"]`)
            .getByRole('button', { name: /^Open the book/ })
            .tap();
          await expect(spread.getByRole('button', { name: /^Read / })).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        } else {
          await page.keyboard.press('Enter');
          await expect(spread).toHaveAttribute('data-book-stage', 'open');
          await expect(spread.getByRole('button', { name: /^Read / })).toBeFocused();
        }
        await expect(spread).toHaveAccessibleName('Attention Is All You Need');
        await expect(spread.locator('[data-book-meta]')).toContainText(
          '2017 · arXiv 1706.03762 · 15 pages',
        );
        await expect(spread.locator('blockquote[data-voice="paper"]')).toContainText(
          'The dominant sequence transduction models',
        );
      });

      await step('Read', async () => {
        if (phone) await spread.getByRole('button', { name: /^Read / }).tap();
        else await page.keyboard.press('Enter');
        await page.waitForURL(`**/paper/${paperId}/read**`);
        await expect
          .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
            timeout: 180_000,
          })
          .toBeGreaterThan(20);
        expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
        const bar = page.getByRole('banner');
        if (phone) {
          // One row; Contents, the modes, zoom and Board wait in the header's menu (08b).
          await expect(bar.getByRole('radiogroup', { name: 'Reading mode' })).toHaveCount(0);
          await bar.getByRole('button', { name: 'Reading options' }).tap();
          const menu = page.getByRole('group', { name: 'Reading options' });
          await expect(menu.getByRole('radio', { name: 'Guided' })).toBeVisible();
          await expect(menu.getByRole('link', { name: 'Board' })).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
        } else {
          await expect(bar.getByRole('radiogroup', { name: 'Reading mode' })).toBeVisible();
          await expect(bar).toContainText(/p\. \d+ of 15/);
        }
      });

      await step('select a passage', async () => {
        await reveal(page, SENTENCE[0]);
        const points = await pointsFor(page, SENTENCE[0], SENTENCE[1]);
        await drag(page, points.from, points.to);
        await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible();
      });

      const panel = phone
        ? page.getByRole('dialog', { name: 'Explain' })
        : page.getByRole('complementary', { name: 'Explain' });
      const exchange = panel.locator('[data-exchange]').first();
      let selection: { doc: { paperId: string } } | null = null;
      await step('Explain', async () => {
        const sent = page.waitForRequest(
          (r) => r.method() === 'POST' && r.url().endsWith(`/papers/${paperId}/threads`),
        );
        const explain = page
          .getByRole('toolbar', { name: 'Selection actions' })
          .getByRole('button', { name: 'Explain this passage' });
        await (phone ? explain.tap() : explain.click());
        selection = ((await sent).postDataJSON() as { anchor: { doc: { paperId: string } } })
          .anchor;
        await expect(exchange.locator('[data-message-status="complete"]')).toBeVisible({
          timeout: 120_000,
        });
        // The three voices: your ask, the paper's words, the AI's answer.
        await expect(exchange.locator('.pt-call-slip [data-voice="you"]')).toHaveText(
          'Explain this passage.',
        );
        await expect(exchange.locator('[data-explain-quote] [data-voice="paper"]')).toContainText(
          SENTENCE[0],
        );
        await expect(exchange.locator('[data-voice="ai"]').first()).toBeVisible();
        await expect(exchange.locator('.pt-coverage')).toContainText('Stands on 2 passages');
        // The usage line ends "(estimate)": in the pinned footer on a phone (08b).
        await expect(
          phone ? panel.locator('[data-pinned-footer]') : exchange.locator('[data-usage-line]'),
        ).toContainText('(estimate)');
      });

      await step('marker 2 lights its passage', async () => {
        const marker = exchange.locator('[data-passage="2"] button').first();
        const quote = await exchange
          .locator('.pt-trace-row[data-n="2"] .pt-trace-row__quote')
          .first()
          .innerText();
        if (phone) {
          await marker.tap();
          await expect(page.locator('.pt-explain-sheet')).toHaveAttribute('data-detent', 'peek');
        } else {
          await marker.hover();
          await expect(exchange.locator('.pt-trace-row[data-n="2"]')).toHaveAttribute(
            'data-lit',
            'true',
          );
          await marker.click();
        }
        const flash = page.locator('svg [data-flash="true"] polygon.pt-flash');
        await expect(flash.first()).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-flash-tab="2"]')).toContainText(
          'from marker 2 in the answer',
        );
        // In view, above the sheet on a phone, once the scroll and the sheet's lowering are over.
        await expect
          .poll(async () => {
            const box = await page.locator('svg [data-flash] polygon').first().boundingBox();
            const floor = phone
              ? ((await page.locator('.pt-explain-sheet').boundingBox())?.y ?? 0)
              : 900;
            return box !== null && box.y >= 0 && box.y + box.height <= floor;
          })
          .toBe(true);
        // WHERE it flashed: the words under the ring are passage 2's own.
        expect(letters(await flashedWords(page))).toContain(letters(quote).slice(0, 24));
      });

      let pageId = '';
      await step('Dive in', async () => {
        if (phone) {
          await panel.getByRole('slider', { name: 'Explain height' }).press('ArrowUp');
        }
        const dive = (phone ? panel.locator('[data-pinned-footer]') : exchange).getByRole(
          'button',
          { name: /^Dive in/ },
        );
        await dive.scrollIntoViewIfNeeded();
        const made = page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            r.url().endsWith(`/papers/${paperId}/notebook/pages`),
        );
        await (phone ? dive.tap() : dive.click());
        pageId = ((await made).request().postDataJSON() as { page_id: string }).page_id;
        await expect(page).toHaveURL(new RegExp(`/paper/${paperId}/notebook/${pageId}$`));
        // The arrival is over: nothing is left hidden or mid-slide.
        await expect(page.locator('.pt-nb[data-dive]')).toHaveCount(0);
      });

      await step('the notebook page', async () => {
        await expect(
          page.getByRole('region', { name: 'The exchange this page started from' }),
        ).toBeVisible();
        await expect(page.locator('[data-voice="you"]').first()).toBeVisible();
        await expect(page.locator('[data-voice="ai"]').first()).toBeVisible();
        if (phone) {
          // The phone stack (08c): the trace as rows; it says what it leaves to bigger screens.
          await expect(page.locator('.pt-nb-stack .pt-trace-row')).toHaveCount(2);
          const tools = page.getByRole('toolbar', { name: 'Notebook tools' });
          await expect(tools.getByRole('button')).toHaveText([
            'Text',
            'Sticky',
            'Highlight',
            'Pen: off',
          ]);
          await expect(
            page.getByText('Lasso, shapes and templates: on a tablet or computer'),
          ).toBeVisible();
        } else {
          await expect(page.locator('.pt-nb-quote')).toHaveCount(2);
          await expect(page.locator('.pt-nb-quote[data-passage="2"]')).toHaveCount(1);
          await expect(page.locator('.pt-nb-quote [data-voice="paper"]').first()).toBeVisible();
        }
      });

      // The prototype's board holds a plate and a passage before the walk reaches it.
      const user = await userId(stack.apiUrl, token);
      const onPlate = mintAnchor(stack.dataRoot, user, paperId, 'We call our particular attention');
      const plate = await drawPlate(stack.apiUrl, token, paperId, onPlate);
      expect(selection, 'the anchor the reader sent for step 7').not.toBeNull();
      const plateCard = await placeCard(stack.apiUrl, token, paperId, {
        kind: 'diagram',
        x: 0,
        y: 0,
        w: 300,
        h: 300,
        title: plate.title,
        source_diagram_id: plate.messageId,
      });
      const passageCard = await placeCard(stack.apiUrl, token, paperId, {
        kind: 'excerpt',
        x: 520,
        y: 40,
        w: 340,
        h: 200,
        body: `${SENTENCE[0]}, the Transformer, based solely on attention mechanisms.`,
        source_anchor: selection,
      });
      const card = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      const claimOut = card(plateCard).locator('[data-handleid="claim_out"]');
      const evidenceIn = card(passageCard).locator('[data-handleid="evidence_in"]');

      await step('the board', async () => {
        const sent = page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' && r.url().endsWith(`/papers/${paperId}/board/nodes`),
        );
        const bar = page.locator('.pt-nb__bar');
        const send = bar.getByRole('button', { name: /Send page to board/ });
        await (phone ? send.tap() : send.click());
        expect((await sent).status()).toBe(201);
        const open = bar.getByRole('link', { name: /Open board/ });
        await (phone ? open.tap() : open.click());
        await page.waitForURL(`**/paper/${paperId}/board**`);
        await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 60_000 });
        // A phone's header is one row beside "Board"; the minimap folds behind "Map" (#214).
        if (phone) await expect(page.getByRole('button', { name: /^Map/ })).toBeVisible();
        else await expect(page.getByRole('banner')).toContainText('3 cards');
        // The notebook page as one card, the plate drawn small, the passage in the paper's voice.
        await expect(card(`cn_${pageId.slice(3)}`)).toHaveClass(/react-flow__node-notebook/);
        await expect(card(plateCard).locator('[data-plate-mini="6"]')).toBeVisible();
        await expect(card(plateCard)).toContainText('6 parts · 5 cited');
        await expect(card(passageCard).locator('blockquote[data-voice="paper"]')).toContainText(
          SENTENCE[0],
        );
        await expect(card(passageCard).locator('.pt-tab')).toHaveText(/^p\. 1/);
        // The page's card covers no card already there, even one added after the page opened.
        const boxes = (await getBoard(stack.apiUrl, token, paperId)).nodes;
        for (const a of boxes)
          for (const b of boxes)
            if (a.node_id < b.node_id)
              expect(
                a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
                `${a.kind} and ${b.kind} overlap`,
              ).toBe(false);
        // The board has fitted itself and placed the pins the next step aims at.
        await steadyCentre(page, claimOut);
        await steadyCentre(page, evidenceIn);
      });

      const picker = page.getByRole('group', { name: /link as/i });
      await step("a thread from the plate's brass pin", async () => {
        if (phone) {
          // A finger has no drag between pins this small: tap the brass pin, then the open one.
          await claimOut.tap();
          await expect(evidenceIn).toHaveAttribute('data-lit', 'true');
          await evidenceIn.tap();
        } else {
          const from = await centre(claimOut);
          const to = await centre(evidenceIn);
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
          await page.mouse.move(to.x, to.y, { steps: 8 });
          await expect(evidenceIn).toHaveAttribute('data-lit', 'true');
          await page.mouse.up();
        }
        await expect(picker).toBeVisible();
      });

      await step('Link as', async () => {
        await expect(page.getByRole('dialog')).toHaveCount(0); // a picker on the board, not a modal
        await expect(picker).toContainText(`Diagram ‘${plate.title}’ → Passage p. 1`);
        await expect(picker.getByRole('option')).toHaveCount(7);
      });

      await step('supports', async () => {
        if (phone) await picker.getByRole('option', { name: /supports/ }).tap();
        else await page.keyboard.press('1');
        await expect(picker).toBeHidden();
        const thread = page.locator('.react-flow__edge g.pt-thread');
        // Colour AND a second cue: the supports green, a solid line with +, and its paper tag.
        await expect(thread).toHaveAttribute('data-kind', 'supports');
        await expect(thread).toHaveAttribute('data-cue', 'solid with plus');
        await expect(page.locator('.pt-thread-tag__glyph')).toHaveText('+');
        await expect(page.getByTestId('edge-label')).toHaveText('supports');
        const [stroke, green] = await thread.evaluate((g) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--pt-wire-supports)';
          g.ownerDocument.body.append(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return [getComputedStyle(g.querySelector('.pt-thread__line')!).stroke, want];
        });
        expect(stroke).toBe(green);
        await expect(page.getByTestId('undo-toast')).toContainText('Linked as supports.');
        await expect
          .poll(async () => (await getBoard(stack.apiUrl, token, paperId)).edges)
          .toEqual([
            expect.objectContaining({
              from_node_id: plateCard,
              to_node_id: passageCard,
              kind: 'supports',
              from_port: 'claim_out',
              to_port: 'evidence_in',
            }),
          ]);
      });
      expect(n).toBe(14);
      await context.close();
    });
  }
});
