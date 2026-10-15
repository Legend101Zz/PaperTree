/**
 * The model policy (ADR-003). Which MiniMax model answers which kind of run, and how hard it thinks.
 *
 *   PAPERTREE_MODEL            one model for every kind (unset: DEFAULT_MODELS below)
 *   PAPERTREE_MODEL_EXPLAIN    override for `explain`; likewise _ASK and _SUMMARY
 *   PAPERTREE_MODEL_EFFORT     Flash thinking effort (low | medium | high); likewise _EXPLAIN, _ASK, _SUMMARY
 *
 * Two models are allowed: MiniMax-M3 (in Pi's catalog) and MiniMax-M3.1-Flash-Preview (NOT in the
 * catalog; registered below as a custom model through the SDK's own registerProvider). Flash cannot
 * have thinking switched off (the API answers 400 "requires adaptive thinking" to thinking
 * {type: disabled} and to effort "none"), so a Flash request is always adaptive thinking plus an
 * effort. Pi sends exactly that for a model whose compat sets `forceAdaptiveThinking`: no payload
 * rewriting here.
 */
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export const PROVIDER_ID = 'minimax';
export const M3_MODEL_ID = 'MiniMax-M3';
export const FLASH_MODEL_ID = 'MiniMax-M3.1-Flash-Preview';
export const ALLOWED_MODEL_IDS = [M3_MODEL_ID, FLASH_MODEL_ID] as const;
export type ModelId = (typeof ALLOWED_MODEL_IDS)[number];

export const RUN_KINDS = ['explain', 'ask', 'summary'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * The shipped default (ADR-003), decided by the A/B in docs/release/v0.1/MODEL-AB.md: Flash (effort
 * low) answers `explain` and `ask`, M3 writes the `summary` (Flash's summaries read `partial` far
 * more often: an uncited heading bullet, citation ranges that do not parse).
 */
export const DEFAULT_MODELS: Readonly<Record<RunKind, ModelId>> = {
  explain: FLASH_MODEL_ID,
  ask: FLASH_MODEL_ID,
  summary: M3_MODEL_ID,
};
export const DEFAULT_EFFORT: Effort = 'low';

export interface ModelChoice {
  readonly id: ModelId;
  /** `minimax/<id>`: the `run.model` of the stream and the API's `ai_runs.model`. */
  readonly label: string;
  /** Flash only: the effort sent. M3 keeps Pi's low budget-based thinking and reports `null`. */
  readonly effort: Effort | null;
}

export type ModelPolicy = Readonly<Record<RunKind, ModelChoice>>;

export const modelLabel = (id: string): string => `${PROVIDER_ID}/${id}`;

/**
 * MiniMax publishes no price for Flash (checked 2026-10-09 on the pricing and Anthropic-API pages).
 * The Flash definition below carries M3's rates, and every place that reports a Flash cost says so.
 */
export const FLASH_COST_BASIS = 'estimate on M3 rates';
export const CATALOG_COST_BASIS = 'Pi catalog rates';
export const costBasis = (id: string): string =>
  id === FLASH_MODEL_ID ? FLASH_COST_BASIS : CATALOG_COST_BASIS;

export class PolicyError extends Error {}

function pickModel(name: string, raw: string | undefined): ModelId | undefined {
  if (raw === undefined || raw === '') return undefined;
  const found = ALLOWED_MODEL_IDS.find((id) => id === raw);
  if (found === undefined) {
    throw new PolicyError(`${name}=${raw} is not one of ${ALLOWED_MODEL_IDS.join(', ')}`);
  }
  return found;
}

function pickEffort(name: string, raw: string | undefined): Effort | undefined {
  if (raw === undefined || raw === '') return undefined;
  const found = EFFORTS.find((e) => e === raw);
  if (found === undefined) {
    throw new PolicyError(`${name}=${raw} is not one of ${EFFORTS.join(', ')}`);
  }
  return found;
}

/** Read the policy from an environment. Throws PolicyError, never naming a secret. */
export function readPolicy(env: NodeJS.ProcessEnv): ModelPolicy {
  const all = pickModel('PAPERTREE_MODEL', env['PAPERTREE_MODEL']);
  const allEffort = pickEffort('PAPERTREE_MODEL_EFFORT', env['PAPERTREE_MODEL_EFFORT']);
  const choice = (kind: RunKind): ModelChoice => {
    const suffix = kind.toUpperCase();
    const id =
      pickModel(`PAPERTREE_MODEL_${suffix}`, env[`PAPERTREE_MODEL_${suffix}`]) ??
      all ??
      DEFAULT_MODELS[kind];
    const effort =
      pickEffort(`PAPERTREE_MODEL_EFFORT_${suffix}`, env[`PAPERTREE_MODEL_EFFORT_${suffix}`]) ??
      allEffort ??
      DEFAULT_EFFORT;
    return { id, label: modelLabel(id), effort: id === FLASH_MODEL_ID ? effort : null };
  };
  return { explain: choice('explain'), ask: choice('ask'), summary: choice('summary') };
}

/** True when the environment names a model or an effort (so a faux agent should honour it). */
export const namesPolicy = (env: NodeJS.ProcessEnv): boolean =>
  Object.keys(env).some(
    (k) => k.startsWith('PAPERTREE_MODEL') && env[k] !== undefined && env[k] !== '',
  );

/** A policy with one model for every kind (tests, defaults). */
export function uniformPolicy(id: ModelId, effort: Effort = DEFAULT_EFFORT): ModelPolicy {
  const c: ModelChoice = {
    id,
    label: modelLabel(id),
    effort: id === FLASH_MODEL_ID ? effort : null,
  };
  return { explain: c, ask: c, summary: c };
}

/** The models a policy uses, once each. */
export function modelsUsed(policy: ModelPolicy): ModelId[] {
  return [...new Set(RUN_KINDS.map((k) => policy[k].id))];
}

const FLASH_DEFINITION = {
  id: FLASH_MODEL_ID,
  name: FLASH_MODEL_ID,
  api: 'anthropic-messages' as const,
  baseUrl: 'https://api.minimax.io/anthropic',
  reasoning: true,
  input: ['text', 'image'] as ('text' | 'image')[],
  // M3's rates: see FLASH_COST_BASIS.
  cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 128_000,
  // The one switch that makes Pi send {thinking: {type: 'adaptive'}, output_config: {effort}}.
  compat: { forceAdaptiveThinking: true },
};

/**
 * Add Flash to the runtime. `registerProvider` REPLACES the provider's model list, so the catalog's
 * models are passed again. No network, no models.json.
 */
export function registerFlash(runtime: ModelRuntime): void {
  const catalog = runtime.getModels(PROVIDER_ID).filter((m) => m.id !== FLASH_MODEL_ID);
  runtime.registerProvider(PROVIDER_ID, {
    models: [
      ...catalog.map((m) => ({
        id: m.id,
        name: m.name,
        api: m.api,
        baseUrl: m.baseUrl,
        reasoning: m.reasoning,
        thinkingLevelMap: m.thinkingLevelMap,
        input: m.input,
        cost: m.cost,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        compat: m.compat,
        inputLimits: m.inputLimits,
      })),
      FLASH_DEFINITION,
    ],
  });
}
