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

  test('four sections, one inline maths, one handle, a mermaid fence, no check by default', () => {
    const text = run({});
    for (const heading of ['## TL;DR', '## In plain words', '## How it works', '## In the paper']) {
      assert.ok(text.includes(heading), heading);
    }
    assert.equal((text.match(/\$[^$\n]+\$/g) ?? []).length, 1);
    assert.deepEqual(text.match(/\[b\d+\]/g), ['[b3]']);
    assert.match(text, /^```mermaid\nflowchart TD\n {2}subgraph /m, 'an explain draws a flowchart');
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

describe('the default brain on a board ask (#343)', () => {
  const run = (patch: Partial<RunRequest>): string => {
    const request = {
      ...(readExample('explain') as unknown as RunRequest),
      kind: 'ask',
      prompt_version: 'ask-v1',
      question: 'What is a residual?',
      ...patch,
    } as RunRequest;
    const [step] = defaultBrain(request);
    assert.ok(step !== undefined);
    const turn =
      typeof step === 'function' ? step({ systemPrompt: SEED, messages: [], request: 1 }) : step;
    return (turn.text ?? []).join('');
  };

  test('says what it was asked and how many earlier turns the path had', () => {
    assert.match(run({}), /\(Faux\) Asked: "What is a residual\?", with 0 earlier turn\(s\)/);
    const history = {
      session_id: 'thr_01K63A9W4XJ7Q2N8R5T0V3Y6ZB',
      entries: [
        { message: { role: 'user' } },
        { message: { role: 'assistant' } },
        { message: { role: 'user' } },
      ],
    };
    assert.match(run({ history } as Partial<RunRequest>), /with 2 earlier turn\(s\)/);
  });

  test('diagram: never writes no diagram fence; the tutor shape is otherwise the same', () => {
    assert.doesNotMatch(run({ diagram: 'never' } as Partial<RunRequest>), /```mermaid/);
    assert.match(run({ diagram: 'always' } as Partial<RunRequest>), /```mermaid\nsequenceDiagram/);
    assert.match(
      run({}),
      /## TL;DR[\s\S]*## In plain words[\s\S]*## How it works[\s\S]*## In the paper/,
    );
  });

  test('with no tools and no passages it answers from the path alone, without calling one', () => {
    const base = readExample('explain') as unknown as RunRequest;
    const request = {
      ...base,
      kind: 'ask',
      prompt_version: 'ask-v1',
      seed: { ...base.seed!, passages: [] },
      limits: { ...base.limits, max_tool_calls: 0 },
    } as RunRequest;
    const steps = defaultBrain(request);
    assert.equal(steps.length, 1);
    const [step] = steps;
    const turn =
      typeof step === 'function' ? step({ systemPrompt: SEED, messages: [], request: 1 }) : step!;
    assert.equal(turn.toolCalls, undefined);
    assert.match((turn.text ?? []).join(''), /only the board path, not the paper/);
  });
});
