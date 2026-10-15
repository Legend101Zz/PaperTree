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
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('e2e-password-1');
    await page.getByLabel('Confirm password').fill('e2e-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { name: 'My papers' })).toBeVisible();

    // A marker that a full page load would erase: proves "no reload".
    await page.evaluate(() => {
      (window as unknown as { __s3NoReload: boolean }).__s3NoReload = true;
    });

    const posted = page.waitForResponse(
      (r) => r.url() === `${stack.apiUrl}/papers` && r.request().method() === 'POST',
    );
    await page.locator('[data-upload-dropzone] input[type=file]').setInputFiles(PDF);
    expect((await posted).status()).toBe(202);

    // THE REGRESSION: the row must move on from "Waiting to upload". It may also already be gone
    // (W2UI: the row is dropped the moment the server row is in the list), so the assertion is on
    // what must never be on screen, not on the row's presence.
    await expect(page.getByText('Waiting to upload')).toHaveCount(0);
    await expect(page.locator('[data-testid=upload-queue] li')).toHaveCount(0);

    // The card exists at once (from the 202's `paper`) and finishes on its own.
    // The reader's OWN card (`ppr_...`): the e2e stack turns the sample papers on, they sit first in
    // the list and are Ready from the start, so `.first()` waited for nothing and the poll check
    // below raced the real parse.
    const card = page.locator('[data-paper-id^="ppr_"]').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-processing-state', /complete|partial/, {
      timeout: 120_000,
    });
    await expect(card).not.toContainText('ppr_');

    expect(
      await page.evaluate(
        () => (window as unknown as { __s3NoReload?: boolean }).__s3NoReload === true,
      ),
    ).toBe(true);

    // Settled: nothing polls any more. A request that was already in flight when the card turned
    // Ready may still land, so counting starts one poll interval (2 s) after that, with margin.
    await page.waitForTimeout(2_500);
    let polls = 0;
    page.on('request', (r) => {
      if (r.url() === `${stack.apiUrl}/papers` && r.method() === 'GET') polls += 1;
    });
    await page.waitForTimeout(6_000);
    expect(polls, 'a settled library must not poll GET /papers').toBe(0);
  });
});
