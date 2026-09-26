// Loaded with `node --import ./test/support/audit-preload.mjs` BEFORE anything else in every test
// process (test/run.ts passes it to `node --test`, which hands it to each per-file child).
//
// It hooks BELOW fetch — dns.lookup / dns.promises.lookup / dns.resolve*, net.Socket#connect,
// tls.connect — and the fs entry points, the way the Pi spike's verifier did (spike-verify
// "Detectors"), and it ENFORCES at exit: a process that made any DNS lookup, connected anywhere but
// loopback, or touched a Pi config/context path (~/.pi, AGENTS.md, CLAUDE.md, SYSTEM.md,
// APPEND_SYSTEM.md, .agents/, auth.json, models.json, settings.json, …) exits 1 with the evidence,
// even if every test in it passed. A test cannot forget to assert it.
//
// It records host names and paths only, never header or environment values.
import dns from 'node:dns';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

const home = os.homedir();
const audit = { dns: [], ipLiteralLookups: [], connects: [], tls: [], fsHits: [], homeWrites: [] };
globalThis.paperTreeAudit = audit;

// `server.listen(port, "127.0.0.1")` itself calls dns.lookup on the IP literal (net's
// lookupAndListen). A numeric host never reaches a resolver, so it is counted apart; a lookup of
// any NAME is a violation.
const record = (fn, host) => {
  const h = String(host);
  if (net.isIP(h) !== 0) audit.ipLiteralLookups.push({ fn, host: h });
  else audit.dns.push({ fn, host: h });
};
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'lookupService']) {
  const original = dns[name];
  if (typeof original === 'function') {
    dns[name] = function (host, ...rest) {
      record(`dns.${name}`, host);
      return original.call(this, host, ...rest);
    };
  }
  const originalPromise = dns.promises[name];
  if (typeof originalPromise === 'function') {
    dns.promises[name] = function (host, ...rest) {
      record(`dns.promises.${name}`, host);
      return originalPromise.call(this, host, ...rest);
    };
  }
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  try {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (first && typeof first === 'object') {
      audit.connects.push({
        host: first.host ?? null,
        path: first.path ?? null,
        port: first.port ?? null,
      });
    } else {
      audit.connects.push({
        host: typeof args[1] === 'string' ? args[1] : null,
        path: null,
        port: first ?? null,
      });
    }
  } catch {
    // Recording must never break a connection.
  }
  return connect.apply(this, args);
};

const tlsConnect = tls.connect;
tls.connect = function (...args) {
  try {
    const options = args.find((arg) => arg && typeof arg === 'object') ?? {};
    audit.tls.push({ servername: options.servername ?? options.host ?? null });
  } catch {
    // As above.
  }
  return tlsConnect.apply(this, args);
};

const WATCH =
  /(\/\.pi(\/|$)|\/\.agents(\/|$)|\/\.claude(\/|$)|(^|\/)(AGENTS|CLAUDE|SYSTEM|APPEND_SYSTEM)\.md$|(^|\/)SKILL\.md$|(^|\/)(auth|models|models-store|settings)\.json$|\.jsonl$)/i;
const pathOf = (p) =>
  typeof p === 'string'
    ? p
    : p instanceof URL
      ? p.pathname
      : Buffer.isBuffer(p)
        ? p.toString()
        : undefined;
const READS = [
  'openSync',
  'readFileSync',
  'existsSync',
  'statSync',
  'lstatSync',
  'readdirSync',
  'accessSync',
  'opendirSync',
  'open',
  'readFile',
  'stat',
  'lstat',
  'readdir',
  'access',
  'opendir',
  'createReadStream',
  'watch',
  'watchFile',
  'realpathSync',
];
const WRITES = [
  'writeFileSync',
  'appendFileSync',
  'mkdirSync',
  'renameSync',
  'rmSync',
  'unlinkSync',
  'copyFileSync',
  'cpSync',
  'symlinkSync',
  'writeFile',
  'appendFile',
  'mkdir',
  'rename',
  'rm',
  'unlink',
  'copyFile',
  'cp',
  'symlink',
  'createWriteStream',
  'truncateSync',
  'truncate',
  'utimesSync',
  'utimes',
  'chmodSync',
  'chmod',
];
const wrap = (target, name, kind, label) => {
  const original = target[name];
  if (typeof original !== 'function') return;
  target[name] = function (p, ...rest) {
    try {
      const s = pathOf(p);
      if (s !== undefined) {
        const underHome = s === home || s.startsWith(`${home}/`);
        // A READ of a Pi config / context path is what isolation forbids (a test may WRITE a canary).
        if (
          kind === 'r' &&
          ((WATCH.test(s) && !s.includes('/node_modules/')) ||
            s === `${home}/.pi` ||
            s.startsWith(`${home}/.pi/`))
        ) {
          audit.fsHits.push({ op: `${label}${name}`, path: s });
        }
        if (kind === 'w' && underHome && !s.startsWith(os.tmpdir()))
          audit.homeWrites.push({ op: `${label}${name}`, path: s });
      }
    } catch {
      // As above.
    }
    return original.call(this, p, ...rest);
  };
};
for (const op of READS) wrap(fs, op, 'r', 'fs.');
for (const op of WRITES) wrap(fs, op, 'w', 'fs.');
for (const op of READS) wrap(fs.promises, op, 'r', 'fsp.');
for (const op of WRITES) wrap(fs.promises, op, 'w', 'fsp.');
syncBuiltinESMExports();

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** What the audit found that is not allowed. */
export function auditViolations() {
  const off = audit.connects.filter((c) => c.path === null && !LOOPBACK.has(String(c.host)));
  return {
    dns: audit.dns,
    nonLoopbackConnects: off,
    tls: audit.tls,
    piPaths: audit.fsHits,
    homeWrites: audit.homeWrites,
  };
}
globalThis.paperTreeAuditViolations = auditViolations;

process.on('exit', () => {
  const v = auditViolations();
  const bad =
    v.dns.length +
    v.nonLoopbackConnects.length +
    v.tls.length +
    v.piPaths.length +
    v.homeWrites.length;
  if (bad > 0) {
    process.stderr.write(
      `\n[audit-preload] VIOLATIONS in pid ${String(process.pid)}: ${JSON.stringify(v)}\n`,
    );
    process.exitCode = 1;
  } else if (process.env.PAPERTREE_AUDIT_REPORT === '1') {
    process.stderr.write(
      `[audit-preload] pid ${String(process.pid)}: 0 DNS name lookups (${String(audit.ipLiteralLookups.length)} of IP literals), ${String(audit.connects.length)} loopback connects, 0 tls, 0 Pi paths, 0 home writes\n`,
    );
  }
});
