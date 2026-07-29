// block_vectors — proves sqlite-vec loads and the vec0 table works, so Epic 3 inherits
// something already exercised rather than a table nobody has ever written to.
//
// Epic 0 computes NO embeddings: every vector here is a hand-written dummy. There is no
// model, no embedding call and no network in this file, and that is a scope boundary, not
// an omission.

import { describe, expect, it } from 'vitest';
import {
  asBlockId,
  asPaperId,
  generation,
  openDatabase,
  toVectorBlob,
  VECTOR_DIMENSIONS,
} from '../src/index.js';
import { blockIdFor, makePaper } from './fixtures.js';

const GEN = generation(1);

function unit(index: number): Float32Array {
  const v = new Float32Array(VECTOR_DIMENSIONS);
  v[index] = 1;
  return v;
}

function fixture(): ReturnType<typeof openDatabase> {
  const db = openDatabase();
  db.migrate();
  return db;
}

describe('block_vectors', () => {
  it('inserts a dummy vector and finds it by nearest-neighbour search', () => {
    const db = fixture();
    try {
      const { owner } = db.createUser('vec@papertree.test');
      const paperId = 'ppr_0000000000000000000000VEC1';
      db.putPaper(
        owner,
        makePaper({
          paperId,
          sourceHash: `sha256:${'d'.repeat(64)}`,
          generation: 1,
          blockCount: 4,
        }),
      );

      for (let i = 0; i < 4; i += 1) {
        db.putBlockVector(
          owner,
          asPaperId(paperId),
          GEN,
          asBlockId(blockIdFor(i)),
          'dummy-768',
          unit(i),
        );
      }
      expect(db.countBlockVectors(owner, asPaperId(paperId), GEN)).toBe(4);

      const hits = db.searchBlockVectors(owner, asPaperId(paperId), GEN, unit(2), 2);
      expect(hits).toHaveLength(2);
      expect(hits[0]?.block_id).toBe(blockIdFor(2));
      expect(hits[0]?.distance).toBeCloseTo(0, 5);
      expect(hits[1]?.distance).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('replaces a vector rather than duplicating it (vec0 has no UPSERT)', () => {
    const db = fixture();
    try {
      const { owner } = db.createUser('vec2@papertree.test');
      const paperId = 'ppr_0000000000000000000000VEC2';
      db.putPaper(
        owner,
        makePaper({
          paperId,
          sourceHash: `sha256:${'e'.repeat(64)}`,
          generation: 1,
          blockCount: 2,
        }),
      );
      const blockId = asBlockId(blockIdFor(0));
      db.putBlockVector(owner, asPaperId(paperId), GEN, blockId, 'dummy-768', unit(0));
      db.putBlockVector(owner, asPaperId(paperId), GEN, blockId, 'dummy-768', unit(5));
      expect(db.countBlockVectors(owner, asPaperId(paperId), GEN)).toBe(1);
      expect(
        db.searchBlockVectors(owner, asPaperId(paperId), GEN, unit(5), 1)[0]?.distance,
      ).toBeCloseTo(0, 5);
    } finally {
      db.close();
    }
  });

  it('keeps generations of the same block in separate partitions', () => {
    // vec0's `text primary key` is GLOBALLY unique, so `block_id` alone as the key would
    // collide the moment generation 2 exists — the D13 collision inside the vector table.
    // The composite vec_key is what makes this pass.
    const db = fixture();
    try {
      const { owner } = db.createUser('vec3@papertree.test');
      const paperId = 'ppr_0000000000000000000000VEC3';
      const sourceHash = `sha256:${'0'.repeat(64)}`;
      db.putPaper(owner, makePaper({ paperId, sourceHash, generation: 1, blockCount: 2 }));
      db.putPaper(owner, makePaper({ paperId, sourceHash, generation: 2, blockCount: 2 }));

      const blockId = asBlockId(blockIdFor(0));
      db.putBlockVector(owner, asPaperId(paperId), generation(1), blockId, 'dummy-768', unit(0));
      db.putBlockVector(owner, asPaperId(paperId), generation(2), blockId, 'dummy-768', unit(1));

      expect(db.countBlockVectors(owner, asPaperId(paperId), generation(1))).toBe(1);
      expect(db.countBlockVectors(owner, asPaperId(paperId), generation(2))).toBe(1);
      expect(
        db.searchBlockVectors(owner, asPaperId(paperId), generation(1), unit(0), 1)[0]?.distance,
      ).toBeCloseTo(0, 5);
      expect(
        db.searchBlockVectors(owner, asPaperId(paperId), generation(2), unit(0), 1)[0]?.distance,
      ).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('rejects an embedding of the wrong width before SQLite sees it', () => {
    expect(() => toVectorBlob(new Float32Array(4))).toThrow(/768 dimensions/);
  });
});
