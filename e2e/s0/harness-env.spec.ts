/**
 * The harness never hands a model key to a process it starts (contracts.md §7: the MiniMax key
 * belongs to the agent alone), nor a developer's own `PAPERTREE_*` settings.
 *
 * This drives the harness's REAL `start()` — the same function that spawns the API, the worker and
 * `next dev` — with `/usr/bin/env` as the command, so what is asserted is the environment a child
 * actually receives, read back from its log. The shell running the suite normally holds no key, so
 * the spec plants fake ones in its own `process.env` first; before the allowlist, `start()` copied
 * the whole parent environment and every one of them reached the child.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INHERITED_ENV, start, type Proc } from '../harness/stack';
import { expect, test } from '../harness/test';

const PLANTED = [
  'PAPERTREE_MINIMAX_API_KEY',
  'MINIMAX_API_KEY',
  'PAPERTREE_LLM_API_KEY',
  'LLM_API_KEY',
  'PAPERTREE_VLM_API_KEY',
  'PAPERTREE_SIGNING_SECRET',
] as const;

/** Resolve once the child has exited AND its log is flushed to disk. */
async function finished(proc: Proc): Promise<void> {
  if (proc.child.exitCode === null && proc.child.signalCode === null) {
    await new Promise<void>((done) => proc.child.once('close', () => done()));
  }
  await new Promise<void>((done) => proc.out.end(() => done()));
}

test.describe('S0 harness', () => {
  test('a child inherits only INHERITED_ENV plus its own env: no key, no stray setting', async ({
    stack,
  }) => {
    const saved = new Map(PLANTED.map((name) => [name, process.env[name]] as const));
    for (const name of PLANTED) process.env[name] = 'fake-planted-by-harness-env-spec';

    let proc: Proc;
    try {
      proc = start('env-probe', '/usr/bin/env', [], {
        cwd: stack.dataRoot,
        env: { PAPERTREE_DATA_ROOT: stack.dataRoot },
        logDir: join(stack.dataRoot, 'logs'),
      });
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    await finished(proc);
    expect(proc.child.exitCode).toBe(0);

    const names = readFileSync(proc.log, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => line.slice(0, line.indexOf('=')));

    for (const name of PLANTED) expect(names, `${name} reached the child`).not.toContain(name);
    expect(names).toContain('PATH');
    expect(names).toContain('PAPERTREE_DATA_ROOT');
    // The strong form: nothing outside the allowlist and the child's own env, whatever its name.
    expect(names.filter((name) => !INHERITED_ENV.includes(name))).toEqual(['PAPERTREE_DATA_ROOT']);
  });
});
