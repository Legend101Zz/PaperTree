/**
 * The reader's saved place for one paper (contracts.md §5): `{v, mode, zoomMode, page, yPt, blockId}`
 * under `papertree/reader/<paper_id>`. Pure read/validate/write, so the library's "Continue" and the
 * reader can be held to the same rules by a test (`library-reader-place.spec.ts`).
 */

import { FIT_WIDTH, type ZoomMode } from '@/components/reader/ZoomControl';

/** The three ways to read a paper. */
export type ReadingMode = 'source' | 'guided' | 'split';

/** What is stored per paper. */
export interface SavedReaderState {
  readonly v: 1;
  readonly mode: ReadingMode;
  readonly zoomMode: ZoomMode;
  readonly page: number;
  readonly yPt: number;
  readonly blockId?: string;
}

function isZoomMode(value: unknown): value is ZoomMode {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'fit-width' || kind === 'fit-page') return true;
  const scale = (value as { scale?: unknown }).scale;
  return kind === 'scale' && typeof scale === 'number' && Number.isFinite(scale) && scale > 0;
}

/**
 * The saved place under `key`, or null when absent, corrupt or invalid.
 * @param key The paper's storage key.
 * @returns The valid saved place, or null.
 */
export function readSavedReaderState(key: string): SavedReaderState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<SavedReaderState>;
    if (value.v !== 1) return null;
    if (value.mode !== 'source' && value.mode !== 'guided' && value.mode !== 'split') return null;
    if (!isZoomMode(value.zoomMode)) return null;
    if (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 0)
      return null;
    if (typeof value.yPt !== 'number' || !Number.isFinite(value.yPt) || value.yPt < 0) return null;
    return {
      v: 1,
      mode: value.mode,
      zoomMode: value.zoomMode,
      page: value.page,
      yPt: value.yPt,
      ...(typeof value.blockId === 'string' && value.blockId !== ''
        ? { blockId: value.blockId }
        : {}),
    };
  } catch {
    // Private mode, blocked storage, a corrupt entry: the paper opens at the top. Never a crash.
    return null;
  }
}

/**
 * Save the place; a blocked or full store is ignored.
 * @param key The paper's storage key.
 * @param state The place to keep.
 */
export function writeSavedReaderState(key: string, state: SavedReaderState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the position is a convenience, not data.
  }
}

/**
 * Phones and narrow windows open fit-width; wider screens at a comfortable 125 %.
 * @returns The zoom mode to open with.
 */
export function defaultZoomMode(): ZoomMode {
  if (typeof window === 'undefined') return { kind: 'scale', scale: 1 };
  return window.innerWidth < 768 ? FIT_WIDTH : { kind: 'scale', scale: 1.25 };
}
