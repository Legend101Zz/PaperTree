/**
 * Start the stack once for the whole run, publish where it is, and return its teardown.
 *
 * Playwright starts test workers AFTER global setup, so the `PAPERTREE_E2E_*` variables set here
 * are what `harness/test.ts` reads — the one channel from setup to specs that needs no file.
 */
import type { FullConfig } from '@playwright/test';

import { startStack } from './stack';

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const { info, stop } = await startStack();
  process.env['PAPERTREE_E2E_API_URL'] = info.apiUrl;
  process.env['PAPERTREE_E2E_WEB_URL'] = info.webUrl;
  process.env['PAPERTREE_E2E_DATA_ROOT'] = info.dataRoot;
  process.env['PAPERTREE_E2E_AGENT'] = info.agent;
  return stop;
}
