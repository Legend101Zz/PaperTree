/**
 * S3 regression: the upload row leaves "Waiting to upload" after the 202 (the StrictMode
 * `mountedRef` freeze, #141), and the card it creates goes Queued/Reading -> Ready WITHOUT a reload.
 *
 * `next dev` runs React StrictMode, which mounts, cleans up and re-mounts every component. The old
 * `UploadDropzone` set `mountedRef.current = false` in that cleanup and never set it back, so every
 * later `patch()` was dropped: the row stayed on "Waiting to upload" for ever even though the
 * server had answered 202. A unit test that renders the component outside StrictMode cannot see it.
 *
 * Also asserted, because they are the same wiring: a settled library makes no further
 * `GET /papers`, and Cancel mid-upload leaves no paper behind.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';

/** One poll interval (2 s, LibraryView) plus 0.5 s: a request in flight at Ready may still land. */
const POLL_INTERVAL_SETTLE_MS = 2_500;

const PDF = join(__dirname, '..', '..', 'research', 'benchmarks', 'corpus', 'resnet-cvpr-2col.pdf');

test.describe('S3 upload row', () => {
  test('the row leaves "Waiting to upload" and the card reaches Ready without a reload', async ({
    page,
    stack,
  }) => {
    test.skip(
      !existsSync(PDF),
      `SKIPPED: ${PDF} is absent; run ./research/benchmarks/fetch_corpus.sh first.`,
    );

    const email = `e2e-s3-${String(Date.now())}@papertree.test`;
    const log: string[] = [];
    let polls = 0;
    const t0 = Date.now();
    const settledAt = { value: -1 };
    page.on('response', (r) => {
      if (r.url() === `${stack.apiUrl}/papers` && r.request().method() === 'GET') {
        void r
          .json()
          .then((rows: { processing?: string }[]) => {
            log.push(
              `+${String(Date.now() - t0)} ms response ${rows.map((x) => x.processing ?? '?').join(',')}`,
            );
          })
          .catch(() => undefined);
      }
    });
    page.on('request', (r) => {
      if (r.url() === `${stack.apiUrl}/papers` && r.method() === 'GET') {
        log.push(`+${String(Date.now() - t0)} ms request`);
        // Counting starts POLL_INTERVAL_SETTLE_MS after the card is Ready (below).
        if (settledAt.value >= 0 && Date.now() - t0 >= settledAt.value) polls += 1;
      }
    });
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('e2e-password-1');
    await page.getByLabel('Confirm password').fill('e2e-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();

    // A marker that a full page load would erase: proves "no reload".
    await page.evaluate(() => {
      (window as unknown as { __s3NoReload: boolean }).__s3NoReload = true;
    });

    const posted = page.waitForResponse(
      (r) => r.url() === `${stack.apiUrl}/papers` && r.request().method() === 'POST',
    );
    await page.locator('[data-add-papers] input[type=file]').setInputFiles(PDF);
    const accepted = await posted;
    expect(accepted.status()).toBe(202);
    const uploaded = ((await accepted.json()) as { paper: { paper_id: string } }).paper.paper_id;
    log.push(`+${String(Date.now() - t0)} ms POST 202`);

    // THE REGRESSION: the row must move on from "Waiting to upload". It may also already be gone
    // (W2UI: the row is dropped the moment the server row is in the list), so the assertion is on
    // what must never be on screen, not on the row's presence.
    await expect(page.getByText('Waiting to upload')).toHaveCount(0);
    await expect(page.locator('[data-testid=upload-queue] li')).toHaveCount(0);

    // The card exists at once (from the 202's `paper`) and finishes on its own. It is found by the
    // UPLOADED paper's id: with fixtures on, the first `[data-paper-id]` is a sample card that is
    // "complete" from the start, which made this wait pass at once and the poll count start while
    // the real paper was still Queued (the flake on the Linux runner).
    const card = page.locator(`[data-paper-id="${uploaded}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-processing-state', /^(complete|partial)$/, {
      timeout: 120_000,
    });
    log.push(`+${String(Date.now() - t0)} ms card ready`);
    await expect(card).not.toContainText('ppr_');

    expect(
      await page.evaluate(
        () => (window as unknown as { __s3NoReload?: boolean }).__s3NoReload === true,
      ),
    ).toBe(true);

    // Settled: nothing polls any more. Every GET /papers is logged with its time and the states
    // it returned, so a failure shows WHICH request landed and what it said.
    await page.waitForTimeout(POLL_INTERVAL_SETTLE_MS);
    settledAt.value = Date.now() - t0;
    await page.waitForTimeout(6_000);
    console.log(`[e2e s3] GET /papers log: ${log.join(' | ')}`);
    expect(polls, `a settled library must not poll GET /papers; log: ${log.join(' | ')}`).toBe(0);
  });
});
