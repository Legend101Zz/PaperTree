/**
 * S2g (#198) on the real stack: a new account with the five corpus papers (Attention, BERT, DDPM,
 * ResNet, YOLO) → Topics says how topics arrive → New topic "Transformers & attention" → Attention
 * is shelved on it by hand (S2b offers only a topic that already holds a paper of the same arXiv
 * category, so a person's first paper on a topic is their own choice) → BERT (cs.CL) is then
 * offered it, and accepting moves it off Unshelved → the Map shows the island with both, and the
 * BERT → Attention citation link, labelled "matched by title", drawn and listed. The PDFs are the
 * committed corpus's; the spec SKIPS, loudly, without them.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { register, REPO, shotPath, upload, waitParsed } from '../s4/support';
import { tokenInit } from '../s7/support';

const BENCH = join(REPO, 'research', 'benchmarks');
const PDFS = [
  join(BENCH, 'corpus', 'attention-is-all-you-need.pdf'),
  join(BENCH, 'corpus', 'bert-2col.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'ddpm-2006.11239.pdf'),
  join(BENCH, 'corpus', 'resnet-cvpr-2col.pdf'),
  join(BENCH, 'fresh', 'pdfs', 'yolo-1506.02640.pdf'),
];
const TOPIC = 'Transformers & attention';

test.use({ actionTimeout: 20_000 });

test('Topics → create a topic → accept BERT’s suggestion → the Map’s island and real link', async ({
  page,
  stack,
}, info) => {
  const missing = PDFS.filter((pdf) => !existsSync(pdf));
  test.skip(
    missing.length > 0,
    `SKIPPED: corpus PDFs absent (${missing.join(', ')}). Run research/benchmarks/fetch_corpus.sh and research/benchmarks/fresh/fetch_fresh.sh.`,
  );
  test.setTimeout(900_000);
  const shot = (name: string) => shotPath(name, info.outputPath('shots'));
  const token = await register(stack.apiUrl, `e2e-s2g-${String(Date.now())}@papertree.test`);
  const [attention, bert] = await Promise.all(PDFS.map((pdf) => upload(stack.apiUrl, token, pdf)));
  for (const id of [attention, bert]) await waitParsed(stack.apiUrl, token, id ?? '', 480_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await tokenInit(page, token);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await page.getByRole('button', { name: 'Topics', exact: true }).click();
  await expect(page.getByText('No topics yet')).toBeVisible();

  // ── create the topic ──
  await page.getByRole('button', { name: 'New topic' }).click();
  const form = page.getByRole('group', { name: 'New topic' });
  await form.getByLabel('Name').fill(TOPIC);
  await form.getByRole('button', { name: 'Create topic' }).click();
  await expect(page.getByRole('button', { name: TOPIC, exact: true })).toBeVisible();

  // ── Attention by hand; then BERT is offered the topic, and accepting shelves it ──
  const unshelved = page.getByRole('region', { name: 'Unshelved' });
  const row = (id: string | undefined) => unshelved.locator(`[data-paper-id="${id ?? ''}"]`);
  await row(attention)
    .getByLabel(/^Choose a topic for Attention/)
    .selectOption({ label: TOPIC });
  await row(attention)
    .getByRole('button', { name: /^Shelve Attention/ })
    .click();
  await expect(row(attention)).toHaveCount(0);
  await expect(row(bert)).toContainText(`Suggested: ${TOPIC} · from arXiv cs.CL`);
  await row(bert).getByRole('button', { name: 'Accept the suggestion for BERT' }).click();
  await expect(row(bert)).toHaveCount(0);
  const card = page.locator('.pt-topiccard').filter({ hasText: TOPIC });
  await expect(card).toContainText('2 papers');
  await expect(card).toContainText('Suggested from arXiv cs.CL · you accepted · 1 chosen by you');
  await page.screenshot({ path: shot('s2g-topics-1440.png') });

  // ── the Map: the island holds both, and the real link says how it matched ──
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const plan = page.getByRole('img', { name: /^Plan of the reading room: 1 topic, 5 papers/ });
  await expect(plan).toBeVisible();
  const island = plan.locator('[data-group]').filter({ hasText: 'Transformers' }).first();
  await expect(island.locator(`[data-paper-id="${attention ?? ''}"]`)).toHaveCount(1);
  await expect(island.locator(`[data-paper-id="${bert ?? ''}"]`)).toHaveCount(1);
  await expect(plan.locator('.pt-map__link[data-matched-by="title"]').first()).toBeVisible();
  await page.getByText('The plan as a list').click();
  await expect(
    page
      .locator('[data-map-links] li')
      .filter({ hasText: /^BERT cites Attention Is All You Need/ }),
  ).toHaveText('BERT cites Attention Is All You Need · matched by title');
  await page.screenshot({ path: shot('s2g-map-1440.png'), fullPage: true });
});
