/**
 * The LIVE journey's own Playwright config (.github/workflows/live-journey.yml, #141).
 *
 *     npx playwright test -c e2e/live/playwright.live.config.ts
 *
 * Unlike `e2e/playwright.config.ts` there is NO global setup: the stack (api, worker, agent with
 * the real MiniMax key, web) is started by the workflow, step by step, so the key reaches the agent
 * step's environment and nothing else. This config only says where it is:
 *
 *   LIVE_API_URL, LIVE_WEB_URL   the stack's origins
 *   LIVE_DATA_ROOT               the stack's PAPERTREE_DATA_ROOT (the spec reads ai_runs from it)
 *   LIVE_YOLO_PDF                the PDF to upload
 *   LIVE_OUT                     where screenshots, SSE transcripts and ai_runs.json go
 *
 * The main suite (`pnpm e2e`) ignores this folder: it spends real money.
 */
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const out = process.env['LIVE_OUT'] ?? join(process.cwd(), 'live-out');

export default defineConfig({
  testDir: '.',
  testMatch: 'journey-live.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // One real parse plus four model runs; the workflow's own limit is 60 minutes.
  timeout: 40 * 60_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  outputDir: join(out, 'playwright'),
  use: { ...devices['Desktop Chrome'], headless: true, trace: 'off', screenshot: 'off' },
});
