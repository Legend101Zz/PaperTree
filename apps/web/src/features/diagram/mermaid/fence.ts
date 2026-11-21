/**
 * What the web needs to know of a ```mermaid fence without Mermaid: the diagram's type (the first
 * word) and the first few labels it names, for the figure's accessible name. Pure and tolerant:
 * the agent has already checked the fence (services/agent/src/mermaid.ts), and Mermaid's own parser
 * decides in the browser whether it draws, so this only reads, never judges.
 */

/** The types the answer prompt offers (and `graph`, an older flowchart name). */
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

/** A plain-words name for each type, for the accessible name. */
const TYPE_WORDS: Readonly<Record<string, string>> = {
  flowchart: 'flowchart',
  graph: 'flowchart',
  sequenceDiagram: 'sequence diagram',
  'stateDiagram-v2': 'state diagram',
  mindmap: 'mind map',
  timeline: 'timeline',
  quadrantChart: 'quadrant chart',
  'xychart-beta': 'chart',
  classDiagram: 'class diagram',
  erDiagram: 'entity diagram',
};

const lines = (body: string): string[] =>
  body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('%%'));

/**
 * The diagram type a fence opens with.
 *
 * @param body The text between the fences.
 * @returns The Mermaid keyword, or null when it is not one the prompt offers.
 */
export function mermaidType(body: string): string | null {
  const word = (lines(body)[0] ?? '').split(/\s+/)[0] ?? '';
  return (MERMAID_TYPES as readonly string[]).includes(word) ? word : null;
}

/** The label of a flowchart / class / state node written `id["Label"]`, `id("Label")`, `id[Label]`. */
const NODE_LABEL =
  /[\w-]+\s*(?:\[\[?|\(\(?|\{\{?|>)\s*"?([^"\]){}|\n]+?)"?\s*(?:\]\]?|\)\)?|\}\}?)/g;

/**
 * Up to `max` labels a figure names, in the order they appear.
 *
 * @param body The text between the fences.
 * @param max Most labels to return.
 * @returns Short, de-duplicated labels (no Mermaid syntax).
 */
export function mermaidLabels(body: string, max = 6): string[] {
  const type = mermaidType(body);
  const rows = lines(body).slice(1);
  const found: string[] = [];
  const add = (label: string | undefined): void => {
    const clean = (label ?? '')
      .replace(/[`*_"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean !== '' && clean.length <= 60 && !found.includes(clean)) found.push(clean);
  };
  if (type === 'flowchart' || type === 'graph' || type === 'classDiagram') {
    for (const row of rows) {
      if (/^subgraph\b/.test(row)) add(/"([^"]+)"|\[([^\]]+)\]/.exec(row)?.slice(1).find(Boolean));
      for (const m of row.matchAll(NODE_LABEL)) add(m[1]);
    }
    if (found.length === 0) for (const row of rows) add(/^class\s+(\w+)/.exec(row)?.[1]);
  } else if (type === 'sequenceDiagram') {
    for (const row of rows) {
      const m = /^(?:participant|actor)\s+\S+(?:\s+as\s+(.+))?$/.exec(row);
      if (m !== null) add(m[1] ?? row.split(/\s+/)[1]);
    }
    if (found.length === 0) {
      for (const row of rows)
        for (const m of row.matchAll(/^([\w ]+?)\s*-{1,2}>{1,2}\+?\s*([\w ]+?):/g)) {
          add(m[1]);
          add(m[2]);
        }
    }
  } else if (type === 'stateDiagram-v2') {
    for (const row of rows) {
      for (const m of row.matchAll(/(?:^|\s)([A-Za-z][\w ]*?)\s*-->/g)) add(m[1]);
      for (const m of row.matchAll(/-->\s*([A-Za-z][\w]*)/g)) add(m[1]);
    }
  } else if (type === 'mindmap' || type === 'timeline') {
    for (const row of rows) {
      if (/^title\b/.test(row)) add(row.replace(/^title\s+/, ''));
      else
        add(row.replace(/^[\w-]*(?:\(\(|\[|\()(.+?)(?:\)\)|\]|\))$/, '$1').replace(/^.*?:\s*/, ''));
    }
  } else {
    for (const row of rows) if (/^title\b/.test(row)) add(row.replace(/^title\s+/, ''));
  }
  return found.slice(0, max);
}

/**
 * The figure's accessible name: its type in words and the first labels it names.
 *
 * @param body The text between the fences.
 * @returns For example "Diagram, flowchart: User query, Keyword index, Merge".
 */
export function mermaidName(body: string): string {
  const type = mermaidType(body);
  const words = type === null ? 'diagram' : (TYPE_WORDS[type] ?? 'diagram');
  const labels = mermaidLabels(body);
  return `Diagram, ${words}${labels.length === 0 ? '' : `: ${labels.join(', ')}`}`;
}
