/**
 * RFIX R6 — the reader blames the right thing when the PDF cannot be opened.
 *
 * Before: a pdf.js worker script that failed to load (404/503) said "This PDF could not be opened …
 * the file itself may be damaged", sending the reader to re-upload a good paper. Now a worker/script/
 * network failure says the reader's PDF engine could not start, and only InvalidPDF/MissingPDF say
 * the copy is bad.
 */
import { expect, test } from '../harness/test';
import { register, shotPath, upload, waitParsed, yolo } from './support';

const YOLO = yolo();

test.describe('RFIX R6 — an honest PDF-engine error', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF is not present (research/benchmarks/fresh/pdfs).',
  );

  test('a 503 on the pdf.js worker says the engine could not start; a bad file says the file is bad', async ({
    browser,
    stack,
  }, testInfo) => {
    test.setTimeout(600_000);
    const note = (line: string): void => console.log(`[e2e rfix R6] ${line}`);
    const token = await register(stack.apiUrl, `e2e-rfix-r6-${String(Date.now())}@papertree.test`);
    const paperId = await upload(stack.apiUrl, token, YOLO as string);
    await waitParsed(stack.apiUrl, token, paperId);

    const open = async (viewport: { width: number; height: number }) => {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await context.addInitScript((t) => {
        try {
          window.localStorage.setItem('papertree.session', t);
        } catch {
          /* the walk needs storage */
        }
      }, token);
      return { context, page: await context.newPage() };
    };

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      // ── the engine: the worker script answers 503 ───────────────────────────────────────
      {
        const { context, page } = await open(viewport);
        let hits = 0;
        await context.route('**/pdf.worker.min.mjs', (route) => {
          hits += 1;
          return route.fulfill({
            status: 503,
            contentType: 'text/plain',
            body: 'Service Unavailable',
          });
        });
        await page.goto(`/paper/${paperId}/read`);
        const alert = page.locator('.pt-state[role="alert"]');
        await expect(alert).toContainText('could not start its PDF engine', { timeout: 120_000 });
        const text = (await alert.innerText()).replace(/\s+/gu, ' ');
        note(
          `${String(viewport.width)}px, worker 503 (${String(hits)} request(s)): ${JSON.stringify(text)}`,
        );
        expect(text).toContain(
          'Reload the page; if it keeps happening, the server is missing a file.',
        );
        expect(text).not.toMatch(/damaged|could not be read as a PDF/iu);
        await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
          'no horizontal scroll',
        ).toBeLessThanOrEqual(viewport.width);
        await page.screenshot({
          path: shotPath(
            `r6-engine-error-${String(viewport.width)}.png`,
            testInfo.outputPath('shots'),
          ),
        });

        // The server is fixed; Try again must be able to recover (or at least not lie).
        await context.unroute('**/pdf.worker.min.mjs');
        await alert.getByRole('button', { name: 'Try again' }).click();
        const recovered = await page
          .locator('.papertree-text-layer span[data-item-index]')
          .first()
          .waitFor({ timeout: 60_000 })
          .then(
            () => true,
            () => false,
          );
        note(
          `${String(viewport.width)}px: after the worker came back, Try again ${recovered ? 'RECOVERED the reader' : 'did NOT recover'}`,
        );
        expect(
          recovered,
          'Try again must bring the reader back once the worker is served again',
        ).toBe(true);
        await context.close();
      }

      // ── the file: the bytes are not a PDF ───────────────────────────────────────────────
      {
        const { context, page } = await open(viewport);
        await context.route(`**/papers/${paperId}/file`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/pdf',
            body: 'this is not a pdf, it is a short note of plain text',
          }),
        );
        await page.goto(`/paper/${paperId}/read`);
        const alert = page.locator('.pt-state[role="alert"]');
        await expect(alert).toContainText('This PDF could not be opened', { timeout: 120_000 });
        const text = (await alert.innerText()).replace(/\s+/gu, ' ');
        note(`${String(viewport.width)}px, not-a-PDF bytes: ${JSON.stringify(text)}`);
        expect(text).toContain('may be damaged');
        expect(text).not.toContain('PDF engine');
        await page.screenshot({
          path: shotPath(
            `r6-file-error-${String(viewport.width)}.png`,
            testInfo.outputPath('shots'),
          ),
        });
        await context.close();
      }
    }
  });
});
