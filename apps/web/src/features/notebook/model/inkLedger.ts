/**
 * What the page knows about the server's copy of its ink (S5d, #209): the stroke ids the server
 * holds, those it refused for good, those whose POST failed but may have landed anyway, and those
 * whose last send failed and are still owed. Pure bookkeeping: `useStrokeSaver` owns the network
 * and feeds each answer in, and asks what to send next (`writes`).
 */
import { strokeWrites } from './inkSync';

import type { StrokeWrites } from './inkSync';
import type { Stroke } from './stroke';

/** What became of the strokes of one POST (`api/pushStrokes`). */
export interface BatchOutcome {
  /** On the server now. */
  readonly saved: readonly string[];
  /** Refused for good (422/413), with the server's words. */
  readonly refused: readonly { readonly id: string; readonly detail: string }[];
  /** Not saved; still owed. */
  readonly failed: readonly string[];
  /** Of `failed`, those whose request may have reached the server anyway. */
  readonly uncertain: readonly string[];
  /** The POST answered 404: the page was deleted elsewhere. */
  readonly pageGone: boolean;
}

/** The saver's ledger of one page's ink. */
export class InkLedger {
  private server = new Set<string>();
  private readonly refused = new Set<string>();
  private readonly uncertain = new Set<string>();
  private readonly failing = new Set<string>();

  /**
   * Takes the loaded strokes as the server's.
   *
   * @param ids - The stroke ids the page was loaded with.
   */
  seed(ids: readonly string[]): void {
    this.server = new Set(ids);
  }

  /**
   * What to send so the server matches the page.
   *
   * @param local - The strokes on the page now.
   * @returns The POSTs and DELETEs owed.
   */
  writes(local: readonly Stroke[]): StrokeWrites {
    return strokeWrites(this.server, local, this.refused, this.uncertain);
  }

  /**
   * How many strokes the server does not hold as the page shows them (refused ones included).
   *
   * @param local - The strokes on the page now.
   * @returns The count.
   */
  unsaved(local: readonly Stroke[]): number {
    const w = strokeWrites(this.server, local, new Set(), this.uncertain);
    return w.add.length + w.remove.length;
  }

  /**
   * Strokes whose last send failed and that are still owed.
   *
   * @returns Their count.
   */
  get failed(): number {
    return this.failing.size;
  }

  /**
   * Records a POST's answer.
   *
   * @param o - What became of each stroke.
   */
  posted(o: BatchOutcome): void {
    for (const id of [...o.saved, ...o.refused.map((r) => r.id)]) this.settle(id);
    for (const id of o.saved) this.server.add(id);
    for (const { id } of o.refused) this.refused.add(id);
    for (const id of o.uncertain) this.uncertain.add(id);
    if (!o.pageGone) for (const id of o.failed) this.failing.add(id);
  }

  /**
   * Records a DELETE's answer.
   *
   * @param id - The stroke.
   * @param gone - True once it is not on the server (404 included).
   */
  deleted(id: string, gone: boolean): void {
    if (!gone) {
      this.failing.add(id);
      return;
    }
    this.settle(id);
    this.server.delete(id);
  }

  /**
   * Forgets failures that are no longer owed: an undone stroke whose POST never landed.
   *
   * @param w - What is owed now (`writes`).
   */
  prune(w: StrokeWrites): void {
    const owed = new Set([...w.add.map((s) => s.id), ...w.remove]);
    for (const id of this.failing) if (!owed.has(id)) this.failing.delete(id);
  }

  private settle(id: string): void {
    this.uncertain.delete(id);
    this.failing.delete(id);
  }
}
