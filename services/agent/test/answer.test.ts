/**
 * `tidyAnswer` (answer.ts): the diagram and check fences of an explain / ask answer, on fixture
 * model outputs (v0.3, #339).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cleanCheckFence, tidyAnswer } from '../src/answer.ts';
import { cleanDiagramFence } from '../src/diagram.ts';

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
    const one = fence('diagram', [PLATE, A].join('\n'));
    const two = fence('diagram', ['{"t":"plate","title":"Other"}', A].join('\n'));
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
