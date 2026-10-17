/**
 * Recorded SSE frames of two diagram runs (#217), as the browser receives them: `POST
 * /papers/ppr_G9AYN750E5MG1NRBMGSQJ4N5JM/threads` `{kind: "diagram"}` on the S7a API (v02/s7b-plate
 * at b0ea483) with the FAUX agent, on a COPY of the demo data root, 2026-10-17, the selection being
 * §3.2.1's first paragraph on p. 4 of "Attention Is All You Need". `diagram-plate.sse` is
 * `[faux:diagram]` (frames 07a–07c: six parts, F inferred); `diagram-plate-bad.sse` is
 * `[faux:diagram-bad]` (a skipped line, two dropped arrows, a quote the paper does not hold).
 * Byte for byte as recorded with curl; parsed here by the app's own SSE parser.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SseFrameParser } from '@/lib/api/client';

import type { SseEvent } from '@/lib/api/types';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The raw recorded stream. */
export function plateStream(name: 'diagram-plate' | 'diagram-plate-bad'): string {
  return readFileSync(join(HERE, `${name}.sse`), 'utf8');
}

/** The recorded stream as events. */
export function plateEvents(name: 'diagram-plate' | 'diagram-plate-bad'): SseEvent[] {
  return new SseFrameParser().push(plateStream(name));
}

/** The recorded stream split into frames (each ends in a blank line), to replay one by one. */
export function plateFrames(name: 'diagram-plate' | 'diagram-plate-bad'): string[] {
  return plateStream(name)
    .split(/\n\n/)
    .filter((f) => f.trim().length > 0)
    .map((f) => `${f}\n\n`);
}
