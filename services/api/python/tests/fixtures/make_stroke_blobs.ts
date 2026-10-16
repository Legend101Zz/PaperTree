/**
 * Writes `stroke_blobs.json`: blobs made by the web's REAL `encodeStroke` (stroke.ts), so the
 * Python stroke check (`papertree_db.notebook.check_stroke_blob`) is held to the encoder and not
 * to bytes its author wrote by hand. Regenerate only if `stroke.ts`'s format changes:
 *
 *   node_modules/.bin/tsx services/api/python/tests/fixtures/make_stroke_blobs.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeStroke } from '../../../../../apps/web/src/features/notebook/model/stroke.ts';

type P = [number, number, number];
const blobs: Record<string, string> = {};
const make = (name: string, n: number, at: (i: number) => P, hasPressure: boolean): void => {
  const points = Array.from({ length: n }, (_, i) => at(i));
  blobs[name] = Buffer.from(encodeStroke({ points, hasPressure })).toString('base64');
};

make('empty', 0, () => [0, 0, 0], true);
make('one_point', 1, () => [10.3, 20.7, 0.4], true);
make('no_pressure_50', 50, (i) => [i * 3.1, 100 + Math.sin(i) * 20, 0.5], false);
make('pressure_300', 300, (i) => [i * 2.2, 100 + Math.cos(i) * 20, (i % 10) / 10], true);
make('negative_5', 5, (i) => [-i * 1000, -i * 500, 1], true);
make('extreme_8', 8, (i) => [i % 2 ? 1e6 : -1e6, i % 2 ? 1e6 : -1e6, 1], true);

writeFileSync(
  fileURLToPath(new URL('./stroke_blobs.json', import.meta.url)),
  JSON.stringify(
    {
      made_by: 'make_stroke_blobs.ts, with encodeStroke from apps/web/.../model/stroke.ts',
      blobs,
    },
    null,
    2,
  ) + '\n',
);
