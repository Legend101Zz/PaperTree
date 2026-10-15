/**
 * RFIX R2 — creating a highlight must not move the view.
 *
 * Found by walking release/v0.1 in a real Chrome: clicking Highlight in the selection toolbar made
 * the page jump ~100 px (the highlighted paragraph went from y~600 to y~500 in the viewport).
 *
 * The scroll position of the reader's own scroll container, and the viewport position of the
 * highlighted paragraph, are sampled before the click and at 100 ms, 600 ms and 1.5 s after it.
 */
import { expect, test } from '../harness/test';
import { drag, shotPath } from '../s4/support';
import { openReader, revealText, spanBox, yolo, SCROLLER } from './support';

const YOLO = yolo();

test.describe('RFIX R2 — no jump when a highlight is created', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF is not present (research/benchmarks/fresh/pdfs).',
  );

  for (const viewport of [
    { width: 1440, height: 900, dpr: 1 },
    { width: 1120, height: 720, dpr: 1.25 },
    { width: 1120, height: 720, dpr: 2 },
    { width: 390, height: 844, dpr: 3 },
  ]) {
    test(`Highlight leaves the scroll position alone at ${String(viewport.width)}x${String(viewport.height)} @${String(viewport.dpr)}x`, async ({
      browser,
      stack,
    }, testInfo) => {
      test.setTimeout(600_000);
      const note = (line: string): void => console.log(`[e2e rfix R2] ${line}`);
      const { page, paperId } = await openReader(
        browser,
        stack.apiUrl,
        YOLO as string,
        { width: viewport.width, height: viewport.height },
        `r2-${String(viewport.width)}`,
        viewport.dpr,
      );
      await revealText(page, 'We reframe object detection');
      // Where the walk found it: low in the window (y ~ 2/3 of the height), not centred. Moved with
      // real WHEEL events, as a reader's trackpad does, so the scroll handlers run the way they do live.
      const lowTop = viewport.height * 0.66;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const now = (await spanBox(page, 'We reframe object detection')).top;
        if (Math.abs(now - lowTop) < 3) break;
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, now - lowTop);
        await page.waitForTimeout(700);
      }
      await page.waitForTimeout(600);

      const first = await spanBox(page, 'We reframe object detection');
      const last = await spanBox(page, 'present and where they are.');
      await drag(
        page,
        { x: first.left + 0.5, y: (first.top + first.bottom) / 2 },
        { x: last.right + 30, y: (last.top + last.bottom) / 2 },
      );
      const button = page.getByRole('button', { name: 'Highlight', exact: true });
      await expect(button).toBeVisible();

      const sample = async (): Promise<{ scroll: number; paragraphTop: number }> =>
        page.evaluate(
          ([selector, text]) => {
            const scroller = document.querySelector(selector as string) as HTMLElement;
            const span = Array.from(
              document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
            ).find((s) => (s.textContent ?? '').includes(text as string));
            return {
              scroll: scroller.scrollTop,
              paragraphTop: span === undefined ? Number.NaN : span.getBoundingClientRect().top,
            };
          },
          [SCROLLER, 'We reframe object detection'] as const,
        );

      // A frame-by-frame recorder: a transient jump that settles back would be missed by sampling.
      await page.evaluate(
        ([selector, text]) => {
          const scroller = document.querySelector(selector as string) as HTMLElement;
          const w = window as unknown as {
            __rfixTrace: { t: number; scroll: number; top: number }[];
            __rfixStop: boolean;
          };
          w.__rfixTrace = [];
          w.__rfixStop = false;
          const tick = (): void => {
            const span = Array.from(
              document.querySelectorAll('.papertree-text-layer span[data-item-index]'),
            ).find((s) => (s.textContent ?? '').includes(text as string));
            w.__rfixTrace.push({
              t: performance.now(),
              scroll: scroller.scrollTop,
              top: span === undefined ? Number.NaN : span.getBoundingClientRect().top,
            });
            if (!w.__rfixStop) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
        [SCROLLER, 'We reframe object detection'] as const,
      );
      const before = await sample();
      const posted = page.waitForResponse(
        (r) => r.url().endsWith(`/papers/${paperId}/highlights`) && r.request().method() === 'POST',
      );
      const box = await button.boundingBox();
      if (box === null) throw new Error('no Highlight button box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      expect((await posted).status()).toBe(201);

      const after: { scroll: number; paragraphTop: number }[] = [];
      for (const wait of [100, 500, 900]) {
        await page.waitForTimeout(wait);
        after.push(await sample());
      }
      const trace = await page.evaluate(() => {
        const w = window as unknown as {
          __rfixTrace: { scroll: number; top: number }[];
          __rfixStop: boolean;
        };
        w.__rfixStop = true;
        return w.__rfixTrace;
      });
      const frameDrift = Math.max(
        ...trace.map((f) => Math.abs(f.scroll - before.scroll)),
        ...trace
          .filter((f) => !Number.isNaN(f.top))
          .map((f) => Math.abs(f.top - before.paragraphTop)),
      );
      note(
        `${String(trace.length)} frames recorded, worst per-frame drift ${frameDrift.toFixed(2)} px`,
      );
      expect(frameDrift).toBeLessThanOrEqual(2);
      const drift = Math.max(
        ...after.map((a) => Math.abs(a.scroll - before.scroll)),
        ...after.map((a) => Math.abs(a.paragraphTop - before.paragraphTop)),
      );
      note(
        `${String(viewport.width)}px: before ${JSON.stringify(before)}; after ${JSON.stringify(after)}; worst drift ${drift.toFixed(2)} px`,
      );
      await page.screenshot({
        path: shotPath(
          `r2-after-highlight-${String(viewport.width)}.png`,
          testInfo.outputPath('shots'),
        ),
      });
      for (const a of after) {
        expect(Math.abs(a.scroll - before.scroll)).toBeLessThanOrEqual(2);
        expect(Math.abs(a.paragraphTop - before.paragraphTop)).toBeLessThanOrEqual(2);
      }
    });
  }
});
