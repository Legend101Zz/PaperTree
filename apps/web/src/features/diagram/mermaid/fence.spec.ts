import { describe, expect, it } from 'vitest';

import { mermaidLabels, mermaidName, mermaidType } from './fence';

const FLOW = [
  'flowchart LR',
  '  subgraph search["Two indexes"]',
  '    keyword["Keyword index"]',
  '    vector["Vector index"]',
  '  end',
  '  query["User query"] --> keyword',
  '  keyword -->|"ranked list"| merge["Merge"]',
].join('\n');

describe('mermaidType', () => {
  it('reads the first word, past comments, and refuses an unknown type', () => {
    expect(mermaidType(FLOW)).toBe('flowchart');
    expect(mermaidType('%% note\nsequenceDiagram\n  A->>B: hi')).toBe('sequenceDiagram');
    expect(mermaidType('pie\n  "a": 1')).toBeNull();
    expect(mermaidType('')).toBeNull();
  });
});

describe('mermaidName', () => {
  it('names the type in words and the first labels, edge labels left out', () => {
    expect(mermaidName(FLOW)).toBe(
      'Diagram, flowchart: Two indexes, Keyword index, Vector index, User query, Merge',
    );
  });

  it('sequence: the participants', () => {
    const body =
      'sequenceDiagram\n  participant Reader\n  participant T as Tutor\n  Reader->>T: Asks';
    expect(mermaidName(body)).toBe('Diagram, sequence diagram: Reader, Tutor');
  });

  it('sequence without declarations: the actors of the first messages', () => {
    expect(
      mermaidName('sequenceDiagram\n  Client->>Server: Sends\n  Server-->>Client: Answers'),
    ).toBe('Diagram, sequence diagram: Client, Server');
  });

  it('mind map and timeline: the lines; state: the states; others still get a name', () => {
    expect(mermaidName('mindmap\n  root((Attention))\n    Queries\n    Keys')).toBe(
      'Diagram, mind map: Attention, Queries, Keys',
    );
    expect(mermaidName('timeline\n  title History\n  2014 : Bahdanau')).toBe(
      'Diagram, timeline: History, Bahdanau',
    );
    expect(mermaidName('stateDiagram-v2\n  [*] --> Training\n  Training --> Evaluating')).toBe(
      'Diagram, state diagram: Training, Evaluating',
    );
    expect(mermaidName('erDiagram\n  A ||--o{ B : has')).toBe('Diagram, entity diagram');
    expect(mermaidName('nonsense')).toBe('Diagram, diagram');
  });

  it('caps the labels', () => {
    const many = [
      'flowchart TD',
      ...Array.from(
        { length: 20 },
        (_, i) => `  n${String(i)}["Step ${String(i)}"] --> m${String(i)}`,
      ),
    ];
    expect(mermaidLabels(many.join('\n')).length).toBe(6);
  });
});
