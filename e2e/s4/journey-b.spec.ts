/**
 * S4 acceptance — Journey B, walked in a real browser against the real stack (slice-plan §S4).
 *
 * An UPLOADED paper, not a fixture: YOLO goes through `POST /papers`, the real worker parses and
 * promotes it, and the reader opens it from the API. Then, with the MOUSE (a drag to select, a
 * click on the toolbar — the path the baseline's text layer swallowed):
 *
 *   (a) a body sentence, (b) the table cell "66.4", (c) a Figure 1 label → each paints within 2 px
 *       of the selection's own line rects, `POST /highlights` answers 201, the rows are in sqlite;
 *   reload → the same quads (±0.5 pt, IR space) and all three in the Navigator's Highlights tab;
 *   150 % and fit width keep the top line (±1 line);
 *   Source → Guided → Source and → Split keep pages rendering, the position and the highlights,
 *       with ONE `getDocument` for the whole session;
 *   a simulated re-parse (generation 2) repaints byte-identically and `anchor_resolutions` gains
 *       gen-2 rows;
 *   an orphan (a foreign `pdfSha256`, no quote) is in the tray with its reason and painted nowhere;
 *   390 px: no horizontal scroll, the bar and the mode switch fit, the page opens fit-width.
 *
 * `document.visibilityState === 'visible'` is asserted wherever spans are counted (AGENTS.md §4).
 * Screenshots of every state, at 1440 and 390, go to `PAPERTREE_E2E_SHOTS` (or the test output).
 *
 * YOLO is not in the committed corpus (it is S2's fresh set). The spec SKIPS, loudly, without it:
 * set `PAPERTREE_E2E_YOLO_PDF`, or run S2's `research/benchmarks/fresh/fetch_fresh.sh`.
 */
import { expect, test } from '../harness/test';
import {
  dbRows,
  drag,
  edgeDelta,
  getDocumentCalls,
  hitTest,
  insertOrphan,
  lineOffset,
  listHighlights,
  paintedBoxes,
  paintedPoints,
  pointsFor,
  register,
  reveal,
  selectionRects,
  shotPath,
  simulateReparse,
  spanCount,
  topLine,
  union,
  upload,
  userId,
  waitParsed,
  yoloPdf,
  type Box,
} from './support';

const YOLO = yoloPdf();

test.describe('S4 Journey B — highlight, reload, zoom, modes, orphan, 390 px', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF (arXiv 1506.02640) is not present. It is not in the committed corpus; set ' +
      'PAPERTREE_E2E_YOLO_PDF to a copy, or run research/benchmarks/fresh/fetch_fresh.sh (S2), then re-run.',
  );

  test('journey B on an uploaded YOLO', async ({ browser, stack }, testInfo) => {
    test.setTimeout(900_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const report: string[] = [];
    const note = (line: string) => {
      report.push(line);
      console.log(`[e2e s4] ${line}`);
    };

    // ── the paper, uploaded and parsed for real ──
    const token = await register(stack.apiUrl, `e2e-s4-${String(Date.now())}@papertree.test`);
    const user = await userId(stack.apiUrl, token);
    const paperId = await upload(stack.apiUrl, token, YOLO as string);
    const parsedMs = await waitParsed(stack.apiUrl, token, paperId);
    note(`uploaded ${paperId}, parsed + promoted in ${String(parsedMs)} ms`);

    const desktop = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await desktop.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* a context without storage is not this walk */
      }
    }, token);
    const page = await desktop.newPage();
    const posts: number[] = [];
    page.on('response', (response) => {
      if (
        response.url().endsWith(`/papers/${paperId}/highlights`) &&
        response.request().method() === 'POST'
      ) {
        posts.push(response.status());
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
    note(`reader open: visibilityState=visible, spans=${String(await spanCount(page))}`);
    await page.screenshot({ path: shot('b01-open-1440.png') });

    // ── highlight by mouse: select, hit-test the toolbar, click, measure ──
    const highlightByMouse = async (label: string, start: string, end: string, exact = false) => {
      await reveal(page, start, exact);
      const points = await pointsFor(page, start, end, exact);
      await drag(page, points.from, points.to);
      const selection = await selectionRects(page);
      expect(selection.text.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(0);
      await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible();
      await page.screenshot({ path: shot(`b02-select-${label}-1440.png`) });
      const hit = await hitTest(page, 'Highlight');
      expect(hit.hit, 'the element at the Highlight button centre must be the button').toBe(
        'button',
      );
      const before = new Set(
        (await listHighlights(stack.apiUrl, token, paperId)).map((h) => h.highlight_id),
      );
      const posted = page.waitForResponse(
        (r) => r.url().endsWith(`/papers/${paperId}/highlights`) && r.request().method() === 'POST',
      );
      await page.mouse.click(hit.x, hit.y);
      const response = await posted;
      expect(response.status()).toBe(201);
      const created = (await response.json()) as { highlight_id: string };
      expect(before.has(created.highlight_id)).toBe(false);
      await page.waitForTimeout(500);
      const painted = await paintedBoxes(page, created.highlight_id);
      expect(painted.length, `${label}: nothing painted`).toBeGreaterThan(0);
      const sel = union(selection.rects);
      const got = union(painted);
      const delta = edgeDelta(sel, got);
      const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
      const ratio =
        painted.reduce((s, b) => s + area(b), 0) /
        Math.max(
          1,
          selection.rects.reduce((s, b) => s + area(b), 0),
        );
      note(
        `(${label}) "${selection.text.replace(/\s+/g, ' ').trim().slice(0, 70)}" → POST 201 ${created.highlight_id}; ` +
          `hit=${hit.hit}; selection ${sel.map((v) => v.toFixed(1)).join(',')} vs paint ${got.map((v) => v.toFixed(1)).join(',')}: ` +
          `max edge Δ ${delta.toFixed(2)} px, painted/selected area ${ratio.toFixed(2)}`,
      );
      expect(
        delta,
        `${label}: the paint must be within 2 px of the selection's line rects`,
      ).toBeLessThanOrEqual(2);
      await page.screenshot({ path: shot(`b03-highlight-${label}-1440.png`) });
      return created.highlight_id;
    };

    const a = await highlightByMouse('a-sentence', 'We reframe object', 'class probabilities.');
    const b = await highlightByMouse('b-table-cell', '66.4', '66.4', true);
    const c = await highlightByMouse(
      'c-figure-label',
      '1. Resize image.',
      '1. Resize image.',
      true,
    );
    expect(posts.filter((s) => s === 201)).toHaveLength(3);

    const rows = dbRows(stack.dataRoot, paperId);
    note(`sqlite: ${JSON.stringify(rows)}`);
    expect(rows.highlights).toBe(3);
    expect(rows.anchors).toBeGreaterThanOrEqual(3);
    expect(rows.resolutions.find((r) => r.generation === 1)?.count ?? 0).toBeGreaterThanOrEqual(3);
    const wire = await listHighlights(stack.apiUrl, token, paperId);
    for (const h of wire) {
      note(
        `  ${h.highlight_id}: ${h.anchors.map((x) => `${x.anchor.targetKind} @ ${x.anchor.doc.textStreamId}`).join('; ')}`,
      );
    }

    // ── the Navigator lists them ──
    await page.getByRole('button', { name: 'Navigator' }).click();
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await expect(page.locator('[data-highlight-row]')).toHaveCount(3);
    await page.screenshot({ path: shot('b04-navigator-highlights-1440.png') });
    await page.getByRole('tab', { name: 'Pages' }).click();
    await expect
      .poll(() => page.locator('[data-thumbnail-page] canvas').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.screenshot({ path: shot('b05-navigator-pages-1440.png') });
    await page.getByRole('button', { name: 'Go to page 3' }).click();
    await page.waitForTimeout(900);
    expect((await topLine(page)).page).toBe(2);
    await page.keyboard.press('Escape');

    // ── reload: the same quads, from the server — every highlight, each on its own page ──
    const targets: readonly (readonly [string, boolean])[] = [
      ['We reframe object', false],
      ['66.4', true],
      ['1. Resize image.', true],
    ];
    const collect = async (): Promise<Record<string, string[]>> => {
      const all: Record<string, string[]> = {};
      for (const [needle, exact] of targets) {
        await reveal(page, needle, exact);
        await expect
          .poll(async () => Object.keys(await paintedPoints(page)).length, { timeout: 30_000 })
          .toBeGreaterThan(0);
        Object.assign(all, await paintedPoints(page));
      }
      return all;
    };
    const before = await collect();
    expect(
      Object.keys(before).length,
      'all three highlights painted before the reload',
    ).toBeGreaterThanOrEqual(3);
    await page.reload();
    await open();
    const after = await collect();
    let worst = 0;
    for (const [anchorId, polys] of Object.entries(before)) {
      const again = after[anchorId];
      expect(again, `anchor ${anchorId} did not repaint after reload`).toBeDefined();
      const aNums = polys.join(' ').split(/[ ,]+/).map(Number);
      const bNums = (again ?? []).join(' ').split(/[ ,]+/).map(Number);
      expect(bNums.length).toBe(aNums.length);
      aNums.forEach((v, i) => {
        worst = Math.max(worst, Math.abs(v - (bNums[i] ?? Number.NaN)));
      });
    }
    note(
      `reload: all ${String(Object.keys(before).length)} anchors (a, b, c, each revealed on its page) repainted; worst quad Δ ${worst.toFixed(4)} pt (bar 0.5)`,
    );
    expect(worst).toBeLessThanOrEqual(0.5);
    await reveal(page, 'We reframe object');
    await page.screenshot({ path: shot('b06-reloaded-1440.png') });
    await page.getByRole('button', { name: 'Navigator' }).click();
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await expect(page.locator('[data-highlight-row]')).toHaveCount(3);
    for (const id of [a, b, c])
      await expect(page.locator(`[data-highlight-row="${id}"]`)).toHaveCount(1);
    await page.keyboard.press('Escape');

    // ── focusAnchor: a Navigator row scrolls to the passage and flashes it 1.2 s ──
    await page.getByRole('button', { name: 'Navigator' }).click();
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await page.locator(`[data-highlight-row="${b}"] .pt-hlrow`).click();
    const flash = page.locator('svg [data-flash="true"] polygon');
    await expect(flash.first()).toBeVisible({ timeout: 10_000 });
    const flashBox = await flash.first().boundingBox();
    const underFlash =
      flashBox === null
        ? 'none'
        : await page.evaluate(
            ([x, y]) => {
              const el = document.elementFromPoint(x, y);
              return el?.closest('.papertree-page')?.getAttribute('data-page-index') ?? 'none';
            },
            [flashBox.x + flashBox.width / 2, flashBox.y + flashBox.height / 2] as const,
          );
    note(`focusAnchor from the Navigator: flash painted on page index ${underFlash}`);
    const paintedOn = await page
      .locator(`svg .pt-hl[data-highlight-id="${b}"]`)
      .first()
      .evaluate((g) => g.closest('.papertree-page')?.getAttribute('data-page-index') ?? 'none');
    expect(underFlash).toBe(paintedOn);
    await page.screenshot({ path: shot('b06b-focus-flash-1440.png') });
    await expect(flash).toHaveCount(0, { timeout: 5_000 });
    await page.keyboard.press('Escape');

    // ── the keyboard reaches a highlight: focus it, Enter opens its card ──
    await page.locator(`svg .pt-hl[data-highlight-id="${b}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Highlight' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Highlight' })).toHaveCount(0);

    // ── zoom keeps the top line ──
    await reveal(page, 'Humans glance at an image');
    const zoomTo = async (value: string, label: string) => {
      const line = await topLine(page);
      await page.getByLabel('Zoom level').selectOption(value);
      await page.waitForTimeout(1200);
      const now = await lineOffset(page, line);
      expect(now, `${label}: the top line is no longer rendered`).not.toBeNull();
      const drift = Math.abs((now?.dy ?? 1e9) - line.dy);
      note(
        `zoom ${label}: top line "${line.text.slice(0, 40)}" moved ${drift.toFixed(1)} px (one line = ${(now?.height ?? 0).toFixed(1)} px)`,
      );
      expect(drift).toBeLessThanOrEqual(Math.max(now?.height ?? 0, 16));
      await page.screenshot({ path: shot(`b07-zoom-${label}-1440.png`) });
    };
    await zoomTo('1.5', '150');
    await zoomTo('fit-width', 'fit-width');
    await page.getByLabel('Zoom level').selectOption('1.25');
    await page.waitForTimeout(800);

    // ── modes: one getDocument, pages keep rendering, the position and the paint survive ──
    const opens = await getDocumentCalls(page);
    const where = await topLine(page);
    await page.getByRole('radio', { name: 'Guided' }).click();
    await expect(page.locator('[data-guided-root]')).toBeVisible();
    await expect
      .poll(() => page.locator(`.pt-guided mark[data-highlight-id="${a}"]`).count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const guidedReport = await page.evaluate(() => ({
      marks: document.querySelectorAll('.pt-guided mark').length,
      elementMarks: Array.from(document.querySelectorAll('.pt-guided [data-guided-mark]')).map(
        (el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 24)}`,
      ),
      notInView: Array.from(
        document.querySelectorAll('.pt-guided aside[aria-label="Highlights not shown here"] p'),
      ).map((p) => (p.textContent ?? '').slice(0, 90)),
    }));
    note(`Guided: (a) marked in its paragraph; ${JSON.stringify(guidedReport)}`);
    await page.screenshot({ path: shot('b08-guided-1440.png') });
    await page.getByRole('radio', { name: 'Source' }).click();
    await expect.poll(() => spanCount(page), { timeout: 60_000 }).toBeGreaterThan(50);
    await page.waitForTimeout(900);
    const back = await lineOffset(page, where);
    note(
      `Source → Guided → Source: top line back at Δ ${back === null ? 'n/a' : Math.abs(back.dy - where.dy).toFixed(1)} px`,
    );
    expect(back).not.toBeNull();
    expect(Math.abs((back?.dy ?? 1e9) - where.dy)).toBeLessThanOrEqual(
      Math.max(back?.height ?? 0, 16),
    );
    await page.getByRole('radio', { name: 'Split' }).click();
    await expect
      .poll(() => page.locator('[data-split-pane="source"] .papertree-text-layer span').count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(50);
    await expect(page.locator('[data-split-pane="guided"] [data-guided-root]')).toBeVisible();
    await page.screenshot({ path: shot('b09-split-1440.png') });
    await page.getByRole('radio', { name: 'Source' }).click();
    await expect.poll(() => spanCount(page), { timeout: 60_000 }).toBeGreaterThan(50);
    const opensAfter = await getDocumentCalls(page);
    note(
      `getDocument calls: ${String(opens)} after the reload, ${String(opensAfter)} after Guided, Source, Split, Source`,
    );
    expect(opensAfter).toBe(opens);
    expect(opensAfter).toBe(1);

    // ── the highlight card: colour and note, persisted ──
    await reveal(page, 'We reframe object');
    const aBox = union(await paintedBoxes(page, a));
    await page.mouse.click((aBox[0] + aBox[2]) / 2, aBox[1] + 4);
    const card = page.getByRole('dialog', { name: 'Highlight' });
    await expect(card).toBeVisible();
    const patched = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(a),
    );
    await card.getByRole('button', { name: 'Green' }).click();
    expect((await patched).status()).toBe(200);
    await card.getByLabel('Note').fill('the core idea');
    await page.screenshot({ path: shot('b10-highlight-card-1440.png') });
    const noted = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(a),
    );
    await card.getByRole('button', { name: 'Done' }).click();
    expect((await noted).status()).toBe(200);
    const stored = (await listHighlights(stack.apiUrl, token, paperId)).find(
      (h) => h.highlight_id === a,
    );
    expect(stored?.color).toBe('green');

    // ── a re-parse: links change, paint does not ──
    const paintGen1 = await collect();
    const reparse = simulateReparse(stack.dataRoot, user, paperId);
    await page.reload();
    await open();
    const paintGen2 = await collect();
    // Byte-identical for EVERY highlight: the SVG points strings, not a tolerance.
    expect(Object.keys(paintGen2).sort()).toEqual(Object.keys(paintGen1).sort());
    for (const [anchorId, polys] of Object.entries(paintGen1)) {
      expect(paintGen2[anchorId]).toEqual(polys);
    }
    await reveal(page, 'We reframe object');
    await expect
      .poll(
        () =>
          dbRows(stack.dataRoot, paperId).resolutions.find((r) => r.generation === 2)?.count ?? 0,
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThanOrEqual(3);
    note(
      `re-parse ${reparse}: paint byte-identical for all ${String(Object.keys(paintGen1).length)} anchors; rows ${JSON.stringify(dbRows(stack.dataRoot, paperId).resolutions)}`,
    );

    // ── an orphan: in the tray with its reason, painted nowhere ──
    const stamp = Date.now().toString(16).padStart(12, '0').slice(-12);
    const orphanHighlight = `hl_01E2EORPHAN${stamp.toUpperCase()}00`;
    const orphanAnchor = `0e0e0e0e-0000-4000-8000-${stamp}`;
    insertOrphan(stack.dataRoot, user, paperId, orphanHighlight, orphanAnchor);
    await page.reload();
    await open();
    const tray = page.getByRole('region', { name: 'Highlights that could not be placed' });
    await expect(tray).toBeVisible();
    await tray.getByRole('button', { name: /could not be placed/ }).click();
    await expect(tray.locator(`[data-anchor-id="${orphanAnchor}"]`)).toBeVisible();
    await expect(tray).toContainText('different PDF');
    expect(await page.locator(`svg [data-highlight-id="${orphanHighlight}"]`).count()).toBe(0);
    await page.getByRole('button', { name: 'Go to page 2' }).first().click();
    await page.waitForTimeout(900);
    expect(await page.locator(`svg [data-highlight-id="${orphanHighlight}"]`).count()).toBe(0);
    note(
      `orphan: in the tray ("${(await tray.locator('[data-anchor-id] p').first().textContent())?.slice(0, 90) ?? ''}"), painted on 0 pages`,
    );
    await page.screenshot({ path: shot('b11-orphan-tray-1440.png') });

    // ── the dark theme, for the record ──
    await page.emulateMedia({ colorScheme: 'dark' });
    await reveal(page, 'We reframe object');
    await page.screenshot({ path: shot('b11b-dark-1440.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    // ── 390 px ──
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await phone.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* see above */
      }
    }, token);
    const mobile = await phone.newPage();
    await mobile.goto(`/paper/${paperId}/read`);
    await expect
      .poll(() => mobile.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(20);
    expect(await mobile.evaluate(() => document.visibilityState)).toBe('visible');
    const layout = await mobile.evaluate(() => {
      const radios = Array.from(document.querySelectorAll('[role="radio"]')).map(
        (r) => r.getBoundingClientRect().right,
      );
      const pageEl = document.querySelector('.papertree-page');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        radioRight: Math.max(...radios),
        pageWidth: pageEl?.getBoundingClientRect().width ?? 0,
        zoomLabel:
          (document.querySelector('#papertree-zoom-select') as HTMLSelectElement | null)
            ?.selectedOptions[0]?.textContent ?? '',
      };
    });
    note(`390 px: ${JSON.stringify(layout)}`);
    expect(layout.scrollWidth).toBeLessThanOrEqual(390);
    expect(layout.radioRight).toBeLessThanOrEqual(390);
    expect(layout.pageWidth).toBeLessThanOrEqual(390);
    expect(layout.zoomLabel).toBe('Fit width');
    await mobile.screenshot({ path: shot('b12-open-390.png') });
    await reveal(mobile, 'We reframe object');
    await mobile.screenshot({ path: shot('b13-highlights-390.png') });
    const mPoints = await pointsFor(mobile, 'YOLO is refreshingly', 'see Figure');
    await drag(mobile, mPoints.from, mPoints.to);
    await expect(mobile.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible();
    const mHit = await hitTest(mobile, 'Highlight');
    expect(mHit.hit).toBe('button');
    await mobile.screenshot({ path: shot('b14-select-390.png') });
    await mobile.getByRole('button', { name: 'Navigator' }).click();
    await mobile.getByRole('tab', { name: /Highlights/ }).click();
    await mobile.screenshot({ path: shot('b15-navigator-390.png') });
    await mobile.keyboard.press('Escape');
    await mobile.getByRole('radio', { name: 'Guided' }).click();
    await expect(mobile.locator('[data-guided-root]')).toBeVisible();
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await mobile.screenshot({ path: shot('b16-guided-390.png') });
    await mobile.getByRole('radio', { name: 'Source' }).click();
    await expect.poll(() => spanCount(mobile), { timeout: 60_000 }).toBeGreaterThan(20);
    const mTray = mobile.getByRole('region', { name: 'Highlights that could not be placed' });
    await mTray.getByRole('button', { name: /could not be placed/ }).click();
    await mobile.screenshot({ path: shot('b17-tray-390.png') });

    await phone.close();
    await desktop.close();
    testInfo.annotations.push({ type: 's4-walk', description: report.join('\n') });
  });
});
