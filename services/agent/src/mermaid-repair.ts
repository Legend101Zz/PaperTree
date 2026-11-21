/**
 * What the agent can do to a Mermaid fence without asking the model (v0.3 W6; evidence: the 91
 * real fences of the 2026-11-20 round, 4 of which did not render):
 *
 *   tidyMermaidText   cosmetic and always on, before the safety check: `<br>` becomes a space (the
 *                     safety check refuses raw HTML, and a `<br>` in a mindmap root made two roots),
 *                     literal quotes leave a `title` (they were drawn), and a wide `flowchart LR`
 *                     of more than four nodes becomes `flowchart TD` (28 of 91 were too wide to read);
 *                     literal quotes leave mindmap nodes, timeline text and state labels (those
 *                     types DRAW the quotes), and quadrant points are moved off the quadrant titles
 *                     and off each other (see `tidyQuadrantPoints`)
 *   repairMermaid     structural, run only once the real parse has failed: two flowchart statements
 *                     on one line are split, node text holding ()[]{} is quoted where the type reads
 *                     those as shape syntax (flowchart; a mindmap node becomes `id("text")`, never
 *                     a quoted bare node), a mindmap whose second line is not
 *                     indented under the root is indented under it
 *   figureLimits      the size caps the prompt states (nodes, participants, periods, points,
 *                     depth), counted here: an over-cap figure is treated as a parse failure
 *
 * Every function is pure text in, text out; `figure.ts` decides the order and what is kept.
 */
import { mermaidTypeOf } from './mermaid.ts';

/**
 * What `INLINE_DIAGRAM` (prompts.ts) asks the model for: the guidance, unchanged. A test keeps the
 * prompt in step with this.
 */
export const FIGURE_ASK = {
  flowNodes: 12,
  mindmapNodes: 12,
  mindmapDepth: 3,
  participants: 4,
  messages: 10,
  periods: 6,
  eventsPerPeriod: 2,
  quadrantPoints: 6,
  chartPoints: 8,
  /** A flowchart of at most this many nodes may stay left-to-right. */
  rowNodes: 4,
} as const;

/**
 * The SOFT readability caps (v0.3 W6 round 3). A parseable diagram is not an error: the web scales
 * it to a readable minimum and scrolls it. Over a cap a fence is sent to ONE model "simplify"
 * request, and when that fails or times out the original is KEPT (path `kept-over-cap`); only a
 * fence that does not parse after every repair is dropped. Round 2 had good diagrams above the
 * asked sizes (flowcharts to ~16 nodes, 3 events in a timeline period, mindmaps to ~16 nodes), so
 * those caps sit a little above what the prompt asks.
 */
export const FIGURE_CAPS = {
  ...FIGURE_ASK,
  flowNodes: 16,
  mindmapNodes: 16,
  eventsPerPeriod: 3,
} as const;

export interface Repaired {
  readonly body: string;
  /** Short names of what was changed, in order (empty: the body is unchanged). */
  readonly applied: readonly string[];
}

const BR = /\s*<\s*br\s*\/?\s*>\s*/gi;
const TITLE = /^(\s*title\s+)(.*)$/;

function isFlow(type: string | null): boolean {
  return type === 'flowchart' || type === 'graph';
}

function headerIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => line.trim() !== '' && !/^\s*%%/.test(line));
}

/** Cosmetic changes that are always right. */
export function tidyMermaidText(body: string): Repaired {
  const applied: string[] = [];
  const type = mermaidTypeOf(body);
  let text = body;
  if (BR.test(text)) {
    text = text.replace(BR, ' ');
    applied.push('drop-br');
  }
  BR.lastIndex = 0;
  const lines = text.split('\n');
  if (type !== null && type !== 'xychart-beta') {
    let changed = false;
    for (const [i, line] of lines.entries()) {
      const m = TITLE.exec(line);
      if (m === null || !/["`]/.test(m[2] ?? '')) continue;
      lines[i] = `${m[1]}${(m[2] ?? '').replace(/["`]/g, '').trim()}`;
      changed = true;
    }
    if (changed) applied.push('title-quotes');
  }
  text = lines.join('\n');
  if (type === 'mindmap') {
    const next = mindmapUnquote(lines);
    if (next !== null) {
      lines.splice(0, lines.length, ...next);
      text = lines.join('\n');
      applied.push('mindmap-unquote');
    }
  } else if (type === 'timeline' || type === 'stateDiagram' || type === 'stateDiagram-v2') {
    const name = type === 'timeline' ? 'timeline-quotes' : 'state-quotes';
    const next = type === 'timeline' ? timelineUnquote(lines) : stateUnquote(lines);
    if (next !== null) {
      lines.splice(0, lines.length, ...next);
      text = lines.join('\n');
      applied.push(name);
    }
  } else if (type === 'quadrantChart') {
    const next = tidyQuadrantPoints(lines);
    if (next.moved > 0) {
      lines.splice(0, lines.length, ...next.lines);
      text = lines.join('\n');
      applied.push('quadrant-spread');
    }
  }
  if (isFlow(type)) {
    const first = headerIndex(lines);
    const header = (lines[first] ?? '').trim();
    const wide = /^(flowchart|graph)\s+(LR|RL)$/.exec(header);
    if (wide !== null && flowNodeIds(lines.slice(first + 1)).size > FIGURE_ASK.rowNodes) {
      lines[first] = `${wide[1]} TD`;
      text = lines.join('\n');
      applied.push('flow-td');
    }
  }
  return { body: text, applied };
}

// ---- flowchart ---------------------------------------------------------------------------------

const FLOW_SKIP = /^\s*(?:subgraph\b|end\b|direction\b|classDef\b|class\b|style\b|linkStyle\b|%%)/;

/** Remove quoted strings and the contents of ()[]{} (nested), leaving the ids and arrows. */
function skeleton(line: string): string {
  let out = line.replace(/"[^"]*"/g, '""');
  for (let guard = 0; guard < 20; guard++) {
    const next = out.replace(/\[[^[\]]*\]|\([^()]*\)|\{[^{}]*\}/g, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** The distinct node ids a flowchart's body lines use. */
export function flowNodeIds(lines: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.trim() === '' || FLOW_SKIP.test(line)) continue;
    const flat = skeleton(line)
      .replace(/\|[^|]*\|/g, ' ')
      .replace(/(?:--|==)\s[^->=]*?\s?(?:-->|==>|---)/g, ' --> ');
    for (const part of flat.split(/-{2,}[>ox]?|={2,}>?|-\.+->?|~~~|&|;/)) {
      const id = part.trim();
      if (/^[A-Za-z_][\w-]*$/.test(id)) ids.add(id);
    }
  }
  return ids;
}

/** The index just past a balanced ()[]{} group that starts at `from` (which holds the opener). */
function skipGroup(line: string, from: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  let quoted = false;
  for (let i = from; i < line.length; i++) {
    const ch = line[i] ?? '';
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch in pairs) stack.push(pairs[ch] ?? '');
    else if (stack.length > 0 && ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return line.length;
}

const ARROW_AHEAD = /^\s*(?:-{2,}|={2,}|-\.|~~~|&)/;

/** `a --> b  c --> d` becomes two lines; also `end  a --> b`. Quotes and brackets are respected. */
function splitStatements(line: string): string[] {
  const indent = /^\s*/.exec(line)?.[0] ?? '';
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? '';
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === '[' || ch === '(' || ch === '{') {
      i = skipGroup(line, i) - 1;
      continue;
    }
    if (!/\s/.test(ch) || /\s/.test(line[i - 1] ?? 'x')) continue;
    // `ch` starts a whitespace run
    let end = i;
    while (/\s/.test(line[end] ?? '')) end++;
    const before = line.slice(start, i);
    const afterEnd = line.slice(end);
    if (!/[\w\])}"]$/.test(before)) continue;
    const long = end - i >= 2 || /(?:^|\s)end$/.test(before);
    if (!long) continue;
    const next = /^[A-Za-z_][\w-]*/.exec(afterEnd);
    if (next === null) continue;
    let after = next[0].length;
    const open = afterEnd[after];
    if (open === '[' || open === '(' || open === '{') after = skipGroup(afterEnd, after) - 0;
    if (!ARROW_AHEAD.test(afterEnd.slice(after)) && !/^\s*$/.test(afterEnd.slice(after))) continue;
    parts.push(line.slice(start, i));
    start = end;
    i = end - 1;
  }
  parts.push(line.slice(start));
  return parts.map((part, k) => (k === 0 ? part : indent + part.trimStart()));
}

const FLOW_OPENERS: ReadonlyArray<readonly [string, string]> = [
  ['(((', ')))'],
  ['([', '])'],
  ['[(', ')]'],
  ['[[', ']]'],
  ['((', '))'],
  ['{{', '}}'],
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
];
const AFTER_NODE = /^\s*(?:$|[;&]|-{2,}|={2,}|-\.|~~~)/;

/** `A[Learn F(x)]` becomes `A["Learn F(x)"]` (a node whose unquoted text holds ()[]{}). */
function quoteNodeText(line: string): string {
  if (FLOW_SKIP.test(line) && !/^\s*subgraph\b/.test(line)) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const id = /^[A-Za-z_][\w-]*/.exec(rest);
    const boundary = i === 0 || !/[\w-]/.test(line[i - 1] ?? '');
    if (id === null || !boundary) {
      const quote = /^"[^"]*"/.exec(rest);
      const step = quote === null ? 1 : quote[0].length;
      out += rest.slice(0, step);
      i += step;
      continue;
    }
    const after = rest.slice(id[0].length);
    const pair = FLOW_OPENERS.find(([open]) => after.startsWith(open));
    const next = after[pair?.[0].length ?? 0] ?? '';
    if (pair === undefined || next === '"' || next === '`' || next === '/' || next === '\\') {
      out += id[0];
      i += id[0].length;
      continue;
    }
    const [open, close] = pair;
    const textStart = id[0].length + open.length;
    let found = -1;
    for (let k = rest.indexOf(close, textStart); k !== -1; k = rest.indexOf(close, k + 1)) {
      if (AFTER_NODE.test(rest.slice(k + close.length))) {
        found = k;
        break;
      }
    }
    if (found === -1) {
      out += id[0];
      i += id[0].length;
      continue;
    }
    const inner = rest.slice(textStart, found);
    out +=
      /[()[\]{}]/.test(inner) && !inner.includes('"')
        ? `${id[0]}${open}"${inner}"${close}`
        : rest.slice(0, found + close.length);
    i += found + close.length;
  }
  return out;
}

// ---- mindmap -----------------------------------------------------------------------------------

const SHAPED =
  /^[^\s()[\]{}"]*(?:\(\(\(|\(\(|\(|\[\[|\[|\{\{|\{|\)\)|\))"[^"]*"(?:\)\)\)|\)\)|\)|\]\]|\]|\}\}|\}|\(\(|\()$/;
const SHAPED_PLAIN =
  /^[\w-]+(?:\(\(|\[\[|\(|\[|\{\{|\{|\)\)|\))[^"()[\]{}]*(?:\)\)|\]\]|\)|\]|\}\}|\()$/;

/** A node that is only its id and ONE quoted shape (the id may hold spaces, as `Core idea["…"]`). */
const QUOTED_SHAPE =
  /^[^"]*(?:\(\(\(|\(\(|\(|\[\[|\[|\{\{|\{|\)\)|\))"[^"]*"(?:\)\)\)|\)\)|\)|\]\]|\]|\}\}|\}|\(\(|\()$/;

function indentOf(line: string): number {
  return (/^ */.exec(line)?.[0] ?? '').length;
}

function isMindmapNode(line: string): boolean {
  const t = line.trim();
  return t !== '' && !t.startsWith('%%') && !t.startsWith('::');
}

/**
 * A mindmap node whose text holds ()[]{} is written `nId("text")`: the parser reads the quoted
 * text of a shape as the label WITHOUT the quotes (checked on mermaid 12.2.0: descr is `Learn
 * F(x) = H(x) - x`, type rounded-rect), whereas a bare `"text"` node, or an `id["…"]` repaired
 * to a bare one, keeps the quotes as characters of the label. Plain text needs no wrapper.
 */
function safeMindmapText(text: string, id: string): string {
  const plain = text.replace(/"/g, "'").trim();
  return /[()[\]{}]/.test(plain) ? `${id}("${plain}")` : plain;
}

/** Literal quotes out of mindmap nodes (a bare `"text"`, or a quote inside plain text). */
function mindmapUnquote(lines: readonly string[]): string[] | null {
  const first = headerIndex([...lines]);
  const out = [...lines];
  let changed = false;
  for (const [i, line] of lines.entries()) {
    if (i <= first || !isMindmapNode(line) || !/["]/.test(line)) continue;
    const text = line.trim();
    if (QUOTED_SHAPE.test(text)) {
      // `id["text"]`: the quotes are syntax. Only a label we wrapped in apostrophes ourselves
      // (`id["'text'"]`, the old repair) loses them.
      const wrapped = /"'([^"']*)'"/.exec(line);
      if (wrapped !== null) {
        out[i] = line.replace(wrapped[0], `"${wrapped[1] ?? ''}"`);
        changed = true;
      }
      continue;
    }
    const indent = /^ */.exec(line)?.[0] ?? '';
    out[i] = indent + safeMindmapText(text.replace(/"/g, ''), `n${String(i)}`);
    changed = true;
  }
  return changed ? out : null;
}

/** Timeline text is drawn as written, so quotes (and backticks) in it would be drawn too. */
function timelineUnquote(lines: readonly string[]): string[] | null {
  const first = headerIndex([...lines]);
  let changed = false;
  const out = lines.map((line, i) => {
    if (i <= first || /^\s*%%/.test(line) || !/["`]/.test(line)) return line;
    changed = true;
    return line.replace(/["`]/g, '');
  });
  return changed ? out : null;
}

/** A state transition label (`A --> B : "go"`) or note text is drawn with its quotes. */
function stateUnquote(lines: readonly string[]): string[] | null {
  const first = headerIndex([...lines]);
  let changed = false;
  const out = lines.map((line, i) => {
    if (i <= first || !line.includes('"')) return line;
    const m = /^(\s*(?:note\b[^:]*|[^:"]*-->[^:"]*)):(.*)$/.exec(line);
    if (m === null || !(m[2] ?? '').includes('"')) return line;
    changed = true;
    return `${m[1] ?? ''}:${(m[2] ?? '').replace(/"/g, '')}`;
  });
  return changed ? out : null;
}

// ---- quadrant points ---------------------------------------------------------------------------

/** The band under y = 0.5 where the lower quadrants' titles are drawn (0.40 to 0.52). */
const TITLE_BAND = { low: 0.4, high: 0.52 } as const;
/** Points above this meet the upper quadrants' titles (they sit near y = 0.95 to 1). */
const TOP_LIMIT = 0.85;
const EDGE = 0.05;
/** Two labels closer than this on BOTH axes overprint. */
const MIN_GAP = 0.07;

const POINT =
  /^(\s*)(?!(?:title|x-axis|y-axis|quadrant-[\w-]+)\b)(.+?)(\s*:\s*)\[\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\](\s*)$/;

const inBand = (y: number): boolean => y >= TITLE_BAND.low - 1e-9 && y <= TITLE_BAND.high + 1e-9;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Quadrant titles are drawn at the top of each quadrant, so a point there is printed over the
 * title (25 of 85 round-1 to 3 points did). Always on: a point's y leaves 0.40 to 0.52 for 0.36
 * or 0.56 (the nearer) and 0.88 and up for 0.85, x stays within 0.05 to 0.95; then points closer
 * than 0.07 on both axes are pushed apart vertically (nearest free y, never back into a band).
 * `moved` counts the points whose written position changed. Lines it cannot read are untouched.
 */
export function tidyQuadrantPoints(lines: readonly string[]): {
  lines: string[];
  moved: number;
} {
  const out = [...lines];
  const placed: Array<{ x: number; y: number }> = [];
  let moved = 0;
  const free = (x: number, y: number): boolean =>
    y >= EDGE - 1e-9 &&
    y <= TOP_LIMIT + 1e-9 &&
    !inBand(y) &&
    placed.every((p) => Math.abs(p.x - x) >= MIN_GAP - 1e-9 || Math.abs(p.y - y) >= MIN_GAP - 1e-9);
  for (const [i, line] of lines.entries()) {
    const m = POINT.exec(line);
    if (m === null) continue;
    const x0 = Number(m[4]);
    const y0 = Number(m[5]);
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
    const x = round2(clamp(x0, EDGE, 1 - EDGE));
    let y = y0;
    if (inBand(y)) y = Math.abs(y - 0.36) <= Math.abs(y - 0.56) ? 0.36 : 0.56;
    y = round2(clamp(y, EDGE, TOP_LIMIT));
    if (!free(x, y)) {
      let best = y;
      for (let step = 1; step <= 80; step++) {
        const up = round2(y + step / 100);
        const down = round2(y - step / 100);
        if (free(x, up)) {
          best = up;
          break;
        }
        if (free(x, down)) {
          best = down;
          break;
        }
      }
      y = best;
    }
    placed.push({ x, y });
    if (Math.abs(x - x0) > 1e-9 || Math.abs(y - y0) > 1e-9) {
      out[i] =
        `${m[1] ?? ''}${m[2] ?? ''}${m[3] ?? ''}[${x.toFixed(2)}, ${y.toFixed(2)}]${m[6] ?? ''}`;
      moved++;
    }
  }
  return { lines: out, moved };
}

function mindmapRepair(lines: string[], applied: string[]): string[] {
  const first = headerIndex(lines);
  const out = [...lines];
  const nodes = out
    .map((line, i) => (i > first && isMindmapNode(line) ? i : -1))
    .filter((i) => i >= 0);
  const rootAt = nodes[0];
  if (rootAt === undefined) return out;
  const rootIndent = indentOf(out[rootAt] ?? '');
  let reindented = false;
  for (const i of nodes.slice(1)) {
    const line = out[i] ?? '';
    if (indentOf(line) <= rootIndent) {
      out[i] = `${' '.repeat(rootIndent + 2)}${line.trim()}`;
      reindented = true;
    }
  }
  if (reindented) applied.push('mindmap-one-root');
  let quoted = false;
  for (const i of nodes.slice(1)) {
    const line = out[i] ?? '';
    const text = line.trim();
    if (!/[()[\]{}]/.test(text) || SHAPED.test(text) || SHAPED_PLAIN.test(text)) continue;
    const indent = /^ */.exec(line)?.[0] ?? '';
    out[i] = indent + safeMindmapText(text, `n${String(i)}`);
    quoted = true;
  }
  if (quoted) applied.push('mindmap-quote-text');
  return out;
}

/** Structural repairs for a fence the parser refused; unchanged `applied: []` when nothing fits. */
export function repairMermaid(body: string): Repaired {
  const applied: string[] = [];
  const type = mermaidTypeOf(body);
  let lines = body.split('\n');
  if (isFlow(type)) {
    const first = headerIndex(lines);
    const next: string[] = [];
    let split = false;
    let quoted = false;
    for (const [i, line] of lines.entries()) {
      if (i <= first) {
        next.push(line);
        continue;
      }
      for (const part of splitStatements(line)) {
        if (part !== line) split = true;
        const fixed = quoteNodeText(part);
        if (fixed !== part) quoted = true;
        next.push(fixed);
      }
    }
    lines = next;
    if (split) applied.push('flow-split-statements');
    if (quoted) applied.push('flow-quote-text');
  } else if (type === 'mindmap') {
    lines = mindmapRepair(lines, applied);
  }
  return { body: lines.join('\n'), applied };
}

// ---- caps --------------------------------------------------------------------------------------

function mindmapShape(lines: readonly string[]): { nodes: number; depth: number; roots: number } {
  const first = headerIndex([...lines]);
  const nodes = lines.filter((line, i) => i > first && isMindmapNode(line));
  const rootIndent = indentOf(nodes[0] ?? '');
  const stack: number[] = [];
  let depth = 0;
  let roots = 0;
  for (const line of nodes) {
    const indent = indentOf(line);
    if (indent <= rootIndent) roots++;
    while (stack.length > 0 && (stack[stack.length - 1] ?? 0) >= indent) stack.pop();
    stack.push(indent);
    depth = Math.max(depth, stack.length - 1);
  }
  return { nodes: nodes.length, depth, roots };
}

const MESSAGE = /^\s*([^\s:]+?)\s*(?:-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*([^\s:]+?)\s*:/;

/** What breaks the caps of this fence, in words a repair request can quote. Empty: within caps. */
export function figureLimits(body: string): string[] {
  const type = mermaidTypeOf(body);
  const lines = body.split('\n');
  const first = headerIndex(lines);
  const rest = lines.slice(first + 1);
  const found: string[] = [];
  if (isFlow(type)) {
    const n = flowNodeIds(rest).size;
    if (n > FIGURE_CAPS.flowNodes)
      found.push(`${n} nodes; at most ${FIGURE_CAPS.flowNodes}: merge or drop the least important`);
  } else if (type === 'mindmap') {
    const s = mindmapShape(lines);
    if (s.nodes > FIGURE_CAPS.mindmapNodes)
      found.push(`${s.nodes} nodes; at most ${FIGURE_CAPS.mindmapNodes}`);
    if (s.depth > FIGURE_CAPS.mindmapDepth)
      found.push(`${s.depth} levels below the root; at most ${FIGURE_CAPS.mindmapDepth}`);
  } else if (type === 'sequenceDiagram') {
    const who = new Set<string>();
    let messages = 0;
    for (const line of rest) {
      const declared = /^\s*(?:participant|actor)\s+(.+?)(?:\s+as\s+.+)?\s*$/.exec(line);
      if (declared !== null) who.add((declared[1] ?? '').trim());
      const m = MESSAGE.exec(line);
      if (m !== null) {
        messages++;
        who.add(m[1] ?? '');
        who.add(m[2] ?? '');
      }
    }
    if (who.size > FIGURE_CAPS.participants)
      found.push(`${who.size} participants; at most ${FIGURE_CAPS.participants}`);
    if (messages > FIGURE_CAPS.messages)
      found.push(`${messages} messages; at most ${FIGURE_CAPS.messages}`);
  } else if (type === 'timeline') {
    let periods = 0;
    let events = 0;
    let most = 0;
    for (const line of rest) {
      const t = line.trim();
      if (t === '' || /^(?:title|section)\b/.test(t) || t.startsWith('%%')) continue;
      if (t.startsWith(':')) events += t.split(':').filter((p) => p.trim() !== '').length;
      else {
        periods++;
        events = t
          .split(':')
          .slice(1)
          .filter((p) => p.trim() !== '').length;
      }
      most = Math.max(most, events);
    }
    if (periods > FIGURE_CAPS.periods)
      found.push(`${periods} periods; at most ${FIGURE_CAPS.periods} (or draw a flowchart TD)`);
    if (most > FIGURE_CAPS.eventsPerPeriod)
      found.push(`${most} events in one period; at most ${FIGURE_CAPS.eventsPerPeriod}`);
  } else if (type === 'quadrantChart') {
    const points = rest.filter((l) => /^\s*[^:]+:\s*\[\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\]\s*$/.test(l));
    if (points.length > FIGURE_CAPS.quadrantPoints)
      found.push(`${points.length} points; at most ${FIGURE_CAPS.quadrantPoints}`);
  } else if (type === 'xychart-beta') {
    let most = 0;
    for (const line of rest) {
      const m = /^\s*(?:bar|line|x-axis[^[\n]*)\s*\[([^\]]*)\]/.exec(line);
      if (m !== null) most = Math.max(most, (m[1] ?? '').split(',').length);
    }
    if (most > FIGURE_CAPS.chartPoints)
      found.push(`${most} points; at most ${FIGURE_CAPS.chartPoints}`);
  }
  return found;
}
