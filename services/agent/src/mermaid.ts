/**
 * The ```mermaid fence of an explain / ask answer, checked before it reaches `done.final_text`
 * (v0.3 #339 follow-up: Mermaid diagrams). The model chooses the diagram type; this decides whether
 * the text is safe and plausible enough to store, and never repairs more than cosmetics:
 *
 *   type     the first line is one of the allowed Mermaid diagram keywords (and nothing before it:
 *            no front matter, which could carry a `config:` block)
 *   refused  `%%{` directives (init), `click`, `href`, `javascript:`, raw HTML tags, `<script`,
 *            a line that is a link/callback statement, an odd number of double quotes on a line
 *   caps     lines, characters, and the length of one line
 *   dropped  `style`, `classDef`, `linkStyle` lines and `:::class` suffixes: the app themes the
 *            figure, a colour the model picked would fight it (a cosmetic line is cut, not the fence)
 *
 * A real parse is NOT done here: it needs a DOM, so it runs in a worker thread (mermaid-parse.ts)
 * and is orchestrated, with the repairs and the size caps, by figure.ts. This file is the cheap,
 * synchronous, safety-first check that runs before it.
 */

/** The diagram types the prompt offers (plus `graph`, the older name of a flowchart). */
export const MERMAID_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'stateDiagram-v2',
  'mindmap',
  'timeline',
  'quadrantChart',
  'xychart-beta',
  'classDiagram',
  'erDiagram',
] as const;

/** Most lines a fence may have (a 15-node flowchart with subgraphs is about 30). */
export const MERMAID_MAX_LINES = 60;
/** Most characters in a fence. */
export const MERMAID_MAX_CHARS = 3000;
/** Longest single line. */
export const MERMAID_MAX_LINE = 200;

/** `flowchart`, `flowchart LR`, `graph TD`, `sequenceDiagram`: the keyword, then end or a space. */
const HEADER = new RegExp(`^(?:${MERMAID_TYPES.join('|')})(?:[ \\t].*)?$`);
/** What may follow `flowchart` / `graph` on the header line: a direction, nothing else. */
const FLOW_HEADER = /^(?:flowchart|graph)(?:[ \t]+(?:TB|TD|BT|RL|LR))?[ \t]*$/;

/** A line that is cosmetic styling: cut, the figure is themed by the app. */
const STYLE_LINE = /^\s*(?:style|classDef|linkStyle)\b/i;
/** A flowchart `class A,B name` line: cosmetic there (in a classDiagram `class` declares a class). */
const FLOW_CLASS_LINE = /^\s*class\s+[\w,-]+\s+[\w-]+\s*;?\s*$/;
const CLASS_SUFFIX = /:::[\w-]+/g;

/** Statements and substrings that make a fence unsafe: the whole fence goes. */
const REFUSED: readonly RegExp[] = [
  /%%\{/, // init / config directive
  /(?:^|;)\s*click\b/im, // click handlers and links
  /^\s*(?:links?|callback)\s+[^\n:]+:/im, // sequenceDiagram `link Actor: Label @ url`
  /\bhref\s*[=:]/i,
  /javascript\s*:/i,
  /\bon(?:click|error|load|mouse\w*|focus|key\w*)\s*=/i,
  /<\s*\/?\s*(?:script|iframe|object|embed|foreignobject)\b/i,
  /&#?\w+;/, // an entity can smuggle a tag past a naive check
];

/** Any `<tag ...>` left once the UML-style `<<annotation>>` and the `<|--` arrows are removed. */
const HTML_TAG = /<\/?[A-Za-z!][^>\n]*>/;

/**
 * The fence's body as it may be stored, or null when it must not be.
 *
 * @param body - The text between the ```mermaid fences.
 * @returns The body with cosmetic lines cut, trimmed, or null for an unsafe, unknown or oversized fence.
 * @example
 * cleanMermaidFence('flowchart LR\n  a["Query"] --> b["Results"]'); // the same text
 * cleanMermaidFence('flowchart LR\n  click a "https://x"'); // null
 */
export function cleanMermaidFence(body: string): string | null {
  const text = body.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').trim();
  if (text === '' || text.length > MERMAID_MAX_CHARS) return null;
  const raw = text.split('\n');
  if (raw.length > MERMAID_MAX_LINES) return null;
  if (raw.some((line) => line.length > MERMAID_MAX_LINE)) return null;
  for (const pattern of REFUSED) if (pattern.test(text)) return null;
  const withoutAnnotations = text.replace(/<<[A-Za-z ]+>>/g, '').replace(/<\|/g, '');
  if (HTML_TAG.test(withoutAnnotations)) return null;
  // The first line names the type; a `%%` comment may come before it, front matter (`---`) may not.
  const lines = raw.map((line) => line.replace(/\s+$/, ''));
  const first = lines.findIndex((line) => line.trim() !== '' && !/^\s*%%(?!\{)/.test(line));
  if (first === -1) return null;
  const header = (lines[first] ?? '').trim();
  if (!HEADER.test(header)) return null;
  const type = header.split(/[ \t]/)[0] ?? '';
  const flow = type === 'flowchart' || type === 'graph';
  if (flow && !FLOW_HEADER.test(header)) return null;
  const kept: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i < first) continue; // comments above the header are not kept
    if (i > first && (STYLE_LINE.test(line) || (flow && FLOW_CLASS_LINE.test(line)))) continue;
    const plain = i > first ? line.replace(CLASS_SUFFIX, '') : line;
    // An odd number of double quotes is a label that never closes: Mermaid cannot read it.
    if ((plain.match(/"/g) ?? []).length % 2 === 1) return null;
    kept.push(plain);
  }
  // A header and fewer than two more lines is not a figure (mindmap/timeline need a few lines too).
  const content = kept.slice(1).filter((line) => line.trim() !== '' && !/^\s*%%/.test(line));
  if (content.length < 2) return null;
  return kept.join('\n').trim();
}

/** The diagram keyword a (clean) body opens with, for a placeholder or a test. */
export function mermaidTypeOf(body: string): string | null {
  const line = body.split('\n').find((l) => l.trim() !== '' && !/^\s*%%/.test(l));
  const word = (line ?? '').trim().split(/[ \t]/)[0] ?? '';
  return (MERMAID_TYPES as readonly string[]).includes(word) ? word : null;
}
