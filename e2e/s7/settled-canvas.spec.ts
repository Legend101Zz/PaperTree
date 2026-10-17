/**
 * A settled canvas makes 0 requests (contracts.md §2.7): once the board has loaded and the page is
 * idle there is no polling, no refetch on focus or visibility change, and no autosave timer.
 *
 * Counted: every request from the page to the API, and every non-asset request to the web server
 * (Next's dev-only HMR socket is a WebSocket, not a request, and `/_next/static` is the page's own
 * files). The window is 30 s of idle after the last node is on screen, with a focus and a
 * visibility event fired in the middle to catch a refetch-on-focus.
 */
import { expect, test } from '../harness/test';
import { api, getBoard, seedPaper, tokenInit } from './support';

test.use({ actionTimeout: 20_000 });

test('a settled canvas makes 0 requests in 30 s', async ({ browser, stack }) => {
  test.setTimeout(300_000);
  const { token, paperId } = await seedPaper(stack.apiUrl, 'settled');
  for (const [i, kind] of (['note', 'note', 'group'] as const).entries()) {
    const made = await api(stack.apiUrl, token, 'POST', `/papers/${paperId}/board/nodes`, {
      node_id: `cn_${crypto.randomUUID()}`,
      kind,
      x: i * 420,
      y: 0,
      w: 260,
      h: 150,
      body: `seeded ${String(i)}`,
    });
    expect(made.status).toBe(201);
  }
  expect((await getBoard(stack.apiUrl, token, paperId)).nodes).toHaveLength(3);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await tokenInit(page, token);
  await page.goto(`/paper/${paperId}/board`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  // Let first paint, fitView and the font/asset requests finish before the window opens.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/__nextjs')) return;
    requests.push(`${request.method()} ${request.url()}`);
  });
  await page.waitForTimeout(15_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(15_000);
  expect(requests).toEqual([]);
  await context.close();
});
