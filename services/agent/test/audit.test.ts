/**
 * The isolation audit itself (spike-verify must-fix 6: "make offline test 10 fail when the audit
 * preload is absent, instead of return").
 *
 *   - this test FAILS if the preload is not loaded (so `node --test` without the runner is red);
 *   - positive controls, each in a child process with a FAKE home: the detector must catch a DNS
 *     name lookup, a read of ~/.pi, and a connection off loopback, and fail that process;
 *   - a negative control: a child that only talks to loopback exits 0;
 *   - and in THIS process, after a full faux run, nothing has been caught.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { readExample } from './support/contract.ts';
import { postRun, startAgent, startToolServer } from './support/harness.ts';

const PRELOAD = fileURLToPath(new URL('./support/audit-preload.mjs', import.meta.url));

interface Audit {
  dns: unknown[];
  connects: Array<{ host: string | null }>;
}

function child(code: string): { status: number | null; stderr: string } {
  const home = mkdtempSync(join(tmpdir(), 'papertree-agent-fakehome-'));
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(home, '.pi', 'agent', 'auth.json'), '{"minimax":"fake"}');
  const result = spawnSync(
    process.execPath,
    ['--import', PRELOAD, '--input-type=module', '-e', code],
    {
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: home,
        TMPDIR: process.env['TMPDIR'] ?? tmpdir(),
      },
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
  return { status: result.status, stderr: result.stderr };
}

describe('the isolation audit', () => {
  test('the preload is loaded in this process (a run without it is red)', () => {
    const audit = (globalThis as { paperTreeAudit?: Audit }).paperTreeAudit;
    assert.ok(
      audit,
      'run the suite through test/run.ts: node --import ./test/support/audit-preload.mjs --test …',
    );
  });

  test('positive control: a DNS name lookup fails the process', () => {
    const { status, stderr } = child(
      'import dns from "node:dns"; dns.lookup("example.invalid", () => {});',
    );
    assert.equal(status, 1);
    assert.match(stderr, /VIOLATIONS.*"dns":\[\{"fn":"dns.lookup","host":"example.invalid"\}/);
  });

  test('positive control: reading ~/.pi fails the process', () => {
    const { status, stderr } = child(
      'import fs from "node:fs"; import os from "node:os"; fs.readFileSync(os.homedir() + "/.pi/agent/auth.json");',
    );
    assert.equal(status, 1);
    assert.match(
      stderr,
      /"piPaths":\[\{"op":"fs.readFileSync","path":"[^"]*\/\.pi\/agent\/auth\.json"\}/,
    );
  });

  test('positive control: a connection off loopback fails the process', () => {
    const { status, stderr } = child(
      'import net from "node:net"; const s = net.connect(9, "192.0.2.1"); s.on("error", () => {}); setTimeout(() => s.destroy(), 50);',
    );
    assert.equal(status, 1);
    assert.match(stderr, /"nonLoopbackConnects":\[\{"host":"192\.0\.2\.1"/);
  });

  test('negative control: loopback only exits 0', () => {
    const { status, stderr } = child(
      'import http from "node:http"; const s = http.createServer((q, r) => r.end("ok")).listen(0, "127.0.0.1", async () => { await fetch(`http://127.0.0.1:${s.address().port}/`); s.close(); });',
    );
    assert.equal(status, 0, stderr);
  });

  test('the kernel denies the network (when the runner applied a sandbox)', (t) => {
    if (process.env['PAPERTREE_AGENT_SANDBOX'] !== '1') {
      console.log(
        '[audit] SKIPPED LOUDLY: no kernel network deny on this run (test/run.ts prints why)',
      );
      t.skip('no sandbox on this platform/run');
      return;
    }
    // No preload in this child: this is the kernel's answer, not the audit's.
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'import net from "node:net"; const s = net.connect(443, "1.1.1.1"); s.on("connect", () => { console.log("CONNECTED"); process.exit(0); }); s.on("error", (e) => { console.log("ERR", e.code); process.exit(0); }); setTimeout(() => { console.log("TIMEOUT"); process.exit(0); }, 4000);',
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.match(result.stdout, /ERR EPERM/, result.stdout);
  });

  test('a full faux run in this process makes no DNS name lookup and connects only to loopback', async () => {
    const tools = await startToolServer(() => ({ status: 404, body: {} }));
    let agent: Awaited<ReturnType<typeof startAgent>> | undefined;
    try {
      agent = await startAgent({ apiOrigin: tools.origin });
      const body = readExample('explain');
      body['tool']['base_url'] = tools.baseUrl(body['run_id']);
      const r = await postRun(agent.url, body);
      assert.equal(r.status, 200);
      const audit = (globalThis as { paperTreeAudit?: Audit }).paperTreeAudit!;
      assert.deepEqual(audit.dns, []);
      assert.ok(
        audit.connects.length > 0,
        'the audit saw the loopback connections (it is not blind)',
      );
      assert.ok(
        audit.connects.every((c) => c.host === '127.0.0.1'),
        JSON.stringify(audit.connects),
      );
    } finally {
      await agent?.close();
      await tools.close();
    }
  });
});
