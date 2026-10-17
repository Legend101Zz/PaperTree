/**
 * The `[faux:paragraphs]` scenario (#205): the phone e2e's precondition. Three paragraphs from the
 * seed, the second citing both seed passages as one run, the third uncited.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

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
