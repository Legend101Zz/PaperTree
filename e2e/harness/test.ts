/**
 * The `test` every e2e spec imports: Playwright's, with the running stack as a fixture and the web
 * server as `baseURL`.
 */
import { test as base, expect } from '@playwright/test';

export interface Stack {
  readonly apiUrl: string;
  readonly webUrl: string;
  readonly dataRoot: string;
  /** `skipped` until S5 lands `services/agent`; AI journeys must check it and skip loudly. */
  readonly agent: 'running' | 'skipped';
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is unset: run the suite through e2e/playwright.config.ts (pnpm e2e).`);
  }
  return value;
}

export const test = base.extend<{ stack: Stack }>({
  stack: async ({}, use) => {
    await use({
      apiUrl: required('PAPERTREE_E2E_API_URL'),
      webUrl: required('PAPERTREE_E2E_WEB_URL'),
      dataRoot: required('PAPERTREE_E2E_DATA_ROOT'),
      agent: process.env['PAPERTREE_E2E_AGENT'] === 'running' ? 'running' : 'skipped',
    });
  },
  baseURL: async ({}, use) => {
    await use(required('PAPERTREE_E2E_WEB_URL'));
  },
});

export { expect };
