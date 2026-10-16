/**
 * The plate model (#217) on the recorded faux runs: the plate built from its events, each part's
 * honest verdict (cited, not verified, inferred), the readout counts, the passage numbers and the
 * tabs, and the phase a message's plate is in.
 */
import { describe, expect, it } from 'vitest';

import { plateEvents } from '../../../../test/fixtures/diagram-plate';
import {
  applyPlateEvent,
  countParts,
  EMPTY_PLATE,
  INFERRED_WORDS,
  numberPlatePassages,
  pagesLine,
  platePhase,
  plateReadout,
  stoppedPlateNote,
  tabOf,
  verdictOf,
  withNote,
  type PlateEvent,
  type PlateView,
} from './plate';

import type { DiagramPart } from '@/lib/api/types';

function build(name: 'diagram-plate' | 'diagram-plate-bad'): PlateView {
  return plateEvents(name).reduce<PlateView>((plate, event) => {
    if (event.event === 'plate' || event.event === 'part' || event.event === 'link') {
      return applyPlateEvent(plate, event as PlateEvent);
    }
    if (event.event === 'status' && event.data.phase === 'writing' && event.data.label) {
      return withNote(plate, event.data.label);
    }
    return plate;
  }, EMPTY_PLATE);
}

const GOOD = build('diagram-plate');
const BAD = build('diagram-plate-bad');
const byLetter = (plate: PlateView, letter: string): DiagramPart =>
  plate.parts.find((p) => p.letter === letter) as DiagramPart;

describe('the plate from its events', () => {
  it('builds the recorded plate: its title and six parts in letter order', () => {
    expect(GOOD.title).toBe('Scaled dot-product attention');
    expect(GOOD.parts.map((p) => p.label)).toEqual([
      'Q, K, V',
      'MatMul (Q · Kᵀ)',
      'Scale ÷ √dk',
      'Softmax',
      'MatMul with V',
      'Weights sum to 1',
    ]);
    expect(GOOD.notes).toEqual([]);
  });

  it('never redraws a placed letter', () => {
    const a = GOOD.parts[0] as DiagramPart;
    const again = applyPlateEvent(GOOD, { event: 'part', data: { ...a, label: 'changed' } });
    expect(again).toBe(GOOD);
  });

  it('keeps what the run said it left out while drawing', () => {
    expect(BAD.notes).toEqual([
      'Skipped a line of the plate that could not be read',
      'Part B: dropped an arrow from a part that does not come before it',
      'Part C: dropped an arrow from a part that was not drawn',
    ]);
  });
});

describe('verdicts, never silently uncited', () => {
  it('reads cited, not verified and inferred from the cite', () => {
    expect(GOOD.parts.map(verdictOf)).toEqual([
      'cited',
      'cited',
      'cited',
      'cited',
      'cited',
      'inferred',
    ]);
    // The bad run's C quotes words the paper does not hold: no Anchor, not verified.
    expect(verdictOf(byLetter(BAD, 'C'))).toBe('not-verified');
    expect(byLetter(BAD, 'C').cite?.anchor).toBeNull();
    // Found with differences: an Anchor, but not supported, is not verified either.
    const near = {
      ...byLetter(GOOD, 'A'),
      cite: { ...byLetter(GOOD, 'A').cite!, supported: false },
    };
    expect(verdictOf(near)).toBe('not-verified');
    // "Supported" with no Anchor is not cited either: there is no passage to show (review S1).
    const nowhere = { ...near, cite: { ...near.cite!, supported: true, anchor: null } };
    expect(verdictOf(nowhere)).toBe('not-verified');
    expect(INFERRED_WORDS).toBe('Inferred, no passage');
  });

  it('counts the parts and says the readout from the data', () => {
    expect(countParts(GOOD.parts)).toEqual({ parts: 6, cited: 5, notVerified: 0, inferred: 1 });
    expect(plateReadout(GOOD.parts, false)).toBe('6 parts · 5 cited · drawn by AI from p. 4');
    expect(plateReadout(GOOD.parts.slice(0, 3), true)).toBe('3 parts so far · 3 cited');
    expect(plateReadout(BAD.parts, false)).toBe(
      '3 parts · 2 cited · 1 not verified · drawn by AI from p. 4',
    );
    expect(plateReadout([], true)).toBeNull();
    // With nothing cited the readout still says who drew it (review N1).
    const inferred = GOOD.parts.filter((p) => p.cite === null);
    expect(plateReadout(inferred, false)).toBe('1 part · 0 cited · drawn by AI');
  });

  it('spans the pages the cited parts stand on', () => {
    const on = (part: DiagramPart, pageIndex: number): DiagramPart => ({
      ...part,
      cite: { ...part.cite!, locator: { ...part.cite!.locator!, page_index: pageIndex } },
    });
    const a = byLetter(GOOD, 'A');
    expect(pagesLine([on(a, 2), on(a, 3)])).toBe('pp. 3–4');
    expect(pagesLine([byLetter(GOOD, 'F')])).toBeNull();
  });
});

describe('passage numbers and tabs', () => {
  it('numbers passages in first-cited order: A–D stand on ¶1 (1), E on ¶2 (2)', () => {
    const numbers = numberPlatePassages([GOOD.parts]);
    expect(numbers.size).toBe(2);
    expect(tabOf(byLetter(GOOD, 'A').cite)).toEqual({ page: 4, para: 1 });
    expect(tabOf(byLetter(GOOD, 'E').cite)).toEqual({ page: 4, para: 2 });
    expect(tabOf(byLetter(GOOD, 'F').cite)).toBeNull();
    expect(tabOf(byLetter(BAD, 'C').cite)).toBeNull();
  });

  it('keeps one passage one number across the plates of a thread', () => {
    const numbers = numberPlatePassages([[byLetter(GOOD, 'E')], GOOD.parts]);
    expect([...numbers.values()]).toEqual([1, 2]);
  });

  it('falls back to the page alone when the parse gave no locator', () => {
    const a = byLetter(GOOD, 'A');
    expect(tabOf({ ...a.cite!, locator: null })).toEqual({ page: 4, para: null });
  });
});

describe('platePhase', () => {
  type A = Parameters<typeof platePhase>[0];
  const msg = (status: A['status'], stopped = false, failure: A['failure'] = null): A => ({
    status,
    stopped,
    failure,
  });
  it('thinks, then draws, then settles', () => {
    expect(platePhase(msg('streaming'), EMPTY_PLATE)).toBe('thinking');
    expect(platePhase(msg('streaming'), GOOD)).toBe('drawing');
    expect(platePhase(msg('complete'), GOOD)).toBe('complete');
  });
  it('keeps a stopped or cut plate, and never shows an empty one as drawn', () => {
    expect(platePhase(msg('aborted', true), GOOD)).toBe('stopped');
    expect(platePhase(msg('partial'), GOOD)).toBe('cut');
    expect(platePhase(msg('complete'), EMPTY_PLATE)).toBe('failed');
    expect(platePhase(msg('error', false, { code: 'timeout', retryable: true }), EMPTY_PLATE)).toBe(
      'failed',
    );
  });
  it('reads Stop before the empty check: a Stop at no part is the reader’s, not a failure (B2)', () => {
    // Stop while "Thinking…" (live: stopped, no failure) and its stored copy (`aborted`, no part).
    expect(platePhase(msg('aborted', true), EMPTY_PLATE)).toBe('stopped');
    expect(
      platePhase(msg('aborted', false, { code: 'aborted', retryable: true }), EMPTY_PLATE),
    ).toBe('stopped');
    expect(stoppedPlateNote(0)).toBe('Stopped before any part arrived.');
    expect(stoppedPlateNote(3)).toBe('Stopped. The parts that arrived are kept.');
  });
});
