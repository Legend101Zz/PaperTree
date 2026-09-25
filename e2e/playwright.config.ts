/**
 * The reader release's browser suite (slice-plan §0: every slice from S0 on adds `e2e/<slice>/*`).
 *
 *     pnpm e2e                         # every slice's specs
 *     pnpm e2e s0                      # one slice
 *     PAPERTREE_E2E_HEADED=1 pnpm e2e  # watch it
 *
 * `harness/global-setup.ts` starts the real stack — `services/api`, the real worker and `next dev` —
 * on free ports against a FRESH data root, and stops it afterwards. Nothing here touches
 * `~/.papertree` or `~/.papertree-demo`: the data root is a new temp directory under
 * `PAPERTREE_E2E_SCRATCH` (default: the OS temp dir), kept after the run with the process logs.
 *
 * ONE WORKER, IN ORDER. The specs share one stack and one SQLite file, and the walks are journeys,
 * not independent units; parallel workers would interleave them.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env['CI'] !== undefined,
  // `next dev` compiles each route on first request; the reader's first open is the slow one.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  globalSetup: './harness/global-setup.ts',
  reporter: [['list']],
  // Traces and screenshots of failures go OUTSIDE the repo, so a run leaves the tree clean.
  outputDir: process.env['PAPERTREE_E2E_OUTPUT'] ?? join(tmpdir(), 'papertree-e2e-results'),
  use: {
    ...devices['Desktop Chrome'],
    headless: process.env['PAPERTREE_E2E_HEADED'] !== '1',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
