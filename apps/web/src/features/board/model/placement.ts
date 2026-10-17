/**
 * board/model/placement — where a new node goes so that it never lands on top of another one.
 *
 * Pure and deterministic: the same board and the same size give the same spot, so a send is
 * predictable and testable. Nodes are laid out on a grid of columns and rows, row by row, and the
 * first free cell wins. A node is "in the way" when it is closer than `GAP` to the candidate.
 */
/** A card's box in board units. */
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
  /** The AI-slip card with the plate miniature (frame 06, #217). */
  diagram: { w: 300, h: 300 },
} as const;

/**
 * Whether two boxes are closer than `gap`.
 *
 * @param a One box.
 * @param b The other box.
 * @param gap The clearance they need.
 * @returns True when they are in each other's way.
 */
export function overlaps(a: Rect, b: Rect, gap = GAP): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

/**
 * The first free cell for a new card, row by row from `near` (or the origin).
 *
 * @param existing The cards already on the board.
 * @param size The new card's size.
 * @param near Where the reader asked for it, when they did.
 * @returns The top-left corner to put it at.
 */
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

/** How far a new frame keeps from what is on the board (its paper tag stands 15 units above it). */
export const FRAME_GAP = 32;

/** The search grid for `spotNear`, in board units, and how many steps out it looks. */
const NEAR_STEP = 32;
const NEAR_REACH = 60;

/** Grid offsets around the centre, nearest first; ties go down, then right. Built once. */
let nearOffsets: readonly (readonly [number, number])[] | null = null;
function offsets(): readonly (readonly [number, number])[] {
  if (nearOffsets !== null) return nearOffsets;
  const cells: [number, number][] = [];
  for (let i = -NEAR_REACH; i <= NEAR_REACH; i += 1) {
    for (let j = -NEAR_REACH; j <= NEAR_REACH; j += 1) cells.push([i, j]);
  }
  cells.sort(
    (a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || b[1] - a[1] || b[0] - a[0],
  );
  nearOffsets = cells;
  return cells;
}

/**
 * The clear spot nearest `centre` for a new box (Add frame, #214): the box centred on `centre` when
 * nothing is within `gap` of it, else the nearest free cell of a 32-unit grid around it.
 *
 * @param existing What is on the board (cards and frames).
 * @param size The new box's size.
 * @param centre Where it should be centred (the middle of the view).
 * @param gap The clearance it keeps.
 * @returns Its top-left corner.
 * @example
 * spotNear([], { w: 400, h: 300 }, { x: 500, y: 400 }); // { x: 300, y: 250 }
 */
export function spotNear(
  existing: readonly Rect[],
  size: { readonly w: number; readonly h: number },
  centre: { readonly x: number; readonly y: number },
  gap = FRAME_GAP,
): { x: number; y: number } {
  const base = { x: Math.round(centre.x - size.w / 2), y: Math.round(centre.y - size.h / 2) };
  for (const [i, j] of offsets()) {
    const spot = { x: base.x + i * NEAR_STEP, y: base.y + j * NEAR_STEP };
    if (!existing.some((r) => overlaps({ ...spot, ...size }, r, gap))) return spot;
  }
  // Nothing free within reach: the row-by-row search, from the centre.
  return freeSpot(existing, size, base);
}

/**
 * The box that contains every rect, grown by `pad` (and a title strip on top).
 *
 * @param rects The boxes.
 * @param pad The margin around them.
 * @returns The enclosing box.
 */
export function boundsOf(rects: readonly Rect[], pad = 24): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return {
    x: minX - pad,
    y: minY - pad - 28,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2 + 28,
  };
}
