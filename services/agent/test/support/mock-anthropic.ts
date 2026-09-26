/**
 * A local server that speaks the Anthropic Messages API (what Pi's built-in `minimax` provider
 * calls), for the offline tests of the REAL provider path: the live model with its `baseUrl`
 * pointed here, the real pi-ai anthropic-messages client, real HTTP, real SSE parsing, Pi's own
 * retry machinery. Each request consumes the next scripted step (the last one repeats).
 *
 * It records each request's JSON body and header NAMES, plus whether `x-api-key` equalled the
 * test's fake key (never the value).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export type MockStep =
  | {
      readonly kind: 'stream';
      readonly thinking?: string;
      readonly text?: readonly string[];
      readonly toolUses?: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly input: Record<string, unknown>;
      }>;
      readonly stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly cacheRead?: number;
      /** Stop sending after this many text deltas and hold the body open (a stalled stream). */
      readonly stallAfterText?: number;
      readonly deltaDelayMs?: number;
      /** End the body without message_delta / message_stop (a stream cut short). */
      readonly omitStop?: boolean;
      /** After the text, send an Anthropic `error` event (a failure mid-stream) and end. */
      readonly errorAfterText?: { readonly type: string; readonly message: string };
    }
  | {
      readonly kind: 'status';
      readonly status: number;
      readonly body: unknown;
      readonly headers?: Record<string, string>;
    }
  | { readonly kind: 'hang-before-headers' };

export interface MockRequest {
  readonly at: number;
  readonly body: Record<string, any>;
  readonly headerNames: string[];
  readonly keyMatched: boolean;
}

export interface MockAnthropic {
  readonly url: string;
  readonly requests: MockRequest[];
  close(): Promise<void>;
}

const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function stream(
  res: ServerResponse,
  step: Extract<MockStep, { kind: 'stream' }>,
): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.write(
    sse('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model: 'MiniMax-M3',
        content: [],
        stop_reason: null,
        usage: {
          input_tokens: step.inputTokens ?? 120,
          output_tokens: 1,
          cache_read_input_tokens: step.cacheRead ?? 0,
        },
      },
    }),
  );
  let index = 0;
  if (step.thinking !== undefined) {
    res.write(
      sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '' },
      }),
    );
    res.write(
      sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: step.thinking },
      }),
    );
    res.write(
      sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: 'c2lnbmF0dXJl' },
      }),
    );
    res.write(sse('content_block_stop', { type: 'content_block_stop', index }));
    index++;
  }
  if (step.text !== undefined) {
    res.write(
      sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      }),
    );
    let sent = 0;
    for (const delta of step.text) {
      if (step.deltaDelayMs) await sleep(step.deltaDelayMs);
      if (res.destroyed) return;
      res.write(
        sse('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: delta },
        }),
      );
      sent++;
      if (step.stallAfterText === sent) return; // hold the body open, say nothing more
    }
    if (step.errorAfterText) {
      res.write(
        sse('error', { type: 'error', error: step.errorAfterText, request_id: 'mock_req_77' }),
      );
      res.end();
      return;
    }
    res.write(sse('content_block_stop', { type: 'content_block_stop', index }));
    index++;
  }
  for (const tool of step.toolUses ?? []) {
    res.write(
      sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} },
      }),
    );
    res.write(
      sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) },
      }),
    );
    res.write(sse('content_block_stop', { type: 'content_block_stop', index }));
    index++;
  }
  if (step.omitStop) {
    res.end();
    return;
  }
  const stop = step.stopReason ?? ((step.toolUses?.length ?? 0) > 0 ? 'tool_use' : 'end_turn');
  res.write(
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stop },
      usage: { output_tokens: step.outputTokens ?? 40 },
    }),
  );
  res.write(sse('message_stop', { type: 'message_stop' }));
  res.end();
}

export async function startMockAnthropic(
  steps: readonly MockStep[],
  fakeKey: string,
): Promise<MockAnthropic> {
  const requests: MockRequest[] = [];
  const sockets = new Set<Socket>();
  const t0 = performance.now();
  let next = 0;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      const step = steps[Math.min(next, steps.length - 1)];
      next++;
      let body: Record<string, any> = {};
      try {
        body = JSON.parse(raw) as Record<string, any>;
      } catch {
        body = {};
      }
      requests.push({
        at: Math.round(performance.now() - t0),
        body,
        headerNames: Object.keys(req.headers).toSorted(),
        keyMatched: req.headers['x-api-key'] === fakeKey,
      });
      if (!step) {
        res.writeHead(500).end();
        return;
      }
      if (step.kind === 'hang-before-headers') return;
      if (step.kind === 'status') {
        res.writeHead(step.status, { 'content-type': 'application/json', ...step.headers });
        res.end(JSON.stringify(step.body));
        return;
      }
      void stream(res, step);
    });
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${String(port)}/anthropic`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        if (!server.listening) return resolve();
        server.close(() => resolve());
      }),
  };
}
