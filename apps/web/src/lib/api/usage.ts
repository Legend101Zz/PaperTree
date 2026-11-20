/**
 * lib/api/usage — contracts.md §2.5 `GET /usage`. Owned by S6 after S0.
 *
 * `by_kind`'s per-kind shape is not spelled out by the contract; it is typed here as the same
 * totals as the top level, split by kind, and S0's wave-2 pydantic model is the authority that
 * `contracts.spec` will hold this to. The server answers 501 until S5 lands.
 */
import { request } from './client';

export interface UsageBucket {
  readonly runs: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost_usd_est: number;
}

export interface UsageTotals extends UsageBucket {
  /** ISO-8601; defaults to now − 24 h. */
  readonly since: string;
  /** `PAPERTREE_DAILY_BUDGET_USD`, per user, rolling 24 h. */
  readonly budget_usd: number;
  readonly by_kind: {
    readonly explain: UsageBucket;
    readonly ask: UsageBucket;
    readonly summary: UsageBucket;
    readonly diagram: UsageBucket;
    /** The topic run (#242). */
    readonly topic: UsageBucket;
    /** The image ask (v0.3 #348): a run shown a crop of a figure. */
    readonly image: UsageBucket;
    /** The spread's "At a glance" run (v0.3 #337). */
    readonly glance: UsageBucket;
  };
}

export const usageApi = {
  get: (since?: string) =>
    request<UsageTotals>(
      `/usage${since === undefined ? '' : `?since=${encodeURIComponent(since)}`}`,
    ),
};
