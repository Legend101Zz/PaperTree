/**
 * Mutation check: each mutant is one exact edit to a COPY of this package (services/agent/.mutants/,
 * git-ignored), and the whole offline suite is run against the copy. A mutant must make the suite
 * FAIL; one that survives means a test asserts less than it appears to (AGENTS.md §2).
 *
 *   M5, M6  contracts.md §9 / spike-verify must-fix 6: removing either tool-isolation layer — the
 *           `tools` allowlist, or `defaultTools: []` — must fail the suite.
 *   G1–G7   the host guards: the idle watchdog, the retry veto, the seen-handle filter, the
 *           pre-prompt history rule, the tool-call cap, the narration rule, the raw-error redaction.
 *
 * An edit that does not match EXACTLY once is itself a failure (a mutant that silently changed
 * nothing would "pass" and prove nothing).
 *
 * Usage: node --experimental-strip-types test/mutants.ts [ids…]   (default: all)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Mutant {
  readonly id: string;
  readonly what: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

export const MUTANTS: readonly Mutant[] = [
  {
    id: 'M5',
    what: 'the `tools` allowlist removed from createAgentSession',
    file: 'src/session.ts',
    find: '    tools: tools.map((tool) => tool.name),\n',
    replace: '',
  },
  {
    id: 'M6',
    what: '`defaultTools: []` removed from the in-memory settings',
    file: 'src/session.ts',
    find: '    defaultTools: [],\n',
    replace: '',
  },
  {
    id: 'G1',
    what: 'the idle watchdog never fires',
    file: 'src/run.ts',
    find: "this.idleTimer = setTimeout(() => this.hostAbort('idle'), this.request.limits.idle_ms);",
    replace: 'this.idleTimer = undefined;',
  },
  {
    id: 'G2',
    what: "Pi's own retry is never vetoed (its regex decides)",
    file: 'src/run.ts',
    find: 'if (!mayRetry(code, this.finalText.length > 0)) this.paper?.abort();',
    replace: 'void mayRetry;',
  },
  {
    id: 'G3',
    what: 'markers are not restricted to the handles issued in this run',
    file: 'src/run.ts',
    find: 'const markers = parseMarkers(text).filter((handle) => seen.includes(handle));',
    replace: 'const markers = parseMarkers(text);',
  },
  {
    id: 'G4',
    what: 'an aborted turn with no text hands back its own entries (the cancelled task resumes)',
    file: 'src/run.ts',
    find: "(status === 'aborted' || status === 'error') && text.length === 0",
    replace: 'false',
  },
  {
    id: 'G5',
    what: 'no tool-call cap in the tools',
    file: 'src/tools.ts',
    find: 'return index === undefined || index > ctx.maxToolCalls;',
    replace: 'return false;',
  },
  {
    id: 'G7',
    what: "a failed message's raw provider text is exported in done.entries",
    file: 'src/session.ts',
    find: 'message: redactProviderError(message),',
    replace: 'message,',
  },
  {
    id: 'G6',
    what: "every message's text is streamed (narration included)",
    file: 'src/run.ts',
    find: 'else if (hasMarker(state.text)) this.commit(state);',
    replace: 'else this.commit(state);',
  },
];

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(pkg, '.mutants');

function run(mutant: Mutant): {
  killed: boolean;
  failing: string[];
  tests: string;
  output: string;
} {
  const copy = join(root, mutant.id);
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(copy, { recursive: true });
  for (const part of ['src', 'test', 'package.json', 'tsconfig.json'])
    cpSync(join(pkg, part), join(copy, part), { recursive: true });
  const target = join(copy, mutant.file);
  const source = readFileSync(target, 'utf8');
  const count = source.split(mutant.find).length - 1;
  if (count !== 1)
    throw new Error(
      `${mutant.id}: the edit matched ${String(count)} times in ${mutant.file} (must be exactly 1)`,
    );
  writeFileSync(target, source.replace(mutant.find, mutant.replace));
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      join(copy, 'test', 'run.ts'),
    ],
    {
      cwd: copy,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    },
  );
  if (result.error)
    throw new Error(`${mutant.id}: the suite did not finish (${result.error.message})`);
  const output = `${result.stdout}\n${result.stderr}`;
  // The spec reporter prints each failure twice (inline, then under "✖ failing tests:"); keep one.
  const failing = [
    ...new Set(
      output
        .split('\n')
        .filter((l) => /^\s*✖ /.test(l) && !/✖ failing tests:/.test(l))
        .map((l) => l.trim().replace(/ \([\d.]+ms\)$/, '')),
    ),
  ];
  const tests = output
    .split('\n')
    .filter((l) => /^ℹ (tests|pass|fail) /.test(l))
    .map((l) => l.replace('ℹ ', ''))
    .join(', ');
  rmSync(copy, { recursive: true, force: true });
  return { killed: result.status !== 0, failing, tests, output };
}

const wanted = process.argv.slice(2);
const selected = wanted.length > 0 ? MUTANTS.filter((m) => wanted.includes(m.id)) : MUTANTS;
if (wanted.length > 0 && selected.length !== wanted.length)
  throw new Error(`unknown mutant id in ${wanted.join(' ')}`);
let survived = 0;
for (const mutant of selected) {
  const started = Date.now();
  const { killed, failing, tests } = run(mutant);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[mutants] ${mutant.id} ${killed ? 'KILLED' : 'SURVIVED'} in ${secs} s: ${mutant.what}  (${tests})`,
  );
  for (const line of failing) console.log(`[mutants]     ${line}`);
  if (!killed) survived++;
}
rmSync(root, { recursive: true, force: true });
console.log(`[mutants] ${String(selected.length - survived)}/${String(selected.length)} killed`);
process.exitCode = survived === 0 ? 0 : 1;
