/**
 * The figure inside an answer (v0.3 answer format §1): a ```diagram fence holds the same NDJSON
 * lines the diagram run kind emits (`services/agent/src/diagram.ts`: `plate`, `part`, `link`,
 * `end`), and this turns them into the parts and links the plate drawing already draws.
 *
 * It is the web's tolerant twin of the agent's `PlateReader`. The agent has already dropped lines
 * it could not read before the answer is final, so this keeps the rule simple: a line that does
 * not parse, or does not fit, costs that line and nothing else, and a fence with no part is no
 * figure at all (the caller draws nothing: raw NDJSON never reaches the screen).
 *
 * Letters are A–L in the order the part lines arrive. An `after` or `link` letter that does not
 * name an earlier part is dropped, so the graph stays acyclic and the layout's rules hold.
 */
import { LETTERS } from './layout';

import type { DiagramLink, DiagramPart } from '@/lib/api/types';

/** The figure a fence draws. */
export interface InlineFigure {
  readonly title: string | null;
  readonly parts: readonly DiagramPart[];
  readonly links: readonly DiagramLink[];
}

/** The agent's own cap: more parts than this are left out. */
const MAX_PARTS = 12;
const MAX_LINKS = 20;
const KINDS = new Set<DiagramPart['kind']>(['input', 'step', 'output', 'concept']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const letterOf = (value: unknown): string =>
  typeof value === 'string' && value.length === 1 && LETTERS.includes(value) ? value : '';

/**
 * The figure a diagram fence holds.
 *
 * @param body The text between the fences: one JSON object per line.
 * @returns The figure, or null when no part could be read (nothing to draw).
 * @example
 * parseDiagramFence('{"t":"part","label":"Input","kind":"input","after":[],"cite":null}');
 * // { title: null, parts: [{ letter: 'A', label: 'Input', … }], links: [] }
 */
export function parseDiagramFence(body: string): InlineFigure | null {
  let title: string | null = null;
  const parts: DiagramPart[] = [];
  const links: DiagramLink[] = [];
  // The model's letter for a part is its place among the part lines it wrote, readable or not.
  let written = 0;
  const placed = new Map<string, string>();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      if (/"t"\s*:\s*"part"/.test(line)) written += 1;
      continue;
    }
    if (!isRecord(json)) continue;
    if (json['t'] === 'end') break;
    if (json['t'] === 'plate') {
      if (title === null && text(json['title']) !== '') title = text(json['title']);
    } else if (json['t'] === 'part') {
      const index = written;
      written += 1;
      const label = text(json['label']);
      if (label === '' || parts.length >= MAX_PARTS) continue;
      const letter = LETTERS.charAt(parts.length);
      const after: string[] = [];
      const edge: (string | null)[] = [];
      const wrote = Array.isArray(json['after']) ? (json['after'] as unknown[]) : [];
      const labels = Array.isArray(json['edge']) ? (json['edge'] as unknown[]) : [];
      wrote.forEach((from, i) => {
        const model = letterOf(from);
        const mapped = placed.get(model);
        // Only an earlier part that was drawn: never the part itself, never one still to come.
        if (mapped === undefined || LETTERS.indexOf(model) >= index || after.includes(mapped)) {
          return;
        }
        after.push(mapped);
        edge.push(text(labels[i]) === '' ? null : text(labels[i]));
      });
      const kind = json['kind'];
      parts.push({
        letter,
        label,
        text: text(json['text']),
        kind:
          typeof kind === 'string' && KINDS.has(kind as DiagramPart['kind'])
            ? (kind as DiagramPart['kind'])
            : 'step',
        after,
        edge,
        // The figure inside an answer carries no passage of its own: the paragraph's source line
        // is where the paper is named.
        cite: null,
      });
      if (LETTERS.charAt(index) !== '') placed.set(LETTERS.charAt(index), letter);
    } else if (json['t'] === 'link' && links.length < MAX_LINKS) {
      const from = placed.get(letterOf(json['from']));
      const to = placed.get(letterOf(json['to']));
      if (from === undefined || to === undefined || from === to) continue;
      const label = text(json['label']);
      links.push({ source: from, target: to, label: label === '' ? null : label });
    }
  }
  return parts.length === 0 ? null : { title, parts, links };
}
