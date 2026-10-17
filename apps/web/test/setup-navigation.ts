/**
 * The app router every mounted screen expects (S5e, #210): `next/navigation`'s `useRouter` throws
 * outside Next's app router, and the explain panel's Dive in and the reader's `?thread=` hand-off
 * call it. A test file that mocks `next/navigation` itself replaces this default.
 */
import { vi } from 'vitest';

/** One router for the whole run, so hooks that depend on it keep a stable identity. */
const ROUTER = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ROUTER,
}));
