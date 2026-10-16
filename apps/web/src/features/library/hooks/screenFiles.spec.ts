/**
 * The upload queue's refusals (#195): a non-PDF and a file over the limit are refused, with the
 * reason as the end of a sentence, before any bytes leave; ids come from the caller.
 */
import { describe, expect, it } from 'vitest';

import { formatBytes, screenFiles } from './useUploadQueue';

const file = (name: string, size: number, type = 'application/pdf') =>
  new File([new Uint8Array(size)], name, { type });

describe('screenFiles', () => {
  it('accepts PDFs by type or by name, refuses the rest with a sentence, keeps the order', () => {
    let n = 0;
    const { accepted, refused } = screenFiles(
      [file('a.pdf', 10), file('notes.txt', 10, 'text/plain'), file('B.PDF', 10, '')],
      undefined,
      () => `id-${String((n += 1))}`,
    );
    expect(accepted.map((a) => [a.id, a.file.name])).toEqual([
      ['id-1', 'a.pdf'],
      ['id-3', 'B.PDF'],
    ]);
    expect(refused).toEqual([
      {
        id: 'id-2',
        fileName: 'notes.txt',
        reason: 'is not a PDF. Choose a file that ends in .pdf.',
      },
    ]);
  });

  it('refuses a PDF over the limit, naming the limit', () => {
    const { accepted, refused } = screenFiles(
      [file('big.pdf', 3 * 1024 * 1024)],
      2 * 1024 * 1024,
      () => 'x',
    );
    expect(accepted).toEqual([]);
    expect(refused[0]?.reason).toBe('is larger than 2.0 MB. Choose a smaller PDF.');
    expect(formatBytes(512)).toBe('1 KB');
  });
});
