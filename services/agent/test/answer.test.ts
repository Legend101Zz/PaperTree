/**
 * `tidyAnswer` (answer.ts): the diagram and check fences of an explain / ask answer, on fixture
 * model outputs (v0.3, #339).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cleanCheckFence, tidyAnswer } from '../src/answer.ts';
import { cleanDiagramFence, MIN_INLINE_PARTS } from '../src/diagram.ts';

const PLATE = '{"t":"plate","title":"Residual block"}';
const A = '{"t":"part","label":"Input x","text":"enters","kind":"input","after":[],"cite":null}';
const B =
  '{"t":"part","label":"Layers","text":"learn the change","kind":"step","after":["A"],"cite":null}';
const C =
  '{"t":"part","label":"Sum","text":"added back","kind":"output","after":["B","A"],"cite":null}';
const CHECK = [
  'prompt: If $F(x) = 0$, the block outputs ___.',
  'accept: x | the input | input',
  'right: Right. $0 + x = x$.',
  'hint: Put 0 in place of $F(x)$.',
].join('\n');
const fence = (lang: string, body: string): string => `\`\`\`${lang}\n${body}\n\`\`\``;
const prose =
  '## TL;DR\nIt adds the input back.\n\n## How it works\nThe block outputs $y = F(x) + x$.';

describe('a clean answer', () => {
  test('comes back exactly as written, so the deltas still equal final_text', () => {
    const text = `${prose}\n${fence('diagram', [PLATE, A, B, C].join('\n'))}\n\n## In the paper\nIt says so [b1].\n\n${fence('check', CHECK)}`;
    assert.equal(tidyAnswer(text, true), text);
  });

  test('tidying is idempotent', () => {
    const messy = `${prose}\n${fence('diagram', [PLATE, A, '{"t":"part"', B].join('\n'))}`;
    const once = tidyAnswer(messy, false);
    assert.equal(tidyAnswer(once, false), once);
  });

  test('a code fence of another language is left alone, whatever it holds', () => {
    const text = `${prose}\n${fence('python', '```diagram')}\nmore`;
    assert.equal(tidyAnswer(text, false), text);
  });
});

describe('the diagram fence', () => {
  test('invalid lines are dropped and the letters are re-counted over the kept parts', () => {
    const text = `${prose}\n${fence('diagram', [PLATE, A, 'not json', '{"t":"part","label":"x"}', C].join('\n'))}`;
    const out = tidyAnswer(text, false);
    // The model counted A, B(broken), C; C pointed at "B" and "A". The kept parts are A and C.
    assert.match(out, /"label":"Sum".*"after":\["A"\]/);
    assert.equal((out.match(/"t":"part"/g) ?? []).length, 2);
  });

  test('a fence with no valid part is removed with its fences, and no blank gap is left', () => {
    const text = `${prose}\n${fence('diagram', 'nothing\n{"t":"part"')}\n\n## In the paper\nSays so.`;
    const out = tidyAnswer(text, false);
    assert.doesNotMatch(out, /```/);
    assert.doesNotMatch(out, /\n\n\n/);
    assert.match(out, /Says so\.$/);
  });

  test('a second diagram fence is removed, the first kept', () => {
    const one = fence('diagram', [PLATE, A, B].join('\n'));
    const two = fence('diagram', ['{"t":"plate","title":"Other"}', A, B].join('\n'));
    const out = tidyAnswer(`${prose}\n${one}\n${two}`, false);
    assert.equal((out.match(/```diagram/g) ?? []).length, 1);
    assert.doesNotMatch(out, /Other/);
  });

  test('a fence the model never closed is removed', () => {
    const out = tidyAnswer(`${prose}\n\`\`\`diagram\n${PLATE}\n${A}`, false);
    assert.doesNotMatch(out, /diagram/);
    assert.equal(out, prose);
  });

  test('cleanDiagramFence keeps an arrow label and a link between kept parts only', () => {
    const body = [
      PLATE,
      A,
      '{"t":"part","label":"Sum","text":"s","kind":"output","after":["A"],"edge":["identity"],"cite":null}',
      '{"t":"link","from":"B","to":"A","label":"loop"}',
      '{"t":"link","from":"D","to":"A"}',
    ].join('\n');
    const lines = (cleanDiagramFence(body) ?? '').split('\n');
    assert.equal(lines.length, 4, 'the link to a part that does not exist is dropped');
    assert.match(lines[2]!, /"edge":\["identity"\]/);
    assert.equal(lines[3], '{"t":"link","from":"B","to":"A","label":"loop"}');
    assert.equal(cleanDiagramFence('{"t":"plate","title":"Only a title"}'), null);
  });

  // The next three are live MiniMax-M3.1-Flash outputs for ResNet p. 2 (2026-11-20): the stored
  // one-box fence of the live check, and a real five-part fence the model wrote.
  const ONE_BOX = [
    '{"t":"plate","title":"Residual block"}',
    '{"t":"part","label":"input x","text":"signal entering the block","kind":"input","after":[],"cite":null}',
  ].join('\n');
  const FIVE_PARTS = [
    '{"t":"plate","title":"Residual shortcut connection"}',
    '{"t":"part","label":"Input","text":"x enters the block","kind":"input","after":["A"],"cite":null}',
    '{"t":"part","label":"Stacked layers","text":"compute F(x)","kind":"step","after":["A"],"cite":null}',
    '{"t":"part","label":"Shortcut","text":"passes x unchanged","kind":"concept","after":["A"],"cite":null}',
    '{"t":"part","label":"Addition","text":"combines F(x) and x","kind":"step","after":["B","C"],"cite":null}',
    '{"t":"part","label":"Output","text":"y = F(x) + x","kind":"output","after":["D"],"cite":null}',
  ].join('\n');

  test('a one-box figure explains nothing: the fence is removed, not shipped (live ResNet answer)', () => {
    assert.equal(MIN_INLINE_PARTS, 2);
    assert.equal(cleanDiagramFence(ONE_BOX), null);
    const text = `${prose}\n${fence('diagram', ONE_BOX)}\n\n## In the paper\nSays so.`;
    const out = tidyAnswer(text, false);
    assert.doesNotMatch(out, /diagram|input x/);
    assert.match(out, /Says so\.$/);
  });

  test('a real five-part residual block is kept whole; only its self-arrow is trimmed', () => {
    const lines = (cleanDiagramFence(FIVE_PARTS) ?? '').split('\n');
    assert.equal(lines.filter((l) => l.includes('"t":"part"')).length, 5);
    assert.match(
      lines[1]!,
      /"label":"Input".*"after":\[\]/,
      'part A pointing at itself loses only that arrow',
    );
    assert.match(lines[4]!, /"label":"Addition".*"after":\["B","C"\]/);
    assert.match(lines[5]!, /"label":"Output".*"after":\["D"\]/);
    const text = `${prose}\n${fence('diagram', FIVE_PARTS)}`;
    assert.equal(tidyAnswer(tidyAnswer(text, false), false), tidyAnswer(text, false));
  });

  test('small slips cost a field, not the part: no cite, an odd kind, lowercase or word letters, four arrows', () => {
    const body = [
      PLATE,
      '{"t":"part","label":"Input","text":"enters","kind":"input","after":[]}',
      '{"t":"part","label":"Layers","text":"learn","kind":"layer","after":["a"],"cite":"[b1]"}',
      '{"t":"part","label":"Shortcut","text":"skips","kind":"step","after":["Input"],"edge":"x","cite":{"nope":1}}',
      '{"t":"part","label":"Sum","text":"adds","kind":"output","after":["A","B","C","A"],"cite":null}',
    ].join('\n');
    const kept = (cleanDiagramFence(body) ?? '')
      .split('\n')
      .slice(1)
      .map((l) => JSON.parse(l));
    assert.equal(kept.length, 4);
    assert.deepEqual(
      kept.map((p) => p.kind),
      ['input', 'step', 'step', 'output'],
    );
    assert.deepEqual(
      kept.map((p) => p.after),
      [[], ['A'], [], ['A', 'B', 'C']],
    );
    assert.ok(kept.every((p) => p.cite === null));
  });
});

describe('the check fence', () => {
  test('is kept in canonical form only when the request asked for it', () => {
    const text = `${prose}\n\n${fence('check', CHECK.replace('x | the input', 'x |  the input '))}`;
    const asked = tidyAnswer(text, true);
    assert.match(asked, /accept: x \| the input \| input/);
    assert.doesNotMatch(tidyAnswer(text, false), /```check/);
  });

  test('a malformed one (a key missing, an extra key, a repeated key, an empty value) is removed', () => {
    const lines = CHECK.split('\n');
    const cases = [
      lines.slice(0, 3).join('\n'),
      `${CHECK}\nextra: no`,
      `${CHECK}\nhint: twice`,
      CHECK.replace('hint: Put 0 in place of $F(x)$.', 'hint:'),
      CHECK.replace('accept: x | the input | input', 'accept: | |'),
      `${CHECK}\nnot a key value line`,
    ];
    for (const body of cases) {
      assert.equal(cleanCheckFence(body), null, body);
      assert.doesNotMatch(tidyAnswer(`${prose}\n\n${fence('check', body)}`, true), /```check/);
    }
  });

  test('only one check fence survives', () => {
    const text = `${prose}\n\n${fence('check', CHECK)}\n\n${fence('check', CHECK)}`;
    assert.equal((tidyAnswer(text, true).match(/```check/g) ?? []).length, 1);
  });

  test('the keys may come in any order and in any case', () => {
    const shuffled = ['HINT: Try it.', 'prompt: Fill ___.', 'right: Yes.', 'Accept: a|b'].join(
      '\n',
    );
    assert.equal(
      cleanCheckFence(shuffled),
      'prompt: Fill ___.\naccept: a | b\nright: Yes.\nhint: Try it.',
    );
  });
});

describe('diagram: never (#343)', () => {
  const plate = fence('diagram', [PLATE, A, B, C].join('\n'));
  test('a diagram fence the model wrote anyway is removed', () => {
    const text = `## TL;DR\nA.\n\n${plate}\n\n## In the paper\nB.`;
    assert.match(tidyAnswer(text, false), /```diagram/);
    assert.doesNotMatch(tidyAnswer(text, false, false), /```diagram/);
  });
});
