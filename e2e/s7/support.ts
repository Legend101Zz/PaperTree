/**
 * e2e/s7 — shared helpers for the canvas walks: seed a parsed paper through the real API and
 * worker, read the board as the API sees it, and count the requests the canvas makes.
 */
import { join } from 'node:path';

import type { Locator, Page, Request } from '@playwright/test';

import { register, upload, waitParsed } from '../s4/support';

export { register, upload, waitParsed, userId, python, shotPath, REPO } from '../s4/support';
export { drag, pointsFor, reveal, selectionRects } from '../s4/support';

export const RESNET = join(
  __dirname,
  '..',
  '..',
  'research',
  'benchmarks',
  'corpus',
  'resnet-cvpr-2col.pdf',
);

export interface Seeded {
  readonly token: string;
  readonly paperId: string;
}

export async function seedPaper(apiUrl: string, label: string): Promise<Seeded> {
  const token = await register(apiUrl, `e2e-s7-${label}-${String(Date.now())}@papertree.test`);
  const paperId = await upload(apiUrl, token, RESNET);
  await waitParsed(apiUrl, token, paperId);
  return { token, paperId };
}

export interface WireNode {
  readonly node_id: string;
  readonly board_id: string;
  readonly kind: string;
  readonly group_id: string | null;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title: string | null;
  readonly body: string;
  readonly version: number;
  readonly source_anchor: { readonly id: string } | null;
}
export interface WireEdge {
  readonly edge_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly kind: string;
  readonly label: string | null;
  readonly from_port?: string | null;
  readonly to_port?: string | null;
}
export interface WireBoard {
  readonly board: {
    readonly board_id: string;
    readonly viewport: { x: number; y: number; zoom: number } | null;
  } | null;
  readonly nodes: WireNode[];
  readonly edges: WireEdge[];
}

export async function getBoard(apiUrl: string, token: string, paperId: string): Promise<WireBoard> {
  const response = await fetch(`${apiUrl}/papers/${paperId}/board`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status !== 200) throw new Error(`GET board ${String(response.status)}`);
  return (await response.json()) as WireBoard;
}

export async function api(
  apiUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
}

/** Every request the page makes to the API, as "METHOD /path". */
export function recordApi(page: Page, apiUrl: string): string[] {
  const seen: string[] = [];
  page.on('request', (request: Request) => {
    if (request.url().startsWith(apiUrl)) {
      seen.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return seen;
}

/**
 * A board tool by name (#214): from the bar when it is there, else from "More board tools", which
 * holds Frame selected cards, Remove frame and Delete everywhere, and Select and the zoom on a phone.
 */
export async function boardTool(page: Page, name: string): Promise<Locator> {
  const bar = page.getByRole('toolbar', { name: 'Board tools' });
  const direct = bar.getByRole('button', { name, exact: true });
  if ((await direct.count()) > 0) return direct.first();
  await bar.getByRole('button', { name: 'More board tools' }).click();
  return page
    .getByRole('group', { name: 'More board tools' })
    .getByRole('button', { name, exact: true });
}

export async function tokenInit(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('papertree.session', t);
    } catch {
      /* a context without storage is not this walk */
    }
  }, token);
}

/**
 * Click the first edge ON ITS LINE: the first point along its path that is on screen and where the
 * topmost element really is that edge (not a card in front of it), in screen pixels.
 */
export async function clickEdge(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>('.react-flow__edge-path');
    const m = path?.getScreenCTM() ?? null;
    if (path === null || m === null) return null;
    const total = path.getTotalLength();
    for (let f = 0.05; f < 1; f += 0.05) {
      const p = path.getPointAtLength(total * f);
      const x = p.x * m.a + p.y * m.c + m.e;
      const y = p.x * m.b + p.y * m.d + m.f;
      if (x < 4 || y < 140 || x > window.innerWidth - 4 || y > window.innerHeight - 4) continue;
      if (
        document.elementFromPoint(x, y)?.closest('.react-flow__edge') ===
        path.closest('.react-flow__edge')
      ) {
        return { x, y };
      }
    }
    return null;
  });
  if (point === null) throw new Error('no edge point is on screen and uncovered');
  await page.mouse.click(point.x, point.y);
}
