// PLANTED FAILURE (CI track, #141): a failing e2e assertion. Reverted in the next commit.
import { expect, test } from '../harness/test';

test('planted: this assertion is wrong on purpose', async ({ stack }) => {
  expect(stack.apiUrl.startsWith('http://127.0.0.1:')).toBe(false);
});
