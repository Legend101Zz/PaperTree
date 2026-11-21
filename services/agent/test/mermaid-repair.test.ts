/**
 * The deterministic repairs and the size caps of a Mermaid fence (mermaid-repair.ts, v0.3 W6). The
 * repair tests are built from the four REAL fences of the 2026-11-20 round-1 stress test that did
 * not render (test/support/r1-failing-fences.ts), and each repaired fence is parsed by the REAL
 * parser (mermaid-parse.ts), not judged by eye.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { CAPS_LINE } from '../src/figure.ts';
import { MermaidParser } from '../src/mermaid-parse.ts';
import {
  FIGURE_ASK,
  FIGURE_CAPS,
  figureLimits,
  flowNodeIds,
  repairMermaid,
  tidyMermaidText,
  tidyQuadrantPoints,
} from '../src/mermaid-repair.ts';
import { INLINE_DIAGRAM } from '../src/prompts.ts';

import {
  FLOWCHART_TWO_STATEMENTS_A,
  FLOWCHART_TWO_STATEMENTS_B,
  MINDMAP_PARENTHESES,
  MINDMAP_SECOND_ROOT,
} from './support/r1-failing-fences.ts';
import {
  MINDMAP_QUOTED_NODES_ODE,
  MINDMAP_QUOTED_NODES_TRANSFORMER,
  QUADRANT_ON_TITLE,
} from './support/r3-look-fences.ts';

const parser = new MermaidParser();
after(() => parser.close());

const parses = async (body: string): Promise<boolean> => (await parser.parse(body)).status === 'ok';

describe('the round-1 failures are real failures, and each repair makes them parse', () => {
  test('the four fences fail to parse as written', async () => {
    for (const body of [
      MINDMAP_SECOND_ROOT,
      FLOWCHART_TWO_STATEMENTS_A,
      FLOWCHART_TWO_STATEMENTS_B,
      MINDMAP_PARENTHESES,
    ]) {
      const verdict = await parser.parse(body);
      assert.equal(verdict.status, 'invalid', body.slice(0, 40));
    }
  });

  test('two flowchart statements on one line are split (#58: `--> quiz  pool2 --> quiz`)', async () => {
    const r = repairMermaid(FLOWCHART_TWO_STATEMENTS_A);
    assert.deepEqual(r.applied, ['flow-split-statements']);
    assert.match(
      r.body,
      /real\["Real human article, mean 215 words"\] --> quiz\n {2}pool2 --> quiz\[/,
    );
    assert.ok(await parses(r.body));
  });

  test('two statements, the second after a subgraph block (#78: `cat --> wo  wo --> out`)', async () => {
    const r = repairMermaid(FLOWCHART_TWO_STATEMENTS_B);
    assert.deepEqual(r.applied, ['flow-split-statements']);
    assert.match(r.body, /\n {2}cat --> wo\n {2}wo --> out$/);
    assert.ok(await parses(r.body));
  });

  test('a mindmap whose second node sits left of the root gets one root (#29, with <br> labels)', async () => {
    const tidy = tidyMermaidText(MINDMAP_SECOND_ROOT);
    assert.deepEqual(tidy.applied, ['drop-br']);
    assert.doesNotMatch(tidy.body, /<br/);
    assert.match(tidy.body, /Design process substance, difficulty/, '<br> became a space');
    const r = repairMermaid(tidy.body);
    assert.deepEqual(r.applied, ['mindmap-one-root']);
    const root = /^( *)root\(\(/m.exec(r.body)?.[1]?.length ?? -1;
    const design = /^( *)Design\[/m.exec(r.body)?.[1]?.length ?? -1;
    assert.ok(design > root, 'Design is a child of the root');
    assert.ok(await parses(r.body));
  });

  test('a mindmap node with parentheses in its text becomes `id("text")`, shape syntax (#90: `Learn F(x) = H(x) - x`)', async () => {
    const r = repairMermaid(MINDMAP_PARENTHESES);
    assert.deepEqual(r.applied, ['mindmap-quote-text']);
    assert.match(r.body, /^ {6}n\d+\("Learn F\(x\) = H\(x\) - x"\)$/m);
    assert.doesNotMatch(r.body, /^\s*"/m, 'no bare quoted node');
    assert.match(r.body, /^ {4}Problem\["Degradation problem"\]$/m, 'shaped nodes are left alone');
    assert.ok(await parses(r.body));
  });

  test('a repair is idempotent and leaves a good fence alone', () => {
    for (const body of [
      FLOWCHART_TWO_STATEMENTS_A,
      FLOWCHART_TWO_STATEMENTS_B,
      MINDMAP_PARENTHESES,
    ]) {
      const once = repairMermaid(body);
      assert.deepEqual(repairMermaid(once.body), { body: once.body, applied: [] });
    }
    const good = 'flowchart TD\n  a["Input"] -->|"F(x)"| b["Sum"]\n  b --> c(("Out"))';
    assert.deepEqual(repairMermaid(good), { body: good, applied: [] });
  });
});

describe('literal quotes are not left in the text a figure draws (round 3 look defects)', () => {
  test('a bare quoted mindmap node loses its quotes (9 real nodes of the Transformer mindmap)', async () => {
    const r = tidyMermaidText(MINDMAP_QUOTED_NODES_TRANSFORMER);
    assert.deepEqual(r.applied, ['mindmap-unquote']);
    assert.match(r.body, /^ {4}Encoder and decoder stacks$/m);
    assert.match(r.body, /^ {6}Scaled dot-product$/m);
    assert.match(r.body, /^ {2}root\["Transformer"\]$/m, 'a quoted shape keeps its own quotes');
    assert.doesNotMatch(r.body, /^\s*"/m);
    assert.ok(await parses(r.body));
  });

  test('the ODE mindmap: bare nodes unquoted, the apostrophe-wrapped label made plain', async () => {
    const r = tidyMermaidText(MINDMAP_QUOTED_NODES_ODE);
    assert.match(r.body, /^ {6}n7\["a\(tN\) = dL\/dz at tN"\]$/m);
    assert.match(r.body, /^ {6}da\/dt = -a df\/dz$/m);
    assert.doesNotMatch(r.body, /^\s*"/m);
    assert.doesNotMatch(r.body, /'/);
    assert.ok(await parses(r.body));
  });

  test('a bare quoted node whose text holds brackets becomes `id("text")` and parses', async () => {
    const body = 'mindmap\n  root((R))\n    "Boundary a(tN) = dL/dz"\n      "Plain child"';
    const r = tidyMermaidText(body);
    assert.equal(
      r.body,
      'mindmap\n  root((R))\n    n2("Boundary a(tN) = dL/dz")\n      Plain child',
    );
    assert.ok(await parses(r.body));
    assert.deepEqual(tidyMermaidText(r.body), { body: r.body, applied: [] }, 'idempotent');
  });

  test('a mindmap with no stray quotes is returned unchanged', () => {
    const body = 'mindmap\n  root(("A"))\n    B["C (x)"]\n      D';
    assert.deepEqual(tidyMermaidText(body), { body, applied: [] });
  });

  test('timeline text and state labels lose literal quotes', async () => {
    const tl = tidyMermaidText('timeline\n  title "T"\n  section "Early"\n  2000 : "first" : two');
    assert.equal(tl.body, 'timeline\n  title T\n  section Early\n  2000 : first : two');
    assert.ok(tl.applied.includes('timeline-quotes'));
    const st = tidyMermaidText(
      'stateDiagram-v2\n  state "Idle (x)" as A\n  [*] --> A\n  A --> B : "go now"',
    );
    assert.equal(
      st.body,
      'stateDiagram-v2\n  state "Idle (x)" as A\n  [*] --> A\n  A --> B : go now',
    );
    assert.deepEqual(st.applied, ['state-quotes']);
    assert.ok(await parses(tl.body));
    assert.ok(await parses(st.body));
  });
});

const pointsOf = (body: string): Array<[string, number, number]> =>
  [...body.matchAll(/^\s*"?([^":]+?)"?\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]\s*$/gm)].map((m) => [
    m[1] ?? '',
    Number(m[2]),
    Number(m[3]),
  ]);

describe('quadrant points stay off the quadrant titles and off each other', () => {
  test('the real fence: "Restricted self-attention" at y = 0.5 leaves the lower title band', async () => {
    const r = tidyMermaidText(QUADRANT_ON_TITLE);
    assert.deepEqual(r.applied, ['quadrant-spread']);
    const by = new Map(pointsOf(r.body).map(([n, x, y]) => [n, { x, y }]));
    assert.deepEqual(by.get('Restricted self-attention'), { x: 0.25, y: 0.56 });
    assert.deepEqual(by.get('Self-attention'), { x: 0.1, y: 0.1 }, 'a clear point is untouched');
    assert.deepEqual(by.get('Convolutional'), { x: 0.3, y: 0.35 });
    assert.deepEqual(by.get('Recurrent'), { x: 0.85, y: 0.85 });
    assert.ok(await parses(r.body));
    assert.deepEqual(tidyMermaidText(r.body), { body: r.body, applied: [] }, 'idempotent');
  });

  test('band edges, the top rows and the sides', () => {
    const lines = [
      'quadrantChart',
      '  A: [0.5, 0.40]',
      '  B: [0.2, 0.52]',
      '  C: [0.8, 0.45]',
      '  D: [0.6, 0.96]',
      '  E: [0.99, 0.2]',
      '  F: [0.01, 0.7]',
      '  G: [0.3, 0.53]',
    ];
    const { lines: out, moved } = tidyQuadrantPoints(lines);
    assert.deepEqual(out, [
      'quadrantChart',
      '  A: [0.50, 0.36]',
      '  B: [0.20, 0.56]',
      '  C: [0.80, 0.36]',
      '  D: [0.60, 0.85]',
      '  E: [0.95, 0.20]',
      '  F: [0.05, 0.70]',
      '  G: [0.3, 0.53]',
    ]);
    assert.equal(moved, 6);
  });

  test('close points are spread on y, never into a title band, until no two overprint', () => {
    const lines = [
      'quadrantChart',
      ...Array.from({ length: 5 }, (_, i) => `  P${String(i)}: [0.30, 0.${String(30 + i)}]`),
    ];
    const { lines: out } = tidyQuadrantPoints(lines);
    const pts = pointsOf(out.join('\n'));
    assert.equal(pts.length, 5);
    for (const [, , y] of pts) assert.ok(y < 0.4 || y > 0.52, `y ${String(y)} is in the band`);
    for (const [i, a] of pts.entries())
      for (const b of pts.slice(i + 1))
        assert.ok(
          Math.abs(a[1] - b[1]) >= 0.0699 || Math.abs(a[2] - b[2]) >= 0.0699,
          `${a[0]} ${b[0]}`,
        );
  });

  test('a point already clear, and lines it cannot read, are left byte for byte', () => {
    const lines = [
      'quadrantChart',
      '  title "T: [0.5, 0.5]"',
      '  x-axis L --> H',
      '  "A": [0.2, 0.2]',
      '  point: BERT[0.88, 0.50]',
    ];
    assert.deepEqual(tidyQuadrantPoints(lines), { lines, moved: 0 });
  });
});

describe('flowchart node text with shape characters is quoted', () => {
  test('()[]{} in unquoted text, shape kept', async () => {
    const body = 'flowchart TD\n  a[Learn F(x)] --> b(Add [x] and {y})\n  b --> c{Is x(1) ok}';
    const r = repairMermaid(body);
    assert.deepEqual(r.applied, ['flow-quote-text']);
    assert.match(r.body, /a\["Learn F\(x\)"\] --> b\("Add \[x\] and \{y\}"\)/);
    assert.match(r.body, /c\{"Is x\(1\) ok"\}/);
    assert.ok(await parses(r.body));
  });

  test('already-quoted text, plain text and trapezoids are untouched', () => {
    const body =
      'flowchart TD\n  a["Learn F(x)"] --> b(Plain words)\n  b --> c[/slanted/]\n  c -->|"F(x)"| d[Done]';
    assert.equal(repairMermaid(body).body, body);
  });
});

describe('the cosmetics that are always on', () => {
  test('<br> becomes a space in any type', () => {
    const r = tidyMermaidText('flowchart TD\n  a["one<br/>two"] --> b["x<br>y"]');
    assert.equal(r.body, 'flowchart TD\n  a["one two"] --> b["x y"]');
    assert.deepEqual(r.applied, ['drop-br']);
  });

  test('literal quotes leave a title (quadrantChart, timeline); an xychart title keeps its own', () => {
    assert.equal(
      tidyMermaidText('quadrantChart\n  title "Cost and value"\n  x-axis L --> H').body,
      'quadrantChart\n  title Cost and value\n  x-axis L --> H',
    );
    assert.equal(
      tidyMermaidText('timeline\n  title "A history"\n  2000 : x').body,
      'timeline\n  title A history\n  2000 : x',
    );
    const chart = 'xychart-beta\n  title "Error by depth"\n  x-axis [a, b]\n  line [1, 2]';
    assert.equal(tidyMermaidText(chart).body, chart);
  });

  test('a flowchart of more than four nodes goes top-down; four or fewer may stay LR', () => {
    const five = 'flowchart LR\n  a --> b\n  b --> c\n  c --> d\n  d --> e';
    assert.equal(tidyMermaidText(five).body.split('\n')[0], 'flowchart TD');
    assert.deepEqual(tidyMermaidText(five).applied, ['flow-td']);
    const four = 'flowchart LR\n  a --> b\n  b --> c\n  c --> d';
    assert.equal(tidyMermaidText(four).body, four);
    assert.equal(
      tidyMermaidText('graph RL\n  a --> b\n  b --> c\n  c --> d\n  d --> e').body.split('\n')[0],
      'graph TD',
    );
  });

  test('an already tidy fence is returned unchanged', () => {
    const body = 'flowchart TD\n  a["x"] --> b["y"]';
    assert.deepEqual(tidyMermaidText(body), { body, applied: [] });
  });
});

const flow = (n: number): string =>
  `flowchart TD\n${Array.from({ length: n - 1 }, (_, i) => `  n${String(i)}["A"] --> n${String(i + 1)}["B"]`).join('\n')}`;

const q = (n: number): string =>
  `quadrantChart\n  x-axis L --> H\n  y-axis L --> H\n${Array.from({ length: n }, (_, i) => `  P${String(i)}: [0.${String(i + 1)}, 0.5]`).join('\n')}`;
const x = (n: number): string =>
  `xychart-beta\n  x-axis [${Array.from({ length: n }, (_, i) => `y${String(i)}`).join(', ')}]\n  line [${Array.from({ length: n }, (_, i) => String(i)).join(', ')}]`;

describe('the size caps are counted', () => {
  test('flowchart: 16 nodes pass, 17 do not; subgraph ids and edge labels are not nodes', () => {
    assert.deepEqual(figureLimits(flow(FIGURE_CAPS.flowNodes)), []);
    assert.match(figureLimits(flow(FIGURE_CAPS.flowNodes + 1))[0] ?? '', /17 nodes; at most 16/);
    const sub =
      'flowchart TD\n  subgraph s1["Group"]\n    a["A"] -->|"edge words"| b["B"]\n  end\n  c["C"] -- more words --> a';
    assert.deepEqual([...flowNodeIds(sub.split('\n').slice(1))].toSorted(), ['a', 'b', 'c']);
  });

  test('mindmap: node count and depth below the root', () => {
    const wide = `mindmap\n  root((R))\n${Array.from({ length: 16 }, (_, i) => `    N${String(i)}`).join('\n')}`;
    assert.match(figureLimits(wide)[0] ?? '', /17 nodes; at most 16/);
    const ok = 'mindmap\n  root((R))\n    A\n      B\n        C';
    assert.deepEqual(figureLimits(ok), []);
    const deep = `${ok}\n          D`;
    assert.match(figureLimits(deep)[0] ?? '', /4 levels below the root; at most 3/);
  });

  test('sequenceDiagram: participants (declared or in messages) and messages', () => {
    const four =
      'sequenceDiagram\n  participant A\n  participant B\n  A->>B: x\n  B->>C: y\n  C-->>D: z';
    assert.deepEqual(figureLimits(four), []);
    assert.match(figureLimits(`${four}\n  D->>E: w`)[0] ?? '', /5 participants; at most 4/);
    const chatty = `sequenceDiagram\n${Array.from({ length: 11 }, () => '  A->>B: hi').join('\n')}`;
    assert.match(figureLimits(chatty)[0] ?? '', /11 messages; at most 10/);
  });

  test('timeline: periods, and events per period (also continuation lines)', () => {
    const six = `timeline\n  title H\n${Array.from({ length: 6 }, (_, i) => `  ${String(2000 + i)} : a : b`).join('\n')}`;
    assert.deepEqual(figureLimits(six), []);
    assert.deepEqual(figureLimits('timeline\n  2000 : a : b : c'), [], 'three events are fine');
    assert.match(figureLimits(`${six}\n  2010 : c`)[0] ?? '', /7 periods; at most 6/);
    assert.match(
      figureLimits('timeline\n  2000 : a : b : c : d')[0] ?? '',
      /4 events in one period/,
    );
    assert.match(
      figureLimits('timeline\n  2000 : a : b : c\n       : d')[0] ?? '',
      /4 events in one period/,
    );
  });

  test('quadrantChart points and xychart points', () => {
    assert.deepEqual(figureLimits(q(6)), []);
    assert.match(figureLimits(q(7))[0] ?? '', /7 points; at most 6/);
    assert.deepEqual(figureLimits(x(8)), []);
    assert.match(figureLimits(x(9))[0] ?? '', /9 points; at most 8/);
  });

  test('state, class and ER diagrams have no counted cap', () => {
    assert.deepEqual(figureLimits('stateDiagram-v2\n  [*] --> A\n  A --> B'), []);
  });

  test('the prompt keeps asking for the FIGURE_ASK sizes; the soft caps sit at or above them', () => {
    const c = FIGURE_ASK;
    for (const phrase of [
      `flowchart ${String(c.flowNodes)} nodes`,
      `mindmap one root, ${String(c.mindmapNodes)} nodes, ${String(c.mindmapDepth)} levels`,
      `sequenceDiagram ${String(c.participants)} participants, ${String(c.messages)} messages`,
      `timeline ${String(c.periods)} periods with ${String(c.eventsPerPeriod)} short events`,
      `quadrantChart ${String(c.quadrantPoints)} points`,
      `xychart-beta ${String(c.chartPoints)} points`,
      `${String(c.rowNodes)} nodes or fewer`,
    ]) {
      assert.ok(INLINE_DIAGRAM.includes(phrase), phrase);
    }
    assert.ok(CAPS_LINE.includes(`${String(FIGURE_CAPS.flowNodes)} nodes`));
    for (const key of Object.keys(FIGURE_ASK) as (keyof typeof FIGURE_ASK)[])
      assert.ok(FIGURE_CAPS[key] >= FIGURE_ASK[key], key);
  });
});
