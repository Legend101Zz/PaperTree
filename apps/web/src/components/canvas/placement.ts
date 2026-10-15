/**
 * canvas/placement — where a new node goes so that it never lands on top of another one.
 *
 * Pure and deterministic: the same board and the same size give the same spot, so a send is
 * predictable and testable. Nodes are laid out on a grid of columns and rows, row by row, and the
 * first free cell wins. A node is "in the way" when it is closer than `GAP` to the candidate.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Wide enough that a link's label (about 100 px) fits between two neighbours without covering either. */
export const GAP = 112;

/** Default sizes (canvas units) per kind. */
export const DEFAULT_SIZE = {
  excerpt: { w: 340, h: 200 },
  explanation: { w: 380, h: 260 },
  note: { w: 260, h: 150 },
  group: { w: 400, h: 300 },
} as const;

export function overlaps(a: Rect, b: Rect, gap = GAP): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

export function freeSpot(
  existing: readonly Rect[],
  size: { readonly w: number; readonly h: number },
  near?: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const stepX = size.w + GAP * 2;
  const stepY = size.h + GAP * 2;
  const originX = near?.x ?? 0;
  const originY = near?.y ?? 0;
  const free = (x: number, y: number): boolean =>
    !existing.some((r) => overlaps({ x, y, w: size.w, h: size.h }, r));
  if (near !== undefined && free(originX, originY)) return { x: originX, y: originY };
  const columns = 4;
  for (let row = 0; row < 500; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = originX + col * stepX;
      const y = originY + row * stepY;
      if (free(x, y)) return { x, y };
    }
  }
  // 2000 occupied cells: stack below everything rather than fail a send.
  const bottom = existing.reduce((m, r) => Math.max(m, r.y + r.h), originY);
  return { x: originX, y: bottom + GAP };
}

/** The box that contains every rect, grown by `pad`. */
export function boundsOf(rects: readonly Rect[], pad = 24): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX - pad, y: minY - pad - 28, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + 28 };
}
