/**
 * S4 review regressions, walked on an uploaded YOLO the way the reviewer found them (s4-review.md
 * §4, `review/onepara.mjs` and `review/probe3.mjs`):
 *
 *   F1 — one mouse drag across ONE paragraph whose lines include one the IR did not stamp (a
 *        ligature: the IR says "ﬁcing", pdf.js "ficing") stored that line twice: a second,
 *        page-text anchor over the same glyphs, painted as a darker band. Now: one anchor, and every
 *        selected line is painted once, within 2 px of its selection line.
 *   F2 — a three-page selection became a 128-anchor POST, a raw 422 in the toast and a Retry that
 *        could never succeed. Now: the bar says why Highlight is off, and nothing is sent.
 *
 * YOLO is not in the committed corpus (S2's fresh set): the spec SKIPS, loudly, without it.
 */
import { expect, test } from '../harness/test';
import {
  drag,
  hitTest,
  paintedLines,
  perLineEdges,
  pointsFor,
  register,
  reveal,
  selectionRects,
  shotPath,
  upload,
  waitParsed,
  yoloPdf,
} from './support';

const YOLO = yoloPdf();

interface PostedAnchor {
  readonly anchor: {
    readonly doc: { readonly textStreamId: string };
    readonly selectors: readonly {
      readonly type: string;
      readonly exact?: string;
      readonly quads?: number[][];
    }[];
  };
}

test.describe('S4 review regressions — each glyph once; the 64-anchor limit', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF (arXiv 1506.02640) is not present. It is not in the committed corpus; set ' +
      'PAPERTREE_E2E_YOLO_PDF to a copy, or run research/benchmarks/fresh/fetch_fresh.sh (S2), then re-run.',
  );

  test('F1: one paragraph is one anchor; F2: three pages are refused in the bar', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, testInfo.outputPath('shots'));
    const note = (line: string) => console.log(`[e2e s4 review] ${line}`);
    const token = await register(stack.apiUrl, `e2e-s4-rev-${String(Date.now())}@papertree.test`);
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
        /* the walk needs storage */
      }
    }, token);
    const page = await context.newPage();
    const posts: { status: number; anchors: readonly PostedAnchor[] }[] = [];
    page.on('response', async (response) => {
      if (
        response.url().endsWith(`/papers/${paperId}/highlights`) &&
        response.request().method() === 'POST'
      ) {
        const body = response.request().postDataJSON() as { anchors: PostedAnchor[] };
        posts.push({ status: response.status(), anchors: body.anchors });
      }
    });
    await page.goto(`/paper/${paperId}/read`);
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(50);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    await page.getByLabel('Zoom level').selectOption('1.25');
    await page.waitForTimeout(1000);

    // ── F1 ──
    const first = 'Fastest DPM effectively speeds up';
    const last = 'neural network ap-';
    await reveal(page, first);
    // The precondition, asserted: a line inside the paragraph that the IR placed by geometry
    // (`data-block-id`) but could not give an offset (`data-cp-start`).
    const lines = await page.evaluate(
      ([a, b]) => {
        const spans = Array.from(
          document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
        );
        const from = spans.findIndex((s) => (s.textContent ?? '').includes(a));
        const to = spans.findIndex((s, i) => i >= from && (s.textContent ?? '').includes(b));
        return spans
          .slice(from, to + 1)
          .filter((s) => (s.textContent ?? '').trim() !== '')
          .map((s) => ({
            text: (s.textContent ?? '').slice(0, 32),
            placed: s.hasAttribute('data-block-id'),
            offset: s.hasAttribute('data-cp-start'),
          }));
      },
      [first, last] as const,
    );
    note(`paragraph items: ${JSON.stringify(lines)}`);
    expect(
      lines.some((l) => l.placed && !l.offset),
      'the paragraph must hold an item the IR placed but could not offset (the ligature line)',
    ).toBe(true);

    const points = await pointsFor(page, first, last);
    await drag(page, points.from, points.to);
    const selection = await selectionRects(page);
    const hit = await hitTest(page, 'Highlight');
    expect(hit.hit).toBe('button');
    const posted = page.waitForResponse(
      (r) => r.url().endsWith(`/papers/${paperId}/highlights`) && r.request().method() === 'POST',
    );
    await page.mouse.click(hit.x, hit.y);
    const response = await posted;
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { highlight_id: string };
    await page.waitForTimeout(500);
    const sent = posts.at(-1)?.anchors ?? [];
    note(
      `one drag across one paragraph → POST ${String(response.status())} with ${String(sent.length)} anchor(s): ` +
        JSON.stringify(
          sent.map((a) => (a.anchor.doc.textStreamId.startsWith('pdfjs@') ? 'page-text' : 'ir')),
        ),
    );
    expect(sent, 'one paragraph, one anchor (F1 stored the ligature line twice)').toHaveLength(1);
    const quads = sent.flatMap(
      (a) => a.anchor.selectors.find((s) => s.type === 'ShapeSelector')?.quads ?? [],
    );
    const keys = quads.map((q) => q.map((v) => v.toFixed(1)).join(','));
    expect(new Set(keys).size, 'no quad stored twice').toBe(keys.length);
    const perLine = perLineEdges(selection.rects, await paintedLines(page, created.highlight_id));
    note(
      `per line: worst edge Δ ${perLine.worst.toFixed(2)} px over ${String(perLine.lines.length)} lines`,
    );
    expect(perLine.unmatched).toBe(0);
    expect(perLine.worst).toBeLessThanOrEqual(2);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.click(5, 450);
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot('r01-one-paragraph-once-1440.png') });

    // ── F2 ──
    const before = posts.length;
    await page.getByLabel('Zoom level').selectOption('0.5');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-papertree-scroller]') as HTMLElement;
      scroller.scrollTop = 350;
    });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [1, 2, 3].every(
              (i) =>
                document.querySelectorAll(
                  `.papertree-page[data-page-index="${String(i)}"] .papertree-text-layer span[data-item-index]`,
                ).length > 20,
            ),
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    const made = await page.evaluate(() => {
      const spansOf = (i: number) =>
        Array.from(
          document.querySelectorAll(
            `.papertree-page[data-page-index="${String(i)}"] .papertree-text-layer span[data-item-index]`,
          ),
        ).filter((s) => (s.textContent ?? '').trim().length > 3);
      const a = spansOf(1)[0];
      const b = spansOf(3).at(-1);
      if (a === undefined || b === undefined) return 0;
      const range = document.createRange();
      range.setStart(a.firstChild as Text, 0);
      range.setEnd(b.firstChild as Text, (b.textContent ?? '').length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('pointerup'));
      return selection?.toString().length ?? 0;
    });
    note(`a selection of pages 2–4: ${String(made)} characters`);
    expect(made).toBeGreaterThan(5000);
    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' });
    await expect(toolbar).toBeVisible();
    const button = page.getByRole('button', { name: 'Highlight', exact: true });
    await expect(button).toBeDisabled();
    const said = (await toolbar.textContent()) ?? '';
    note(`the bar says: "${said.replace(/\s+/g, ' ').trim()}"`);
    expect(said).toMatch(/covers \d+ passages; one highlight holds up to 64/);
    expect(said).not.toMatch(/List should have|validation/);
    await toolbar.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot('r02-long-selection-refused-1440.png') });
    await button.click({ force: true });
    await page.waitForTimeout(1500);
    expect(posts.length, 'nothing is sent for a refused selection').toBe(before);
    await context.close();
  });
});
