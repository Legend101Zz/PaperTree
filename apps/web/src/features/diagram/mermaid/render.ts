/**
 * Drawing a Mermaid fence (v0.3). `mermaid` is a large library, so it is imported here and nowhere
 * else, and only when an answer actually holds a ```mermaid fence (a dynamic import: webpack makes
 * it its own async chunks, the reader route's first-load JS does not grow). It is initialised for
 * every draw with the figure's own theme variables, `securityLevel: 'strict'` (labels sanitised,
 * no click handlers, no HTML passthrough) and `startOnLoad: false` (nothing scans the page), parsed
 * first, and drawn one at a time because Mermaid's configuration is global. A fence that does not
 * parse, or throws while drawing, comes back as `{ ok: false }` and the caller draws nothing.
 *
 * The SVG Mermaid returns carries its own `<style>`, scoped to the svg's id (`#pt-mmd-1 .node …`),
 * so it cannot restyle the page; the id is unique per draw.
 */
import { themeVariables, tokensKey, type FigureTokens } from './theme';

/** The result of one draw. */
export type MermaidResult =
  | { readonly ok: true; readonly svg: string; readonly width: number; readonly height: number }
  | { readonly ok: false };

/** Mermaid's public API, as far as this module uses it. */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  parse(text: string, options: { suppressErrors: true }): Promise<unknown>;
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** Limits Mermaid enforces itself, a second line behind the agent's (services/agent/src/mermaid.ts). */
const MAX_TEXT = 3000;
const MAX_EDGES = 60;

let loader: Promise<MermaidApi> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let counter = 0;
const cache = new Map<string, MermaidResult>();
const CACHE_MAX = 32;

/**
 * Mermaid, loaded on first use.
 *
 * @returns The library (the same promise every time).
 */
export function loadMermaid(): Promise<MermaidApi> {
  loader ??= import('mermaid').then((m) => m.default as unknown as MermaidApi);
  return loader;
}

/** For tests: forget the loaded library, the queue and the cache. */
export function resetMermaid(): void {
  loader = null;
  chain = Promise.resolve();
  cache.clear();
  counter = 0;
}

/**
 * The config handed to `mermaid.initialize` for a figure.
 *
 * @param tokens The figure's tokens.
 * @returns The configuration.
 */
export function mermaidConfig(tokens: FigureTokens): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(tokens),
    fontFamily: tokens.font,
    logLevel: 'fatal',
    suppressErrorRendering: true,
    maxTextSize: MAX_TEXT,
    maxEdges: MAX_EDGES,
    // A fence's own `%%{init}%%` can change none of these (the agent refuses the directive anyway).
    secure: [
      'secure',
      'securityLevel',
      'startOnLoad',
      'maxTextSize',
      'maxEdges',
      'theme',
      'themeVariables',
      'fontFamily',
    ],
    flowchart: { useMaxWidth: true, htmlLabels: true, nodeSpacing: 36, rankSpacing: 40 },
    sequence: { useMaxWidth: true },
    state: { useMaxWidth: true },
    class: { useMaxWidth: true },
    er: { useMaxWidth: true },
    timeline: { useMaxWidth: true },
    mindmap: { useMaxWidth: true },
    quadrantChart: { useMaxWidth: true },
    xyChart: { useMaxWidth: true },
  };
}

/**
 * The drawn size from the svg's viewBox (its natural size), or zeros.
 *
 * @param svg Mermaid's svg markup.
 * @returns The width and height in px.
 */
function naturalSize(svg: string): { width: number; height: number } {
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  return { width: Math.ceil(Number(box?.[1] ?? 0)), height: Math.ceil(Number(box?.[2] ?? 0)) };
}

/**
 * Draw a fence in a theme. Results are cached by text and theme, so a remounted answer, or a
 * level switched back to, does not draw again.
 *
 * @param body The text between the fences.
 * @param tokens The figure's tokens (the theme).
 * @returns The svg and its natural size, or `{ ok: false }`.
 */
export function renderMermaid(body: string, tokens: FigureTokens): Promise<MermaidResult> {
  const key = `${tokensKey(tokens)}\n${body}`;
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const run = chain.then(async (): Promise<MermaidResult> => {
    const id = `pt-mmd-${String((counter += 1))}`;
    try {
      const mermaid = await loadMermaid();
      mermaid.initialize(mermaidConfig(tokens));
      // `false` (not a throw) for text that does not parse: never draw it, never show it.
      if ((await mermaid.parse(body, { suppressErrors: true })) === false) return { ok: false };
      const { svg } = await mermaid.render(id, body);
      if (!/^\s*<svg[\s>]/i.test(svg)) return { ok: false };
      return { ok: true, svg, ...naturalSize(svg) };
    } catch {
      return { ok: false };
    } finally {
      // Mermaid measures in a temporary node it normally removes; make sure a failure left none.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  });
  chain = run.catch(() => undefined);
  return run.then((result) => {
    // Only a drawing is remembered: a failure may be a chunk that did not load, and may succeed later.
    if (!result.ok) return result;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, result);
    return result;
  });
}
