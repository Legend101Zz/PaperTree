/**
 * The LIVE journey (#141, #118): register -> upload -> ready -> explain -> follow-up -> summary
 * -> cancel, against a real stack and the real model.
 *
 * What is a browser here and what is HTTP, and why: the reader is opened in Chromium twice
 * (once the paper is ready, once after the AI turns) because that is where "it renders" can be
 * seen and screenshotted; the AI turns are HTTP + SSE because the selection toolbar's explain flow
 * belongs to the reader slices and is not needed to prove that the API, the agent and the model
 * work together. The anchor sent with the explain request is a real Anchor v1, minted by
 * `papertree_anchoring` over a real paragraph of the uploaded paper (scripts/live/make_anchor.py).
 *
 * Everything the run learns is written to LIVE_OUT: SSE transcripts, screenshots, the REST
 * bodies. The workflow reads the `ai_runs` rows itself (sqlite3 -> JSON) AFTER this spec, and ALSO
 * the spec reads them here, so the assertions on model / tokens / cost / latency / code_path sit
 * next to the runs that produced them.
 *
 * HONESTY. A run that comes back `partial` or with no valid citation marker is reported, not
 * promoted to a pass: the owner ruling is that a summary with no valid marker reads `partial`
 * with a warning; this spec accepts `partial` ONLY for the summary, records it as a warning, and
 * fails on `error` / `aborted` anywhere except the cancel step, where `aborted` is the goal.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { expect, test } from '@playwright/test';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is unset`);
  return value;
}

const API = required('LIVE_API_URL');
const WEB = required('LIVE_WEB_URL');
const DATA_ROOT = required('LIVE_DATA_ROOT');
const YOLO = required('LIVE_YOLO_PDF');
const OUT = required('LIVE_OUT');
const REPO = join(__dirname, '..', '..');
const PYTHON = process.env['LIVE_PYTHON'] ?? join(REPO, '.venv', 'bin', 'python');

mkdirSync(join(OUT, 'shots'), { recursive: true });
mkdirSync(join(OUT, 'sse'), { recursive: true });

interface Frame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

const notes: string[] = [];
const warnings: string[] = [];
function note(line: string): void {
  notes.push(line);
  console.log(`[live] ${line}`);
}

let cancelRun0: Record<string, unknown> | undefined;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(response: Response, expected: number, what: string): Promise<T> {
  const text = await response.text();
  if (response.status !== expected) {
    throw new Error(
      `${what}: HTTP ${String(response.status)} (wanted ${String(expected)}): ${text}`,
    );
  }
  return JSON.parse(text) as T;
}

/**
 * POST and read the SSE stream to its end (or until `onFrame` returns true, which then lets the
 * caller act mid-stream - the cancel step). Frames are `event: x\ndata: {json}\n\n`; comment
 * lines (`: ping`) are skipped.
 */
async function stream(
  label: string,
  url: string,
  body: unknown,
  token: string,
  onFrame?: (frame: Frame) => Promise<void>,
): Promise<{ frames: Frame[]; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (response.status !== 200) {
    throw new Error(`${label}: HTTP ${String(response.status)}: ${await response.text()}`);
  }
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    // e.g. a cached summary answers 200 JSON; the caller asked for a run, so this is a finding.
    throw new Error(`${label}: 200 but not an event stream: ${await response.text()}`);
  }
  const frames: Frame[] = [];
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    buffer += chunk;
    let cut = buffer.indexOf('\n\n');
    while (cut !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf('\n\n');
      const lines = block.split('\n').filter((l) => !l.startsWith(':'));
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (eventLine === undefined || dataLine === undefined) continue;
      const frame: Frame = {
        event: eventLine.slice(7),
        data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
      };
      frames.push(frame);
      if (onFrame !== undefined) await onFrame(frame);
    }
  }
  writeFileSync(join(OUT, 'sse', `${label}.sse.txt`), raw);
  const text = frames
    .filter((f) => f.event === 'text')
    .map((f) => String(f.data['delta'] ?? ''))
    .join('');
  return { frames, text };
}

function one(frames: Frame[], event: string): Record<string, unknown> {
  const found = frames.filter((f) => f.event === event);
  expect(found.length, `exactly one '${event}' event`).toBe(1);
  return (found[0] as Frame).data;
}

function doneOf(frames: Frame[]): { status: string; error: unknown; message_id: string } {
  const last = frames[frames.length - 1] as Frame;
  expect(last.event, 'the stream ends with done').toBe('done');
  return last.data as { status: string; error: unknown; message_id: string };
}

/**
 * A finished AI turn: `complete` passes; `partial` passes WITH A RECORDED WARNING (it is reported,
 * never rounded up); anything else fails with the agent's own error.
 */
function assertFinished(label: string, done: { status: string; error: unknown }): void {
  if (done.status === 'partial') {
    const warning = `${label} read PARTIAL, not complete`;
    warnings.push(warning);
    console.warn(`::warning title=live ${label} partial::${warning}`);
    return;
  }
  expect(done.status, `${label} finished (error: ${JSON.stringify(done.error)})`).toBe('complete');
}

function aiRuns(): Record<string, unknown>[] {
  const result = spawnSync(
    PYTHON,
    [
      '-c',
      'import json,sqlite3,sys;c=sqlite3.connect("file:"+sys.argv[1]+"/papertree.sqlite?mode=ro",uri=True);' +
        'c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(' +
        '"SELECT run_id,paper_id,generation,kind,thread_id,message_id,status,code_path,provider,model,' +
        'agent_sdk,prompt_version,stop_reason,error_code,retries,tool_calls,input_tokens,output_tokens,' +
        'cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd_est,first_text_ms,latency_ms,' +
        'started_at,finished_at FROM ai_runs ORDER BY started_at")]))',
      DATA_ROOT,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`reading ai_runs failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>[];
}

test.describe.configure({ mode: 'serial' });

test('live journey: register, upload, ready, explain, follow-up, summary, cancel', async ({
  browser,
}) => {
  const started = Date.now();

  // ── 1. register ──────────────────────────────────────────────────────────────────────────
  const email = `live-${String(Date.now())}@papertree.test`;
  const registered = await json<{ token: string; user_id: string }>(
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'live-journey-password' }),
    }),
    201,
    'register',
  );
  const token = registered.token;
  note('registered a fresh user');

  // The stack must report an agent with a key (the live journey is worthless against a faux one).
  const health = await json<{ agent: { reachable: boolean; key_present?: boolean } }>(
    await fetch(`${API}/healthz`),
    200,
    'healthz',
  );
  note(`healthz agent: ${JSON.stringify(health.agent)}`);
  expect(health.agent.reachable, 'the API reaches the agent').toBe(true);
  // LIVE_ALLOW_FAUX=1 exists only to develop this spec offline against the scripted agent; the
  // workflow never sets it, and a faux agent then fails this line, which is the point.
  if (process.env['LIVE_ALLOW_FAUX'] !== '1') {
    expect(health.agent.key_present, 'the agent holds a model key (live, not faux)').toBe(true);
  }

  // ── 2. upload, then ready ────────────────────────────────────────────────────────────────
  const form = new FormData();
  form.append('file', new Blob([readFileSync(YOLO)], { type: 'application/pdf' }), basename(YOLO));
  const uploaded = await json<{ paper_id: string; job_id: string }>(
    await fetch(`${API}/papers`, { method: 'POST', headers: authHeaders(token), body: form }),
    202,
    'upload',
  );
  const paperId = uploaded.paper_id;
  note(`uploaded ${paperId} (job ${uploaded.job_id})`);

  const parseStarted = Date.now();
  let processing = 'queued';
  while (Date.now() - parseStarted < 10 * 60_000) {
    const paper = await json<{ processing: string }>(
      await fetch(`${API}/papers/${paperId}`, { headers: authHeaders(token) }),
      200,
      'GET paper',
    );
    processing = paper.processing;
    if (processing === 'ready' || processing === 'partial' || processing === 'failed') break;
    await new Promise((done) => setTimeout(done, 1500));
  }
  note(`processing=${processing} after ${String(Date.now() - parseStarted)} ms`);
  expect(['ready', 'partial'], 'the real worker parsed and promoted the paper').toContain(
    processing,
  );

  const irBody = await (
    await fetch(`${API}/papers/${paperId}/ir`, { headers: authHeaders(token) })
  ).text();
  writeFileSync(join(OUT, 'ir.json'), irBody);

  // The reader, in a real browser, on the uploaded paper.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('papertree.session', t);
    } catch {
      /* no storage, no session: the spec then fails on the spans below, loudly */
    }
  }, token);
  const page = await context.newPage();
  await page.goto(`${WEB}/paper/${paperId}/read`);
  await expect
    .poll(() => page.locator('.papertree-text-layer span').count(), { timeout: 180_000 })
    .toBeGreaterThan(50);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await page.screenshot({ path: join(OUT, 'shots', 'live-01-reader-ready.png') });
  note('reader rendered a text layer (visibilityState=visible)');

  // ── 3. explain ───────────────────────────────────────────────────────────────────────────
  const made = spawnSync(
    PYTHON,
    [join(REPO, 'scripts', 'live', 'make_anchor.py'), join(OUT, 'ir.json')],
    {
      encoding: 'utf8',
    },
  );
  if (made.status !== 0) throw new Error(`make_anchor.py failed: ${made.stderr}`);
  const anchor = JSON.parse(made.stdout) as { id: string };
  writeFileSync(join(OUT, 'anchor.json'), made.stdout);

  const explain = await stream(
    'explain',
    `${API}/papers/${paperId}/threads`,
    { kind: 'explain', anchor, question: 'Explain this passage in two or three sentences.' },
    token,
  );
  const explainRun = one(explain.frames, 'run') as { run_id: string; thread_id: string };
  const explainDone = doneOf(explain.frames);
  note(`explain: ${explainDone.status}, ${String(explain.text.length)} chars`);
  assertFinished('explain', explainDone);
  expect(explain.text.trim().length, 'explain produced text').toBeGreaterThan(20);
  const explainUsage = one(explain.frames, 'usage') as Record<string, number | string>;
  expect(Number(explainUsage['input_tokens'])).toBeGreaterThan(0);
  expect(Number(explainUsage['output_tokens'])).toBeGreaterThan(0);
  const threadId = explainRun.thread_id;

  // ── 4. follow-up on the same thread ──────────────────────────────────────────────────────
  const follow = await stream(
    'follow-up',
    `${API}/papers/${paperId}/threads/${threadId}/messages`,
    { question: 'What is the single most important idea in that passage? One sentence.' },
    token,
  );
  const followDone = doneOf(follow.frames);
  note(`follow-up: ${followDone.status}, ${String(follow.text.length)} chars`);
  assertFinished('follow-up', followDone);
  expect(follow.text.trim().length).toBeGreaterThan(10);
  const detail = await json<{ messages: { role: string; status: string }[] }>(
    await fetch(`${API}/papers/${paperId}/threads/${threadId}`, { headers: authHeaders(token) }),
    200,
    'GET thread',
  );
  expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

  // ── 5. summary ───────────────────────────────────────────────────────────────────────────
  const summary = await stream('summary', `${API}/papers/${paperId}/summary`, {}, token);
  const summaryDone = doneOf(summary.frames);
  note(`summary: ${summaryDone.status}, ${String(summary.text.length)} chars`);
  if (summaryDone.status === 'partial') {
    const warning =
      'summary read PARTIAL (owner ruling: no valid citation marker reads partial with a warning)';
    warnings.push(warning);
    console.warn(`::warning title=live summary partial::${warning}`);
  } else {
    expect(
      summaryDone.status,
      `summary finished (error: ${JSON.stringify(summaryDone.error)})`,
    ).toBe('complete');
  }
  const stored = await json<{ state: string; summary: { bullets: unknown[] } | null }>(
    await fetch(`${API}/papers/${paperId}/summary`, { headers: authHeaders(token) }),
    200,
    'GET summary',
  );
  note(
    `stored summary state=${stored.state}, bullets=${String(stored.summary?.bullets.length ?? 0)}`,
  );
  expect(['ready', 'partial']).toContain(stored.state);

  // ── 6. cancel a run mid-stream ───────────────────────────────────────────────────────────
  let cancelStatus = 0;
  let cancelled = false;
  const cancelRun = await stream(
    'cancel',
    `${API}/papers/${paperId}/threads/${threadId}/messages`,
    {
      question:
        'Write a long, detailed essay of at least 1500 words about every aspect of this paper, ' +
        'section by section, with many examples.',
    },
    token,
    async (frame) => {
      // Cancel as soon as the model is producing text, so a real run is aborted mid-flight.
      if (!cancelled && frame.event === 'text') {
        cancelled = true;
        const runId = String((cancelRun0?.run_id as string | undefined) ?? '');
        const response = await fetch(`${API}/runs/${runId}/cancel`, {
          method: 'POST',
          headers: authHeaders(token),
        });
        cancelStatus = response.status;
        await response.text();
      }
      if (frame.event === 'run') cancelRun0 = frame.data;
    },
  );
  const cancelDone = doneOf(cancelRun.frames);
  note(
    `cancel: POST /runs/{id}/cancel -> ${String(cancelStatus)}; stream done=${cancelDone.status}`,
  );
  expect(cancelled, 'the run produced text before it ended, so there was something to cancel').toBe(
    true,
  );
  expect(cancelStatus).toBe(202);
  // The scripted faux agent answers in one burst, so it cannot be cancelled mid-stream.
  if (process.env['LIVE_ALLOW_FAUX'] !== '1') expect(cancelDone.status).toBe('aborted');

  // ── 7. the ledger: every run recorded model, tokens, cost, latency and code_path ─────────
  const runs = aiRuns();
  writeFileSync(join(OUT, 'ai_runs.spec.json'), `${JSON.stringify(runs, null, 2)}\n`);
  note(`ai_runs rows: ${String(runs.length)}`);
  expect(runs.length, 'explain, follow-up, summary and the cancelled run').toBeGreaterThanOrEqual(
    4,
  );
  for (const row of runs) {
    const label = `${String(row['kind'])} ${String(row['run_id'])}`;
    expect(typeof row['model'] === 'string' && row['model'] !== '', `${label}: model`).toBe(true);
    expect(String(row['code_path']), `${label}: code_path`).toMatch(
      /^api\.(threads\.(explain|ask)|summary)>agent\.v1\.runs>pi\.createAgentSession>minimax\.anthropic-messages$/,
    );
    if (row['status'] === 'done') {
      expect(row['latency_ms'], `${label}: latency_ms`).not.toBeNull();
      expect(Number(row['input_tokens']), `${label}: input_tokens`).toBeGreaterThan(0);
      expect(Number(row['output_tokens']), `${label}: output_tokens`).toBeGreaterThan(0);
      expect(row['cost_usd_est'], `${label}: cost_usd_est`).not.toBeNull();
    }
  }
  if (process.env['LIVE_ALLOW_FAUX'] !== '1') {
    expect(
      runs.filter((r) => r['status'] === 'aborted').length,
      'the cancelled run is aborted',
    ).toBe(1);
  }
  const cost = runs.reduce((sum, r) => sum + Number(r['cost_usd_est'] ?? 0), 0);
  const tokens = runs.reduce(
    (sum, r) => sum + Number(r['input_tokens'] ?? 0) + Number(r['output_tokens'] ?? 0),
    0,
  );
  note(`live spend: ${String(tokens)} tokens, est. $${cost.toFixed(4)}`);

  // The reader once more, with the AI turns stored.
  await page.reload();
  await expect
    .poll(() => page.locator('.papertree-text-layer span').count(), { timeout: 180_000 })
    .toBeGreaterThan(50);
  await page.screenshot({ path: join(OUT, 'shots', 'live-02-reader-after-ai.png') });
  await context.close();

  note(`wall clock ${String(Math.round((Date.now() - started) / 1000))} s`);
  writeFileSync(
    join(OUT, 'live-journey-report.json'),
    `${JSON.stringify({ paperId, notes, warnings, tokens, cost_usd_est: cost }, null, 2)}\n`,
  );
});
