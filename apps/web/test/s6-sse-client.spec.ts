/**
 * s6-sse-client — the explain panel reads §2.6 events through `streamSse`; this pins the framing it
 * depends on, at the level the panel uses it (a `Response` body in, typed events out): framing,
 * `: ping` heartbeats, a frame split across chunks, and an abort that stops the read.
 *
 * `lib-api-client.spec` pins the parser itself; this file pins the ASSEMBLY the panel relies on —
 * the exact byte shapes `services/api` and the agent's recorded fixtures send.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamSse } from '@/lib/api/client';
import type { SseEvent } from '@/lib/api/types';

import { done, frame, installFetch, jsonResponse, run, text } from './s6-support';

afterEach(() => vi.unstubAllGlobals());

function bodyOf(
  chunks: readonly string[],
  opts: { hold?: boolean; signal?: AbortSignal | null } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
      if (opts.hold !== true) c.close();
      opts.signal?.addEventListener('abort', () =>
        c.error(new DOMException('aborted', 'AbortError')),
      );
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: stream,
    text: async () => '',
  } as unknown as Response;
}

async function collect(gen: AsyncGenerator<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('streamSse as the explain panel uses it', () => {
  it('frames events in order, with LF and CRLF line ends', async () => {
    installFetch({
      'POST /x': () =>
        bodyOf([
          run(),
          text('a'),
          frame('done', { status: 'complete', error: null, message_id: 'm' }).replace(
            /\n/g,
            '\r\n',
          ),
        ]),
    });
    const events = await collect(streamSse('/x', {}));
    expect(events.map((e) => e.event)).toEqual(['run', 'text', 'done']);
  });

  it('drops ": ping" comments, between frames and inside one', async () => {
    installFetch({
      'POST /x': () =>
        bodyOf([
          ': ping\n\n',
          'event: text\n: ping\ndata: {"delta":"hi"}\n\n',
          ': ping\n\n',
          done(),
        ]),
    });
    const events = await collect(streamSse('/x', {}));
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
    expect((events[0] as Extract<SseEvent, { event: 'text' }>).data.delta).toBe('hi');
  });

  it('reassembles a frame split mid-line, mid-JSON and mid-CRLF across chunks', async () => {
    const whole = text('héllo wörld');
    const cut = [whole.slice(0, 9), whole.slice(9, 24), whole.slice(24)];
    installFetch({ 'POST /x': () => bodyOf([...cut, done()]) });
    const events = await collect(streamSse('/x', {}));
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
    expect((events[0] as Extract<SseEvent, { event: 'text' }>).data.delta).toBe('héllo wörld');
  });

  it('splits a multibyte character across chunks without corrupting it', async () => {
    const bytes = new TextEncoder().encode(text('日本語'));
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 30));
        c.enqueue(bytes.slice(30));
        c.enqueue(encoder.encode(done()));
        c.close();
      },
    });
    installFetch({
      'POST /x': () =>
        ({
          ok: true,
          status: 200,
          statusText: '',
          headers: new Headers(),
          body: stream,
          text: async () => '',
        }) as unknown as Response,
    });
    const events = await collect(streamSse('/x', {}));
    expect((events[0] as Extract<SseEvent, { event: 'text' }>).data.delta).toBe('日本語');
  });

  it('discards a truncated last frame instead of reading it as a done', async () => {
    installFetch({ 'POST /x': () => bodyOf([text('a'), 'event: done\ndata: {"status":"comp']) });
    const events = await collect(streamSse('/x', {}));
    expect(events.map((e) => e.event)).toEqual(['text']);
  });

  it('throws on a frame whose data is not JSON (a broken contract is not swallowed)', async () => {
    installFetch({ 'POST /x': () => bodyOf(['event: text\ndata: {nope\n\n']) });
    await expect(collect(streamSse('/x', {}))).rejects.toThrow(/malformed "text" event/);
  });

  it('a pre-stream JSON error throws from the first next(), as an ApiError', async () => {
    installFetch({
      'POST /x': () =>
        jsonResponse(429, { detail: 'over', code: 'budget_exhausted', retryable: false }),
    });
    await expect(collect(streamSse('/x', {}))).rejects.toMatchObject({
      code: 'budget_exhausted',
      status: 429,
    });
  });

  it('aborting the signal stops the read and surfaces an AbortError', async () => {
    const controller = new AbortController();
    installFetch({ 'POST /x': (_c, signal) => bodyOf([text('one')], { hold: true, signal }) });
    const seen: string[] = [];
    const reading = (async () => {
      for await (const e of streamSse('/x', {}, controller.signal)) seen.push(e.event);
    })();
    await vi.waitFor(() => expect(seen).toEqual(['text']));
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sends Accept: text/event-stream and the JSON body', async () => {
    const { fetch } = installFetch({ 'POST /x': () => bodyOf([done()]) });
    await collect(streamSse('/x', { question: 'q' }));
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('accept')).toBe('text/event-stream');
    expect(init.body).toBe('{"question":"q"}');
  });
});
