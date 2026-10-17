/**
 * S2f (#197) on the real stack: the Table tab → sort by Year (aria-sort, a second press reverses
 * the two known years, an unknown year stays last) → a paper that could not be read says "Could
 * not read" with Retry → "N need a look" opens the Table filtered to it. The brief names the demo
 * account for the first half; the e2e stack has none, so a new account holds two corpus PDFs
 * (ResNet, 2015, and Attention, 2017, years from their arXiv ids) and one garbage PDF (the failed
 * paper). With the sample papers on (harness/stack.ts) they are rows too, with no year. The PDFs
 * are the committed corpus's; the spec SKIPS, loudly, without them.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, upload, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';

const CORPUS = join(REPO, 'research', 'benchmarks', 'corpus');
const ATTENTION = join(CORPUS, 'attention-is-all-you-need.pdf');
const RESNET = join(CORPUS, 'resnet-cvpr-2col.pdf');
const GARBAGE = '%PDF-1.4\nthis is not a real pdf\n%%EOF\n';

test.use({ actionTimeout: 20_000 });

/** `POST /papers` with bytes that are not a PDF the parser can read. */
async function uploadGarbage(apiUrl: string, token: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([GARBAGE], { type: 'application/pdf' }), 'garbage.pdf');
  const response = await fetch(`${apiUrl}/papers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { paper_id: string }).paper_id;
}

test('Table → sort by Year → Could not read with Retry → "need a look" filters it', async ({
  page,
  stack,
}, info) => {
  test.skip(
    !existsSync(ATTENTION) || !existsSync(RESNET),
    'SKIPPED: the corpus PDFs attention-is-all-you-need.pdf and resnet-cvpr-2col.pdf are absent. Run research/benchmarks/fetch_corpus.sh.',
  );
  test.setTimeout(600_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-s2f-${String(Date.now())}@papertree.test`);
  const attention = await upload(stack.apiUrl, token, ATTENTION);
  const resnet = await upload(stack.apiUrl, token, RESNET);
  const garbage = await uploadGarbage(stack.apiUrl, token);
  await waitParsed(stack.apiUrl, token, attention);
  await waitParsed(stack.apiUrl, token, resnet);

  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const table = page.getByRole('table', { name: 'Papers' });
  await expect(table.locator(`tr[data-row-id="${garbage}"]`)).toHaveAttribute(
    'data-processing-state',
    'failed',
    { timeout: 120_000 },
  );

  // ── sort by Year: the two known years in order, then reversed; the unknown ones last both ways ──
  const year = table.getByRole('columnheader', { name: /^Year/ });
  await year.getByRole('button').click();
  await expect(year).toHaveAttribute('aria-sort', 'ascending');
  const order = () =>
    table
      .locator('tbody tr[data-row-id]')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-row-id')));
  const ascending = await order();
  expect(ascending.slice(0, 2)).toEqual([resnet, attention]);
  expect(ascending.indexOf(garbage)).toBeGreaterThan(1);
  await year.getByRole('button').click();
  await expect(year).toHaveAttribute('aria-sort', 'descending');
  const descending = await order();
  expect(descending.slice(0, 2)).toEqual([attention, resnet]);
  expect(descending.indexOf(garbage)).toBeGreaterThan(1);
  await expect(page.getByText('Sorted by year, newest first, then title')).toBeVisible();

  // ── the paper we could not read: its state and Retry ──
  const failed = table.locator(`tr[data-row-id="${garbage}"]`);
  await expect(failed.getByText('Could not read', { exact: true })).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Retry reading garbage' })).toBeVisible();
  await expect(
    table.locator(`tr[data-row-id="${attention}"]`).getByRole('button', { name: /^Retry/ }),
  ).toHaveCount(0);
  await page.screenshot({ path: shot('s2f-table-by-year-1440.png') });

  // ── "need a look" opens the Table filtered to it ──
  await page.getByRole('button', { name: 'Shelf', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Shelf' })).toBeVisible();
  await page
    .getByRole('button', { name: /need a look/ })
    .first()
    .click();
  const look = page.getByRole('table', { name: 'Papers that need a look' });
  await expect(look).toBeVisible();
  expect(await look.locator('tbody tr[data-row-id]').count()).toBe(1);
  await expect(look.locator(`tr[data-row-id="${garbage}"]`)).toBeVisible();
  await expect(page.getByText('garbage could not be read.')).toBeVisible();
  await page.screenshot({ path: shot('s2f-need-a-look-1440.png') });
});
