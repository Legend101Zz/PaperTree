/**
 * lib/api/{threads,summary,usage} — every method and path, pinned to contracts.md §2.5.
 *
 * The expected rows are copied from the contract's route table, not from the modules, so a
 * wrong verb or path fails here before S5's routes exist (they answer 501 until then). Wave 2's
 * `contracts.spec` checks the SHAPES of what crosses the wire; this checks WHERE it goes, and that
 * the two streaming POSTs ask for `text/event-stream`. Owned by S6 after S0, with the modules
 * (slice-plan §3).
 *
 * `fetch` is the only stub. A streaming call's request is sent on the generator's first `next()`,
 * so those rows drain the (empty) stream.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/lib/api/client';
import { summaryApi } from '@/lib/api/summary';
import { threadsApi } from '@/lib/api/threads';
import type { Anchor, SseEvent } from '@/lib/api/types';
import { usageApi } from '@/lib/api/usage';

const P = 'ppr_C425DTWW1KYMYDSWR205HB2069';
const T = 'thr_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const R = 'run_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const ANCHOR = { id: 'a1-placeholder' } as unknown as Anchor;

const fetchMock = vi.fn();

function reply(contentType: string, text: string): unknown {
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-type': contentType }),
    // An already-closed stream: the request is what is under test, not the events.
    body: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => reply('application/json', '{}'));
});

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly accept: string | null;
}

function sent(): Sent {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url.startsWith(API_BASE_URL)).toBe(true);
  return {
    method: init.method ?? 'GET',
    path: url.slice(API_BASE_URL.length),
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    accept: new Headers(init.headers).get('Accept'),
  };
}

async function drain(events: AsyncGenerator<SseEvent>): Promise<void> {
  for await (const _event of events) {
    // The stub's stream is empty.
  }
}

describe('threadsApi — contracts §2.5 routes', () => {
  it('create → POST /papers/{id}/threads, as a stream', async () => {
    fetchMock.mockImplementation(async () => reply('text/event-stream', ''));
    const body = { kind: 'explain' as const, anchor: ANCHOR, question: 'Why?' };
    await drain(threadsApi.create(P, body));
    expect(sent()).toEqual({
      method: 'POST',
      path: `/papers/${P}/threads`,
      body,
      accept: 'text/event-stream',
    });
  });

  it('followUp → POST /papers/{id}/threads/{tid}/messages, as a stream', async () => {
    fetchMock.mockImplementation(async () => reply('text/event-stream', ''));
    await drain(threadsApi.followUp(P, T, { question: 'And then?', retry_of: 'msg_1' }));
    expect(sent()).toEqual({
      method: 'POST',
      path: `/papers/${P}/threads/${T}/messages`,
      body: { question: 'And then?', retry_of: 'msg_1' },
      accept: 'text/event-stream',
    });
  });

  it('list → GET /papers/{id}/threads', async () => {
    await threadsApi.list(P);
    expect(sent()).toMatchObject({ method: 'GET', path: `/papers/${P}/threads`, body: undefined });
  });

  it('get → GET /papers/{id}/threads/{tid}', async () => {
    await threadsApi.get(P, T);
    expect(sent()).toMatchObject({ method: 'GET', path: `/papers/${P}/threads/${T}` });
  });

  it('cancelRun → POST /runs/{run_id}/cancel', async () => {
    await threadsApi.cancelRun(R);
    expect(sent()).toMatchObject({ method: 'POST', path: `/runs/${R}/cancel` });
  });
});

describe('summaryApi — contracts §2.5 routes', () => {
  it('get → GET /papers/{id}/summary', async () => {
    await summaryApi.get(P);
    expect(sent()).toMatchObject({ method: 'GET', path: `/papers/${P}/summary`, body: undefined });
  });

  it('generate → POST /papers/{id}/summary, asking for a stream; a JSON answer is the cache', async () => {
    fetchMock.mockImplementation(async () =>
      reply('application/json', '{"state":"ready","summary":null}'),
    );
    const start = await summaryApi.generate(P, { regenerate: true });
    expect(sent()).toEqual({
      method: 'POST',
      path: `/papers/${P}/summary`,
      body: { regenerate: true },
      accept: 'text/event-stream',
    });
    expect(start).toEqual({ kind: 'cached', status: { state: 'ready', summary: null } });
  });

  it('generate reads an event-stream answer as a stream', async () => {
    fetchMock.mockImplementation(async () => reply('text/event-stream', ''));
    const start = await summaryApi.generate(P);
    expect(start.kind).toBe('stream');
  });
});

describe('usageApi — contracts §2.5 routes', () => {
  it('get → GET /usage (the server defaults since to now − 24 h)', async () => {
    await usageApi.get();
    expect(sent()).toMatchObject({ method: 'GET', path: '/usage', body: undefined });
  });

  it('get(since) → GET /usage?since=<ISO, encoded>', async () => {
    await usageApi.get('2026-09-25T15:09:25.123Z');
    expect(sent().path).toBe('/usage?since=2026-09-25T15%3A09%3A25.123Z');
  });
});
