/**
 * The board's stylesheets are global once the reader mounts the board beside the paper (#344), so
 * a class the board shares with `@papertree/ui` restyles the reader. The export sheet once took
 * `.pt-sheet` (the ui bottom Sheet's class, `inset-block: 56px 16px`) and pinned the phone's
 * Explain sheet to the top of the window. The board's classes keep to their own namespaces.
 *
 * @vitest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

describe('board CSS does not take the ui Sheet classes', () => {
  const files = [
    ...cssFiles(resolve(process.cwd(), 'src/features/board')),
    ...cssFiles(resolve(process.cwd(), 'src/features/split')),
  ];

  it('finds the board and split stylesheets', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files)('%s defines no .pt-sheet selector', (file) => {
    const css = readFileSync(file, 'utf8');
    expect(css.match(/\.pt-sheet\b[\w-]*/g) ?? []).toEqual([]);
  });
});
