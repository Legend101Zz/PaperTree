/** inkLedger.spec — the stroke saver's bookkeeping, without the network (#209). */
import { describe, expect, it } from 'vitest';

import { InkLedger } from './inkLedger';
import { stroke } from './test-helpers';

const a = stroke('ns_aaaaaaaa', [[10, 10]]);
const b = stroke('ns_bbbbbbbb', [[20, 20]]);
const none = { saved: [], refused: [], failed: [], uncertain: [], pageGone: false };

describe('InkLedger', () => {
  it('owes a DELETE for a stroke whose failed POST may have landed, once it leaves the page', () => {
    const ledger = new InkLedger();
    ledger.posted({ ...none, failed: [a.id], uncertain: [a.id] });
    expect(ledger.failed).toBe(1);
    expect(ledger.writes([a])).toEqual({ add: [a], remove: [] }); // still on the page: POST again
    const undone = ledger.writes([]);
    expect(undone).toEqual({ add: [], remove: [a.id] }); // undone: DELETE it
    ledger.prune(undone);
    expect(ledger.failed).toBe(1); // the DELETE is still owed
    ledger.deleted(a.id, true);
    expect([ledger.failed, ledger.unsaved([])]).toEqual([0, 0]);
  });

  it('forgets a failure whose stroke never landed and is no longer on the page', () => {
    const ledger = new InkLedger();
    ledger.posted({ ...none, failed: [a.id] }); // a 4xx answer: it did not land
    const w = ledger.writes([b]);
    expect(w.remove).toEqual([]);
    ledger.prune(w);
    expect(ledger.failed).toBe(0);
  });

  it('never asks to send a refused stroke again, but still counts it as not saved', () => {
    const ledger = new InkLedger();
    ledger.posted({ ...none, saved: [b.id], refused: [{ id: a.id, detail: 'bad' }] });
    expect(ledger.writes([a, b])).toEqual({ add: [], remove: [] });
    expect(ledger.unsaved([a, b])).toBe(1);
  });

  it('does not count a deleted page as failures: that is said once, by the page', () => {
    const ledger = new InkLedger();
    ledger.posted({ ...none, failed: [a.id], pageGone: true });
    expect(ledger.failed).toBe(0);
  });
});
