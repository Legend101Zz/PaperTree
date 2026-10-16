/**
 * #204 (frames 04b, 04c) on the FAUX agent: select a sentence of "Attention Is All You Need" →
 * Explain → a slow follow-up streams with the working label, the caret, Stop on its tab row and the
 * live marker of a passage the thread already cited → Stop keeps the part that arrived, with Retry
 * → a follow-up refused by the daily cap (the 429 is the route's, fulfilled by the test: the faux
 * stack's cap is not reachable in a test) shows the card, stamps "not sent" and keeps the text.
 *
 * The PDF is the committed corpus's; the spec SKIPS, loudly, without it or without the agent.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import {
  drag,
  pointsFor,
  register,
  REPO,
  reveal,
  shotPath,
  upload,
  waitParsed,
} from '../s4/support';

const ATTENTION = join(REPO, 'research', 'benchmarks', 'corpus', 'attention-is-all-you-need.pdf');

test.describe('#204: streaming, Stop and the daily cap (faux agent)', () => {
  test.skip(
    !existsSync(ATTENTION),
    'SKIPPED: the corpus PDF attention-is-all-you-need.pdf is absent. Run research/benchmarks/fetch_corpus.sh.',
  );

  test('Stop mid-stream keeps the part that arrived; the cap keeps the question', async ({
    browser,
    stack,
  }, info) => {
    test.skip(stack.agent !== 'running', 'SKIPPED: the e2e stack has no agent.');
    test.setTimeout(600_000);
    const shot = (name: string) => shotPath(name, info.outputPath('shots'));
    const token = await register(
      stack.apiUrl,
      `e2e-v02-states-${String(Date.now())}@papertree.test`,
    );
    const paperId = await upload(stack.apiUrl, token, ATTENTION);
    await waitParsed(stack.apiUrl, token, paperId);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('papertree.session', t);
      } catch {
        /* a context without storage is not this walk */
      }
    }, token);
    const page = await context.newPage();
    await page.goto(`/paper/${paperId}/read`);
    await expect
      .poll(() => page.locator('.papertree-text-layer span[data-cp-start]').count(), {
        timeout: 180_000,
      })
      .toBeGreaterThan(50);
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');

    await reveal(page, 'We propose a new simple network architecture');
    const points = await pointsFor(
      page,
      'We propose a new simple network architecture',
      'entirely.',
    );
    await drag(page, points.from, points.to);
    await page
      .getByRole('toolbar', { name: 'Selection actions' })
      .getByRole('button', { name: /Explain|Ask/ })
      .first()
      .click();
    const panel = page.getByRole('complementary', { name: 'Explain' });
    await expect(panel.locator('[data-message-status="complete"]')).toHaveCount(1, {
      timeout: 120_000,
    });

    // ── 04b: a slow follow-up streams; its [b1] is the thread's passage 1, so marker 1 shows live ──
    const box = panel.getByLabel('Ask a question about this paper');
    await box.fill('[faux:slow] Say more about the first passage.');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    const live = panel.locator('[data-message-status="streaming"]');
    await expect(live).toContainText('This answer streams slowly', { timeout: 60_000 });
    await expect(live.locator('.pt-ai-slip__source [role="status"]')).toContainText('…');
    await expect(live.locator('.pt-exchange__caret')).toHaveCount(1);
    await expect(live.locator('[data-passage="1"] button').first()).toBeVisible({
      timeout: 30_000,
    });
    expect((await live.innerText()).replace(/\s+/g, ' ')).not.toMatch(/\[b|\bb\d+\b/);
    await page.screenshot({ path: shot('v02-states-01-streaming-1440.png') });

    // ── 04c state 1: Stop on the tab row → the kept part and Retry ──
    await live.getByRole('button', { name: 'Stop' }).click();
    const stopped = panel.locator('[data-message-status]').last();
    await expect(stopped).toContainText('Stopped. The part that arrived is kept.', {
      timeout: 30_000,
    });
    await expect(stopped.getByRole('button', { name: 'Retry' })).toBeFocused();
    await expect(stopped).toContainText('This answer streams slowly');
    await expect(stopped.locator('.pt-ai-slip__source')).toContainText('Stopped ·');
    expect((await stopped.innerText()).replace(/\s+/g, ' ')).not.toMatch(/kept above|\[b\d/);
    await page.screenshot({ path: shot('v02-states-02-stopped-1440.png') });

    // ── 04c state 2: the daily cap refuses the next question before it is sent ──
    await page.route('**/threads/*/messages', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'daily budget used',
          code: 'budget_exhausted',
          retryable: false,
        }),
      }),
    );
    const question = 'Why does dropping recurrence make training faster?';
    await box.fill(question);
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    const card = panel.locator('.pt-budget-card');
    await expect(card.locator('.pt-budget-card__title')).toHaveText('Daily spend cap reached');
    await expect(card.locator('[data-budget-detail]')).toContainText(
      // Cents, or four decimals below a cent (`formatUsd`): a fresh stack has spent a fraction of one.
      /^≈ \$\d+\.\d{2,4} of \$\d+\.\d{2,4} used in the last 24 hours \(estimate\)\.$/,
    );
    await expect(card).toContainText(
      'Your question was not sent; your text is kept in the box below. Reading, highlights, the board and cached summaries still work.',
    );
    await expect(box).toHaveValue(question);
    await expect(panel.locator('.pt-exchange__not-sent')).toHaveText(/not sent/i);
    expect(await card.getByRole('link').count()).toBe(0);
    await page.screenshot({ path: shot('v02-states-03-daily-cap-1440.png') });
    await page.unroute('**/threads/*/messages');
    await context.close();
  });
});
