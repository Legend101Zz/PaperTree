/**
 * The figure step (figure.ts, v0.3 W6): ok / tidy / deterministic / model / kept-over-cap / dropped, with a fake
 * parser and model where the path is the point, and the REAL parser and the four real round-1
 * failures where the repair is.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { REPAIR_SYSTEM, repairPrompt, settleFigure, type FigureDeps } from '../src/figure.ts';
import { MermaidParser, type ParseVerdict } from '../src/mermaid-parse.ts';

import {
  FLOWCHART_TWO_STATEMENTS_A,
  FLOWCHART_TWO_STATEMENTS_B,
  MINDMAP_PARENTHESES,
  MINDMAP_SECOND_ROOT,
} from './support/r1-failing-fences.ts';

const real = new MermaidParser();
after(() => real.close());
const realParse = (body: string): Promise<ParseVerdict> => real.parse(body);

const answer = (fence: string | null): string =>
  `## TL;DR\nIt adds the input back.\n\n## How it works\nThe block outputs $y = F(x) + x$ [b1].${fence === null ? '' : `\n\n\`\`\`mermaid\n${fence}\n\`\`\``}\n\n## In the paper\nSection 3 [b2].`;

const GOOD = 'flowchart TD\n  a["Input"] --> b["Layers"]\n  b --> c["Sum"]';
const accept = async (): Promise<ParseVerdict> => ({ status: 'ok' });
const down = async (): Promise<ParseVerdict> => ({ status: 'unavailable', reason: 'no parser' });
const reject = async (): Promise<ParseVerdict> => ({
  status: 'invalid',
  error: 'Parse error on line 2',
});

describe('the paths of a figure', () => {
  test('no fence: none, the text is returned as it is', async () => {
    const text = answer(null);
    const out = await settleFigure(text, false, true, { parse: accept });
    assert.deepEqual([out.path, out.text, out.modelCalled], ['none', text, false]);
  });

  test('a fence that parses and is within the caps: ok, untouched', async () => {
    const text = answer(GOOD);
    const out = await settleFigure(text, false, true, { parse: accept });
    assert.equal(out.path, 'ok');
    assert.equal(out.text, text);
    assert.equal(out.problem, null);
  });

  test('cosmetic tidying then a clean parse: tidy', async () => {
    const out = await settleFigure(
      answer('flowchart TD\n  a["one<br/>two"] --> b["Out"]\n  b --> c["Sum"]'),
      false,
      true,
      { parse: accept },
    );
    assert.equal(out.path, 'tidy');
    assert.doesNotMatch(out.text, /<br/);
    assert.match(out.text, /a\["one two"\]/);
  });

  test('a repair the parse accepts, no model: deterministic, with what was applied', async () => {
    const out = await settleFigure(answer(FLOWCHART_TWO_STATEMENTS_B), false, true, {
      parse: realParse,
    });
    assert.equal(out.path, 'deterministic');
    assert.deepEqual(out.repairs, ['flow-split-statements']);
    assert.match(out.problem ?? '', /Parse error/);
    assert.equal(out.modelCalled, false);
    assert.match(out.text, /cat --> wo\n {2}wo --> out/);
    assert.match(out.text, /## In the paper\nSection 3 \[b2\]\.$/, 'the answer around it is kept');
  });

  test('the other real flowchart failure, too (two statements, `--> quiz  pool2 --> quiz`)', async () => {
    const out = await settleFigure(answer(FLOWCHART_TWO_STATEMENTS_A), false, true, {
      parse: realParse,
    });
    assert.equal(out.path, 'deterministic');
  });

  test('a fence the parser never reaches (unsafe): dropped, no parse, no model call', async () => {
    let calls = 0;
    const out = await settleFigure(
      answer('flowchart TD\n  a["x"] --> b["y"]\n  click a "https://x.example"'),
      false,
      true,
      {
        parse: async () => {
          calls++;
          return { status: 'ok' };
        },
        repair: async () => {
          calls++;
          return GOOD;
        },
      },
    );
    assert.equal(out.path, 'dropped');
    assert.equal(calls, 0);
    assert.doesNotMatch(out.text, /mermaid|click/);
  });
});

const edges = (n: number): string =>
  `flowchart TD\n${Array.from({ length: n }, (_, i) => `  n${String(i)}["A"] --> n${String(i + 1)}["B"]`).join('\n')}`;

describe('over a size cap is soft: simplify once, else keep', () => {
  const big = edges(17); // 18 nodes, cap 16
  const small = 'flowchart TD\n  a["Start"] --> b["Middle"]\n  b --> c["End"]';

  test('a diagram a little above what the prompt asks (13 to 16 nodes) is fine as it is', async () => {
    const out = await settleFigure(answer(edges(15)), false, true, {
      parse: accept,
      repair: async () => {
        throw new Error('no model call expected');
      },
    });
    assert.deepEqual([out.path, out.modelCalled], ['ok', false]);
  });

  test('the model is asked to simplify, with the cap in the request, and its fence is kept', async () => {
    const asked: string[] = [];
    const out = await settleFigure(answer(big), false, true, {
      parse: accept,
      repair: async (prompt, system) => {
        asked.push(prompt, system);
        return small;
      },
    });
    assert.equal(out.path, 'model');
    assert.equal(out.modelCalled, true);
    assert.match(out.problem ?? '', /18 nodes; at most 16/);
    assert.match(asked[0] ?? '', /18 nodes; at most 16/);
    assert.match(asked[0] ?? '', /flowchart TD, at most 16 nodes/);
    assert.equal(asked[1], REPAIR_SYSTEM);
    assert.match(out.text, /a\["Start"\] --> b\["Middle"\]/);
    assert.doesNotMatch(out.text, /n17/);
  });

  test('a reply still over the cap, a null reply, a throw: the ORIGINAL is kept (one request only)', async () => {
    const replies: (() => Promise<string | null>)[] = [
      async () => big,
      async () => null,
      async () => {
        throw new Error('timeout');
      },
    ];
    for (const reply of replies) {
      let calls = 0;
      const out = await settleFigure(answer(big), false, true, {
        parse: accept,
        repair: async () => {
          calls++;
          return reply();
        },
      });
      assert.equal(out.path, 'kept-over-cap');
      assert.equal(out.modelCalled, true);
      assert.equal(calls, 1, 'one request, never a loop');
      assert.match(out.text, /n17\["B"\]/);
      assert.match(out.text, /## In the paper\nSection 3 \[b2\]\.$/);
      assert.match(out.problem ?? '', /18 nodes; at most 16/);
    }
  });

  test('no repair available (offline replay): kept, not dropped', async () => {
    const out = await settleFigure(answer(big), false, true, { parse: accept });
    assert.deepEqual([out.path, out.modelCalled], ['kept-over-cap', false]);
    assert.match(out.text, /n17/);
  });

  test('a timeline with 3 events in a period is within the soft cap; 4 is over it', async () => {
    const t = (events: string): string => answer(`timeline\n  title H\n  2000 : ${events}`);
    assert.equal((await settleFigure(t('a : b : c'), false, true, { parse: accept })).path, 'ok');
    assert.equal(
      (await settleFigure(t('a : b : c : d'), false, true, { parse: accept })).path,
      'kept-over-cap',
    );
  });

  test('the real mindmaps of round 1 are never dropped (the first now fits the soft cap: no model call)', async () => {
    for (const body of [MINDMAP_SECOND_ROOT, MINDMAP_PARENTHESES]) {
      const out = await settleFigure(answer(body), false, true, {
        parse: realParse,
        repair: async () => {
          throw new Error('no model call expected');
        },
      });
      assert.notEqual(out.path, 'dropped', body.slice(0, 30));
      if (body === MINDMAP_SECOND_ROOT) assert.equal(out.modelCalled, false);
    }
  });

  test('a mindmap over 16 nodes: simplified by the model once, else kept', async () => {
    const wide = `mindmap\n  root((R))\n${Array.from({ length: 17 }, (_, i) => `    N${String(i)}`).join('\n')}`;
    let prompt = '';
    const simplified = await settleFigure(answer(wide), false, true, {
      parse: realParse,
      repair: async (p) => {
        prompt = p;
        return 'mindmap\n  root((Idea))\n    One\n    Two';
      },
    });
    assert.equal(simplified.path, 'model');
    assert.match(prompt, /18 nodes; at most 16/);
    const kept = await settleFigure(answer(wide), false, true, { parse: realParse });
    assert.equal(kept.path, 'kept-over-cap');
    assert.match(kept.text, /```mermaid\nmindmap/);
  });

  test('an over-cap fence that is ALSO broken: repaired by the model once; a failed repair drops it', async () => {
    const broken = `${big}\n  a --> --> b`;
    const out = await settleFigure(answer(broken), false, true, {
      parse: async (b) =>
        b.includes('--> -->') ? { status: 'invalid', error: 'Parse error' } : { status: 'ok' },
      repair: async () => big,
    });
    assert.equal(out.path, 'model', 'a repair that parses is accepted even over a cap');
    const dropped = await settleFigure(answer(broken), false, true, {
      parse: async (b) =>
        b.includes('--> -->') ? { status: 'invalid', error: 'Parse error' } : { status: 'ok' },
      repair: async () => null,
    });
    assert.equal(dropped.path, 'dropped');
  });
});

describe('the model repair', () => {
  const broken = 'flowchart TD\n  a --> --> b\n  b --> c';

  test('a fence the structural repairs cannot fix goes to the model once; a ```mermaid reply is read', async () => {
    let asked = '';
    const deps: FigureDeps = {
      parse: realParse,
      repair: async (prompt) => {
        asked = prompt;
        return '```mermaid\nflowchart TD\n  a["One"] --> b["Two"]\n  b --> c["Three"]\n```';
      },
    };
    const out = await settleFigure(answer(broken), false, true, deps);
    assert.equal(out.path, 'model');
    assert.match(asked, /Parse error/);
    assert.ok(asked.endsWith(broken), 'the fence follows the problem');
    assert.match(out.text, /a\["One"\] --> b\["Two"\]/);
  });

  test('a null reply, a throw, or a reply the safety check refuses: dropped', async () => {
    for (const repair of [
      async () => null,
      async () => {
        throw new Error('timeout');
      },
      async () => 'flowchart TD\n  a["x"] --> b["y"]\n  click a "https://x.example"',
    ]) {
      const out = await settleFigure(answer(broken), false, true, { parse: realParse, repair });
      assert.equal(out.path, 'dropped');
      assert.equal(out.modelCalled, true);
    }
  });

  test('the request is short and names the rules', () => {
    const prompt = repairPrompt(broken, 'Parse error on line 2');
    assert.ok(prompt.length < 900, String(prompt.length));
    assert.match(prompt, /A\["text \(x\)"\]/);
  });
});

describe('when the parser is unavailable', () => {
  test('a fence is kept as it is (unchecked), over a cap or not: it cannot be judged', async () => {
    const kept = await settleFigure(answer(GOOD), false, true, { parse: down });
    assert.equal(kept.path, 'unchecked');
    assert.equal(kept.text, answer(GOOD));
    const big = `flowchart TD\n${Array.from({ length: 17 }, (_, i) => `  n${String(i)} --> n${String(i + 1)}`).join('\n')}`;
    assert.equal((await settleFigure(answer(big), false, true, { parse: down })).path, 'unchecked');
  });

  test('a parser that always rejects, with no repair, drops the fence', async () => {
    assert.equal(
      (await settleFigure(answer(GOOD), false, true, { parse: reject })).path,
      'dropped',
    );
  });
});
