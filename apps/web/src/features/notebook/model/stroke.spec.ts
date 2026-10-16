import { describe, expect, it } from 'vitest';

import {
  decodeStroke,
  encodeStroke,
  MAX_STROKE_POINTS,
  StrokeDecodeError,
  StrokeTooLongError,
  type StrokePoint,
} from './stroke';

describe('stroke binary format', () => {
  it('round-trips within 1/32 unit, including negative coordinates', () => {
    const points: StrokePoint[] = [
      [-120.37, 5.5, 0.2],
      [-119.9, 4.1, 0.6],
      [300.25, -77.77, 1],
      [0, 0, 0],
    ];
    const back = decodeStroke(encodeStroke({ points, hasPressure: true }));
    expect(back.hasPressure).toBe(true);
    back.points.forEach((p, i) => {
      expect(Math.abs(p[0] - points[i]![0])).toBeLessThanOrEqual(1 / 32);
      expect(Math.abs(p[1] - points[i]![1])).toBeLessThanOrEqual(1 / 32);
      expect(Math.abs(p[2] - points[i]![2])).toBeLessThanOrEqual(1 / 255);
    });
  });

  it('drops pressure bytes for a mouse stroke and reads back 0.5', () => {
    const points: StrokePoint[] = [
      [1, 2, 0.9],
      [3, 4, 0.1],
    ];
    const bytes = encodeStroke({ points, hasPressure: false });
    expect(bytes.length).toBe(2 + 1 + 4);
    expect(decodeStroke(bytes).points.map((p) => p[2])).toEqual([0.5, 0.5]);
  });

  it('is compact: about 4 bytes per pressure point on smooth handwriting', () => {
    const points: StrokePoint[] = Array.from({ length: 80 }, (_, i) => [
      100 + i * 2.5,
      200 + Math.sin(i / 5) * 8,
      0.5,
    ]);
    expect(encodeStroke({ points, hasPressure: true }).length).toBeLessThan(80 * 4.5);
  });

  it('accepts exactly the cap and throws a typed error above it', () => {
    const pt = (n: number): StrokePoint[] => Array.from({ length: n }, (_, i) => [i, i, 0.5]);
    expect(
      decodeStroke(encodeStroke({ points: pt(MAX_STROKE_POINTS), hasPressure: true })).points,
    ).toHaveLength(MAX_STROKE_POINTS);
    expect(() => encodeStroke({ points: pt(MAX_STROKE_POINTS + 1), hasPressure: true })).toThrow(
      StrokeTooLongError,
    );
  });

  it('rejects truncated, unknown-version and oversized blobs', () => {
    const ok = encodeStroke({
      points: [
        [1, 1, 0.5],
        [2, 2, 0.5],
      ],
      hasPressure: true,
    });
    expect(() => decodeStroke(ok.slice(0, ok.length - 1))).toThrow(StrokeDecodeError);
    expect(() => decodeStroke(Uint8Array.from([9, 0, 0]))).toThrow(StrokeDecodeError);
    expect(() => decodeStroke(Uint8Array.from([1, 0, 0xff, 0xff, 0x7f]))).toThrow(
      StrokeDecodeError,
    );
  });

  it('encodes an empty stroke', () => {
    expect(decodeStroke(encodeStroke({ points: [], hasPressure: true })).points).toEqual([]);
  });
});
