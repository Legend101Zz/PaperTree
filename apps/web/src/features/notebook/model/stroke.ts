/**
 * The ink `Stroke` type and its compact binary form (S5b, #207). We store the pen's centreline
 * points, never the outline, so a stroke re-renders identically under any later look, nib or
 * library version (RESEARCH-R2 section 6). Versioning: a layout change bumps `FORMAT_VERSION`; a
 * new flag bit may be added only because old readers reject unknown flags. About 3.4 bytes per point against 76 for raw JSON.
 */

/** One sample: x and y in page units, pressure 0..1. */
export type StrokePoint = readonly [x: number, y: number, pressure: number];

/** `pen` writes; `highlighter` is the wide translucent one. */
export type StrokeTool = 'pen' | 'highlighter';

/** Nib widths: extra fine, fine, medium. */
export type StrokeNib = 'EF' | 'F' | 'M';

/** Nib diameter in page units at full pressure, per tool and nib. */
export const NIB_DIAMETER: Readonly<Record<StrokeTool, Readonly<Record<StrokeNib, number>>>> = {
  pen: { EF: 1.5, F: 2.5, M: 4 },
  highlighter: { EF: 12, F: 16, M: 22 },
};

/** The part of a stroke that is stored as a blob. */
export interface StrokeGeometry {
  readonly points: readonly StrokePoint[];
  /** False for a mouse or finger: no pressure bytes are stored and pressure is simulated on render. */
  readonly hasPressure: boolean;
}

/** An ink stroke on a notebook page. Immutable; moving one makes a new one. */
export interface Stroke extends StrokeGeometry {
  readonly id: string;
  readonly tool: StrokeTool;
  readonly nib: StrokeNib;
  /** A TOKEN NAME such as `pen` or `hl-amber`, not a hex, so the lamp-lit scheme can re-map it. */
  readonly color: string;
}

/** Highest point count a stroke may have; longer scribbles should be split by the caller. */
export const MAX_STROKE_POINTS = 20_000;

/**
 * Largest |x| or |y| (page units) a stroke may have. A page is 960 wide, so this is generous; the
 * bound keeps quantised values exact in a double and every blob we write decodable.
 */
export const MAX_COORDINATE = 1e6;

/** Layout version written as the first byte. */
const FORMAT_VERSION = 1;
/** 1/16 page unit: far below a pixel even at 4x zoom. */
const QUANT = 16;
const FLAG_PRESSURE = 1;
/** Pressure assumed when a stroke carries none. */
const DEFAULT_PRESSURE = 0.5;

/** Thrown by `encodeStroke` when a stroke has more than `MAX_STROKE_POINTS` points. */
export class StrokeTooLongError extends Error {
  /**
   * Builds the error.
   *
   * @param count - The offending point count.
   */
  constructor(count: number) {
    super(`stroke has ${count} points; the limit is ${MAX_STROKE_POINTS}`);
    this.name = 'StrokeTooLongError';
  }
}

/** Thrown by `encodeStroke` for a non-finite coordinate or pressure, or one beyond `MAX_COORDINATE`. */
export class StrokeRangeError extends RangeError {
  /**
   * Builds the error.
   *
   * @param what - Which value was wrong.
   */
  constructor(what: string) {
    super(`stroke value out of range: ${what}`);
    this.name = 'StrokeRangeError';
  }
}

/** Thrown by `decodeStroke` for a blob that is truncated, has an unknown version, or lies about its size. */
export class StrokeDecodeError extends Error {
  /**
   * Builds the error.
   *
   * @param reason - What was wrong with the bytes.
   */
  constructor(reason: string) {
    super(`cannot decode stroke: ${reason}`);
    this.name = 'StrokeDecodeError';
  }
}

/**
 * Zigzag maps signed to unsigned so small negatives stay small. Arithmetic, not bitwise: no 32-bit wrap.
 *
 * @param n - A signed integer.
 * @returns The unsigned code.
 */
function zigzag(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

/**
 * Inverse of `zigzag`.
 *
 * @param u - An unsigned code.
 * @returns The signed integer.
 */
function unzigzag(u: number): number {
  return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
}

/**
 * Appends an unsigned LEB128 varint.
 *
 * @param out - Byte list to append to.
 * @param n - Non-negative integer.
 */
function pushVarint(out: number[], n: number): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

/**
 * Encodes a stroke's points: `[version, flags, varint count]`, then per point a zigzag varint
 * x and y (the first absolute, the rest deltas, all at 1/16 unit) and one pressure byte if
 * `hasPressure`. Decoded coordinates are within 1/32 unit of the input.
 *
 * @param stroke - The geometry to encode (a full `Stroke` is fine).
 * @returns The compact bytes.
 * @throws StrokeTooLongError above `MAX_STROKE_POINTS` points.
 * @throws StrokeRangeError for a non-finite value, or a coordinate beyond `MAX_COORDINATE`.
 */
export function encodeStroke(stroke: StrokeGeometry): Uint8Array {
  const { points, hasPressure } = stroke;
  if (points.length > MAX_STROKE_POINTS) throw new StrokeTooLongError(points.length);
  const out: number[] = [FORMAT_VERSION, hasPressure ? FLAG_PRESSURE : 0];
  pushVarint(out, points.length);
  let px = 0;
  let py = 0;
  for (const [x, y, p] of points) {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > MAX_COORDINATE ||
      Math.abs(y) > MAX_COORDINATE
    ) {
      throw new StrokeRangeError(`coordinate (${x}, ${y})`);
    }
    if (hasPressure && !Number.isFinite(p)) throw new StrokeRangeError(`pressure ${p}`);
    const qx = Math.round(x * QUANT);
    const qy = Math.round(y * QUANT);
    pushVarint(out, zigzag(qx - px));
    pushVarint(out, zigzag(qy - py));
    if (hasPressure) out.push(Math.round(Math.min(1, Math.max(0, p)) * 255));
    px = qx;
    py = qy;
  }
  return Uint8Array.from(out);
}

/**
 * Decodes bytes made by `encodeStroke`.
 *
 * @param bytes - The blob.
 * @returns Points in page units and the pressure flag. Without pressure every point reads 0.5.
 * @throws StrokeDecodeError for a truncated blob, an unknown version or flag, trailing bytes, or a
 *   count above the cap.
 */
export function decodeStroke(bytes: Uint8Array): StrokeGeometry {
  let o = 0;
  const next = (): number => {
    if (o >= bytes.length) throw new StrokeDecodeError('truncated');
    return bytes[o++]!;
  };
  const varint = (): number => {
    let v = 0;
    let scale = 1;
    for (;;) {
      const b = next();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 0x80;
      if (scale > 2 ** 49) throw new StrokeDecodeError('varint too long');
    }
  };
  const version = next();
  if (version !== FORMAT_VERSION) throw new StrokeDecodeError(`unknown version ${version}`);
  const flags = next();
  // A later flag may add bytes per point; a v1 reader must fail loudly rather than misparse.
  if ((flags & ~FLAG_PRESSURE) !== 0)
    throw new StrokeDecodeError(`unknown flags 0x${flags.toString(16)}`);
  const hasPressure = (flags & FLAG_PRESSURE) !== 0;
  const n = varint();
  if (n > MAX_STROKE_POINTS) throw new StrokeDecodeError(`point count ${n} above the cap`);
  const points: StrokePoint[] = [];
  let qx = 0;
  let qy = 0;
  for (let i = 0; i < n; i++) {
    qx += unzigzag(varint());
    qy += unzigzag(varint());
    const p = hasPressure ? next() / 255 : DEFAULT_PRESSURE;
    points.push([qx / QUANT, qy / QUANT, p]);
  }
  if (o !== bytes.length) throw new StrokeDecodeError('trailing bytes');
  return { points, hasPressure };
}
