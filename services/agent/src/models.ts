/**
 * The model policy (ADR-003, Revision 2026-11-19). Which MiniMax model answers which kind of run,
 * and how hard it thinks.
 *
 *   PAPERTREE_MODEL            one model for every kind (unset: DEFAULT_MODELS below)
 *   PAPERTREE_MODEL_EXPLAIN    override for `explain`; likewise _ASK, _SUMMARY, _DIAGRAM, _TOPIC,
 *                              _GLANCE and _IMAGE (the image ask, v0.3 #348: it is shown a crop of a figure, so
 *                              its model MUST accept images: see `acceptsImages`)
 *   PAPERTREE_MODEL_EFFORT     Flash thinking effort (low | medium | high); likewise per kind
 *                              (unset: DEFAULT_EFFORTS below)
 *
 * Flash (MiniMax-M3.1-Flash, GA) is the default for EVERY kind. MiniMax-M3 stays an allowed
 * override. Two models are allowed: M3 (in Pi's catalog) and Flash (NOT in Pi's catalog, pi-ai
 * 0.87.1; registered below as a custom model through the SDK's own registerProvider). Flash cannot
 * have thinking switched off (the API answers 400 "requires adaptive thinking" to thinking
 * {type: disabled} and to effort "none"), so a Flash request is always adaptive thinking plus an
 * effort. Pi sends exactly that for a model whose compat sets `forceAdaptiveThinking`: no payload
 * rewriting here.
 *
 * The retired id MiniMax-M3.1-Flash-Preview is not accepted as an override (no legacy shim; it now
 * aliases to Flash and responses report the GA id). Old `ai_runs.model` rows that carry it stay
 * readable in the API as data: see KNOWN_MODELS in services/api/python/papertree_api/agent_client.py.
 */
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export const PROVIDER_ID = 'minimax';
export const M3_MODEL_ID = 'MiniMax-M3';
export const FLASH_MODEL_ID = 'MiniMax-M3.1-Flash';
export const ALLOWED_MODEL_IDS = [M3_MODEL_ID, FLASH_MODEL_ID] as const;
export type ModelId = (typeof ALLOWED_MODEL_IDS)[number];

export const RUN_KINDS = [
  'explain',
  'ask',
  'summary',
  'diagram',
  'topic',
  'glance',
  'image',
] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * The shipped default (ADR-003 "Revision 2026-11-19"): Flash answers every kind. It is GA, smarter
 * and faster than the preview the v0.1 A/B (docs/release/v0.1/MODEL-AB.md) measured, so the v0.1
 * split (M3 for ask and summary) is retired; M3 stays one env var away.
 * The image ask (v0.3 #348) is its own kind: Flash, which accepts images (live check 2026-11-19).
 */
export const DEFAULT_MODELS: Readonly<Record<RunKind, ModelId>> = {
  explain: FLASH_MODEL_ID,
  ask: FLASH_MODEL_ID,
  summary: FLASH_MODEL_ID,
  diagram: FLASH_MODEL_ID,
  topic: FLASH_MODEL_ID,
  image: FLASH_MODEL_ID,
  glance: FLASH_MODEL_ID,
};

/** Flash's default effort per kind. A global or per-kind env var overrides it exactly as before. */
export const DEFAULT_EFFORTS: Readonly<Record<RunKind, Effort>> = {
  // A short answer from one selection: speed matters.
  explain: 'low',
  // An open question over a path through the paper: more reasoning.
  ask: 'medium',
  // The whole paper, with structure and citations to keep straight.
  summary: 'medium',
  // A short, structured plate from one selection, shaped like an explain; no evidence yet that
  // more thinking helps it keep to the line format, so it keeps explain's speed.
  diagram: 'low',
  // One short JSON object per upload, no tools.
  topic: 'low',
  // A picture is read against its caption: both models invented unreadable text on 19 Nov (#348).
  image: 'medium',
  // One short JSON sheet from the digest, no tools, made once per paper in the background: the
  // gist and the caps are a summary of text already in front of it, so speed and cost win.
  glance: 'low',
};

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
 * Flash's rates are MiniMax's published ones (platform.minimax.io/docs/guides/pricing, read
 * 2026-11-19): $0.15 input / $0.60 output / $0.015 cache read per million tokens; no cache-write
 * price is listed, so it is 0. M3 ($0.30 / $1.20 / $0.06) comes from Pi's catalog.
 */
export const FLASH_COST_BASIS = 'published rates (MiniMax pricing page, 2026-11-19)';
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
      DEFAULT_EFFORTS[kind];
    return { id, label: modelLabel(id), effort: id === FLASH_MODEL_ID ? effort : null };
  };
  return {
    explain: choice('explain'),
    ask: choice('ask'),
    summary: choice('summary'),
    diagram: choice('diagram'),
    topic: choice('topic'),
    glance: choice('glance'),
    image: choice('image'),
  };
}

/** True when the environment names a model or an effort (so a faux agent should honour it). */
export const namesPolicy = (env: NodeJS.ProcessEnv): boolean =>
  Object.keys(env).some(
    (k) => k.startsWith('PAPERTREE_MODEL') && env[k] !== undefined && env[k] !== '',
  );

/** A policy with one model for every kind (tests, defaults). */
export function uniformPolicy(id: ModelId, effort: Effort = 'low'): ModelPolicy {
  const c: ModelChoice = {
    id,
    label: modelLabel(id),
    effort: id === FLASH_MODEL_ID ? effort : null,
  };
  return { explain: c, ask: c, summary: c, diagram: c, topic: c, glance: c, image: c };
}

/** The models a policy uses, once each. */
export function modelsUsed(policy: ModelPolicy): ModelId[] {
  return [...new Set(RUN_KINDS.map((k) => policy[k].id))];
}

/**
 * Whether a model takes images as input (its definition lists `image`). A model that does not must
 * never be sent one: the image run's guard (`run.ts`, `session.ts`) and the boot check (`app.ts`)
 * both ask this, and fail loudly rather than let the provider drop the picture silently.
 */
export const acceptsImages = (model: { readonly input?: readonly string[] }): boolean =>
  model.input?.includes('image') === true;

const FLASH_DEFINITION = {
  id: FLASH_MODEL_ID,
  name: FLASH_MODEL_ID,
  api: 'anthropic-messages' as const,
  baseUrl: 'https://api.minimax.io/anthropic',
  reasoning: true,
  input: ['text', 'image'] as ('text' | 'image')[],
  // Published rates: see FLASH_COST_BASIS.
  cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
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
