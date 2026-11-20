/**
 * The ```mermaid fence of an answer (mermaid.ts, answer.ts): good fences of every type the prompt
 * offers pass unchanged, unsafe or unknown ones are dropped whole, cosmetics are cut, and the
 * answer's `tidyAnswer` keeps at most one figure.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { tidyAnswer } from '../src/answer.ts';
import {
  cleanMermaidFence,
  MERMAID_MAX_CHARS,
  MERMAID_MAX_LINES,
  MERMAID_TYPES,
  mermaidTypeOf,
} from '../src/mermaid.ts';

const GOOD: Record<string, string> = {
  flowchart: [
    'flowchart LR',
    '  subgraph search["Two indexes"]',
    '    keyword["Keyword index"]',
    '    vector["Vector index"]',
    '  end',
    '  query["User query"] --> keyword',
    '  keyword -->|"ranked list"| merge["Merge"]',
  ].join('\n'),
  graph: 'graph TD\n  a["Input"] --> b["Middle"]\n  b --> c["Output"]',
  sequenceDiagram:
    'sequenceDiagram\n  Client->>Server: Sends a request\n  Server-->>Client: Sends the answer',
  'stateDiagram-v2':
    'stateDiagram-v2\n  [*] --> Training\n  Training --> Evaluating: epoch ends\n  Evaluating --> [*]',
  mindmap: 'mindmap\n  root((Attention))\n    Queries\n    Keys\n    Values',
  timeline:
    'timeline\n  title History of attention\n  2014 : Bahdanau attention\n  2017 : Transformer',
  quadrantChart:
    'quadrantChart\n  title Methods\n  x-axis Cheap --> Costly\n  y-axis Weak --> Strong\n  Dense: [0.8, 0.9]',
  'xychart-beta':
    'xychart-beta\n  title "Error by depth"\n  x-axis [20, 56]\n  y-axis "Error (%)" 0 --> 30\n  line [10, 14]',
  classDiagram:
    'classDiagram\n  class Encoder\n  class Decoder\n  <<interface>> Layer\n  Encoder <|-- Decoder',
  erDiagram: 'erDiagram\n  PAPER ||--o{ SECTION : has\n  SECTION ||--o{ PASSAGE : has',
};

describe('cleanMermaidFence: good fences', () => {
  for (const type of MERMAID_TYPES) {
    test(`${type} passes unchanged`, () => {
      const body = GOOD[type];
      assert.ok(body !== undefined, `a fixture for ${type}`);
      assert.equal(cleanMermaidFence(body), body);
      assert.equal(mermaidTypeOf(body), type);
    });
  }

  test('a comment above the header and CRLF line ends are tolerated', () => {
    const out = cleanMermaidFence('%% a note\r\nflowchart TD\r\n  a --> b\r\n  b --> c\r\n');
    assert.equal(out, 'flowchart TD\n  a --> b\n  b --> c');
  });

  test('a flowchart label may hold maths written plainly and parentheses', () => {
    const body = 'flowchart LR\n  x["Input x"] -->|"F(x)"| y["Output y = F(x) + x"]';
    assert.equal(cleanMermaidFence(`${body}\n  y --> z`), `${body}\n  y --> z`);
  });
});

const base = (extra: string): string => `flowchart LR\n  a["One"] --> b["Two"]\n  ${extra}`;
const fence = (lang: string, body: string): string => `\`\`\`${lang}\n${body}\n\`\`\``;

describe('cleanMermaidFence: bad fences are dropped whole', () => {
  const bad: Array<[string, string]> = [
    ['an unknown type', 'gitGraph\n  commit\n  commit'],
    ['a pie chart (not offered)', 'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2'],
    [
      'front matter before the header',
      '---\nconfig:\n  theme: dark\n---\nflowchart LR\n  a --> b\n  b --> c',
    ],
    ['an init directive', `%%{init: {"theme":"dark"}}%%\n${base('b --> c')}`],
    ['an init directive inside', base('%%{init: {"securityLevel":"loose"}}%%')],
    ['a click handler', base('click a "https://evil.example" "go"')],
    ['a click callback after a semicolon', base('b --> c; click b callback')],
    ['an href', base('a["<a href=x>go</a>"] --> c')],
    ['a script tag', base('c["<script>alert(1)</script>"] --> a')],
    ['an HTML tag in a label', base('c["line one<br/>two"] --> a')],
    ['an img tag', base('c["<img src=x onerror=alert(1)>"] --> a')],
    ['a javascript: url', base('c["javascript:alert(1)"] --> a')],
    ['an entity', base('c["&lt;b&gt;"] --> a')],
    ['an odd quote', base('c["never closed --> a')],
    [
      'a sequence link statement',
      'sequenceDiagram\n  A->>B: hi\n  link A: Dashboard @ https://x.example\n  B->>A: ok',
    ],
    ['only a header', 'flowchart LR'],
    ['a header and one line', 'flowchart LR\n  a --> b'],
    ['an odd flowchart header', 'flowchart LR; a --> b\n  a --> b\n  b --> c'],
    ['an empty body', '   \n  '],
    [
      'too many lines',
      `flowchart TD\n${Array.from({ length: MERMAID_MAX_LINES + 1 }, (_, i) => `  n${String(i)} --> m${String(i)}`).join('\n')}`,
    ],
    [
      'too many characters',
      `flowchart TD\n  a["${'x'.repeat(MERMAID_MAX_CHARS)}"] --> b\n  b --> c`,
    ],
    ['one very long line', `flowchart TD\n  a["${'x'.repeat(250)}"] --> b\n  b --> c`],
  ];
  for (const [name, body] of bad) {
    test(name, () => assert.equal(cleanMermaidFence(body), null));
  }
});

describe('cleanMermaidFence: cosmetics are cut, not the fence', () => {
  test('style, classDef, linkStyle, class and ::: suffixes are removed', () => {
    const out = cleanMermaidFence(
      [
        'flowchart LR',
        '  a["One"]:::hot --> b["Two"]',
        '  style a fill:#f9f,stroke:#333',
        '  classDef hot fill:#f00',
        '  linkStyle 0 stroke:#ff3',
        '  class a,b hot',
        '  b --> c["Three"]',
      ].join('\n'),
    );
    assert.equal(out, 'flowchart LR\n  a["One"] --> b["Two"]\n  b --> c["Three"]');
  });

  test('class is the declaration it is in a classDiagram', () => {
    assert.match(cleanMermaidFence(GOOD['classDiagram']!) ?? '', /class Encoder/);
  });
});

describe('tidyAnswer and a mermaid fence', () => {
  const prose = '## TL;DR\nIt adds the input back.\n\n## How it works\nThe block adds $x$.';

  test('a good fence comes back exactly as written', () => {
    const text = `${prose}\n${fence('mermaid', GOOD['flowchart']!)}\n\n## In the paper\nSays so [b1].`;
    assert.equal(tidyAnswer(text, false), text);
  });

  test('an unsafe fence is removed and the text around it stays', () => {
    const bad = fence('mermaid', 'flowchart LR\n  click a "https://x.example"\n  a --> b');
    const out = tidyAnswer(`${prose}\n${bad}\n\n## In the paper\nSays so [b1].`, false);
    assert.doesNotMatch(out, /mermaid|click/);
    assert.match(out, /## In the paper\nSays so \[b1\]\./);
  });

  test('a fence the model never closed is removed', () => {
    const out = tidyAnswer(`${prose}\n\`\`\`mermaid\nflowchart LR\n  a --> b`, false);
    assert.doesNotMatch(out, /mermaid|flowchart/);
  });

  test('at most one figure: the first stays, a second mermaid or a plate fence goes', () => {
    const one = fence('mermaid', GOOD['flowchart']!);
    const two = fence('mermaid', GOOD['sequenceDiagram']!);
    const plate = fence(
      'diagram',
      '{"t":"plate","title":"X"}\n{"t":"part","label":"One","text":"a","kind":"step","after":[],"cite":null}\n{"t":"part","label":"Two","text":"b","kind":"step","after":["A"],"cite":null}',
    );
    const out = tidyAnswer(`${prose}\n${one}\n${two}\n${plate}`, false);
    assert.equal((out.match(/```mermaid/g) ?? []).length, 1);
    assert.match(out, /flowchart LR/);
    assert.doesNotMatch(out, /sequenceDiagram|```diagram/);
  });

  test('an older plate fence still stays when it is the only figure', () => {
    const plate = fence(
      'diagram',
      '{"t":"plate","title":"X"}\n{"t":"part","label":"One","text":"a","kind":"step","after":[],"cite":null}\n{"t":"part","label":"Two","text":"b","kind":"step","after":["A"],"cite":null}',
    );
    assert.match(tidyAnswer(`${prose}\n${plate}`, false), /```diagram/);
  });

  test('diagram: never removes a mermaid fence the model wrote anyway', () => {
    const text = `${prose}\n${fence('mermaid', GOOD['flowchart']!)}`;
    assert.match(tidyAnswer(text, false), /```mermaid/);
    assert.doesNotMatch(tidyAnswer(text, false, false), /mermaid/);
  });

  test('another code fence is left alone, and the language is case-insensitive', () => {
    const code = fence('python', 'print("hi")');
    assert.equal(tidyAnswer(`${prose}\n${code}`, false), `${prose}\n${code}`);
    assert.match(tidyAnswer(`${prose}\n${fence('Mermaid', GOOD['graph']!)}`, false), /```mermaid/);
  });
});
