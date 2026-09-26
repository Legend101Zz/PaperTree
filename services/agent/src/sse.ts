/**
 * contracts.md §0 framing: `event: <name>\ndata: <one-line JSON>\n\n`, and a `: ping\n\n` comment
 * heartbeat (every 5 s on the agent's stream, §3.2). JSON.stringify never emits a raw newline, so
 * `data` is always one line.
 */
import type { ServerResponse } from 'node:http';

export type AgentEventName = 'run' | 'status' | 'text' | 'usage' | 'done';

export interface SseSink {
  event(name: AgentEventName, data: Record<string, unknown>): void;
  ping(): void;
  end(): void;
  readonly open: boolean;
}

export function frame(name: AgentEventName, data: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const PING = ': ping\n\n';

export class SseWriter implements SseSink {
  private ended = false;
  private readonly response: ServerResponse;

  constructor(response: ServerResponse) {
    this.response = response;
  }

  start(requestId: string): void {
    this.response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': requestId,
    });
    this.response.flushHeaders();
  }

  get open(): boolean {
    return !this.ended && !this.response.destroyed && !this.response.writableEnded;
  }

  event(name: AgentEventName, data: Record<string, unknown>): void {
    if (this.open) this.response.write(frame(name, data));
  }

  ping(): void {
    if (this.open) this.response.write(PING);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (!this.response.destroyed && !this.response.writableEnded) this.response.end();
  }
}
