/**
 * The `[faux:paragraphs]` scenario (#205): the phone e2e's precondition. Three paragraphs from the
 * seed, the second citing both seed passages as one run, the third uncited.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { tidyAnswer } from '../src/answer.ts';
import { defaultBrain } from '../src/faux.ts';
import { readExample } from './support/contract.ts';

import type { RunRequest } from '../src/contract.ts';

const SEED =
  '[b3] (p. 2 · Introduction · paragraph)\nRecurrent models typically factor computation.\n\n' +
  '[b4] (p. 2 · Introduction · paragraph)\nAttention mechanisms have become integral.';

describe('[faux:paragraphs]', () => {
  test('answers from the seed in three paragraphs: cited, a run of both, uncited', () => {
    const request = {
      ...(readExample('explain') as unknown as RunRequest),
      question: 'Say more [faux:paragraphs]',
    };
    const [step] = defaultBrain(request);
    assert.ok(step !== undefined);
    const turn =
      typeof step === 'function' ? step({ systemPrompt: SEED, messages: [], request: 1 }) : step;
    const paragraphs = (turn.text ?? []).join('').split('\n\n');
    assert.equal(paragraphs.length, 3);
    assert.match(paragraphs[0]!, /\[b3\].*\[b4\]/s);
    assert.match(paragraphs[1]!, /\[b3, b4\]/);
    assert.doesNotMatch(paragraphs[2]!, /\[b\d/);
  });
});

describe('the default brain answers in the v0.3 shape', () => {
  const run = (patch: Partial<RunRequest>): string => {
    const request = { ...(readExample('explain') as unknown as RunRequest), ...patch };
    const [step] = defaultBrain(request);
    assert.ok(step !== undefined);
    const turn =
      typeof step === 'function' ? step({ systemPrompt: SEED, messages: [], request: 1 }) : step;
    return (turn.text ?? []).join('');
  };

  test('four sections, one inline maths, one handle, a diagram fence, no check by default', () => {
    const text = run({});
    for (const heading of ['## TL;DR', '## In plain words', '## How it works', '## In the paper']) {
      assert.ok(text.includes(heading), heading);
    }
    assert.equal((text.match(/\$[^$\n]+\$/g) ?? []).length, 1);
    assert.deepEqual(text.match(/\[b\d+\]/g), ['[b3]']);
    assert.match(text, /^```diagram\n\{"t":"plate"/m);
    assert.match(text, /The selected passage says: /);
    assert.doesNotMatch(text, /```check/);
  });

  test('a check fence when check is true, and the trade-off section for an expert', () => {
    assert.match(
      run({ check: true }),
      /```check\nprompt: .*\naccept: .*\nright: .*\nhint: .*\n```/,
    );
    const expert = run({ level: 'expert' });
    assert.match(expert, /## The trade-off/);
    assert.doesNotMatch(expert, /## In plain words/);
  });

  test('is deterministic and already canonical, so tidying changes nothing', () => {
    assert.equal(run({ check: true }), run({ check: true }));
    const text = run({ check: true });
    assert.equal(tidyAnswer(text, true), text);
    assert.equal(tidyAnswer(run({}), false), run({}));
  });
});
