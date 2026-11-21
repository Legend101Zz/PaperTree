/**
 * Glance runs (v0.3 #337): the answer's contract and caps (zod), the request, the `glance-v1`
 * prompt, and the real service under the faux brain (no tools; a bad answer ends `error`, never a
 * retry). No live model: whether a real one keeps to the JSON object and the caps is the lead's
 * live check.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { RunRequest } from '../src/contract.ts';
import { validateRunRequest } from '../src/contract.ts';
import { defaultBrain, FAUX_GLANCE } from '../src/faux.ts';
import {
  BLOCK_WORDS,
  GIST_WORDS,
  parseGlanceAnswer,
  trimWords,
  VALUE_CHARS,
  wordCount,
} from '../src/glance.ts';
import { systemPrompt, userText } from '../src/prompts.ts';

import { readExample, semanticProblems, validateRequest } from './support/contract.ts';
import {
  type Agent,
  postRun,
  requestId,
  runId,
  startAgent,
  startToolServer,
  type ToolServer,
} from './support/harness.ts';

type Json = Record<string, any>;

const sentence = (n: number): string =>
  Array.from({ length: n }, (_, i) => `w${String(i)}`).join(' ');

const sheet = (extra: Json = {}): Json => ({
  gist: 'Treat layers as steps of a continuous process.',
  problem: { text: 'A deep net is a fixed stack of layers.', cite: 'b1' },
  idea: { text: 'Let $dh/dt = f(h, t)$ define the hidden state.', cite: 'b2' },
  how: { text: 'A black-box ODE solver runs the forward pass.', cite: null },
  results: {
    numbers: [
      { value: '0.42%', measures: 'test error, MNIST' },
      { value: '0.22M', measures: 'parameters' },
    ],
    note: 'Also: continuous normalizing flows.',
    cite: 'b3',
  },
  limits: { text: 'You must choose solver tolerances.', cite: 'b3' },
  read_first: '§1 and Figure 1, then §3.',
  words: [
    { term: 'ODE', gloss: 'an equation for change' },
    { term: 'Euler method', gloss: 'the simplest step' },
    { term: 'adjoint method', gloss: 'gradients backwards' },
    { term: 'normalizing flow', gloss: 'invertible steps' },
    { term: 'Lipschitz', gloss: 'a bound on change' },
  ],
  ...extra,
});

describe('words, the way the caps count them', () => {
  test('a maths span is part of one word, whatever is inside it', () => {
    assert.equal(wordCount('Let $h(t)$ evolve as $dh / dt = f$.'), 5);
    assert.equal(wordCount('Costs $5 and more'), 4);
    assert.equal(wordCount('  '), 0);
  });

  test('a long text is cut after the last word that fits, with an ellipsis', () => {
    assert.equal(trimWords('one two three four', 2), 'one two…');
    assert.equal(trimWords('one, two, three', 2), 'one, two…');
    assert.equal(trimWords('  one   two ', 2), 'one two');
    assert.equal(trimWords('One two. Three four', 2), 'One two.');
  });

  test('a cut never splits a maths span', () => {
    const text = 'Let $a b c d$ be big and so on';
    assert.equal(trimWords(text, 2), 'Let $a b c d$…');
    assert.equal(trimWords(text, 1), 'Let…');
  });
});

describe('the glance answer (zod)', () => {
  test('a valid sheet comes back whole', () => {
    const verdict = parseGlanceAnswer(JSON.stringify(sheet()));
    assert.ok(verdict.ok);
    assert.equal(verdict.answer.idea.text, 'Let $dh/dt = f(h, t)$ define the hidden state.');
    assert.equal(verdict.answer.results.numbers.length, 2);
    assert.equal(verdict.answer.how.cite, null);
    assert.equal(verdict.answer.words.length, 5);
  });

  test('a Markdown fence around the object is tolerated', () => {
    assert.ok(parseGlanceAnswer('```json\n' + JSON.stringify(sheet()) + '\n```').ok);
  });

  test('the gist is at most 20 words, a block at most 30: a longer text is trimmed to the cap', () => {
    const verdict = parseGlanceAnswer(
      JSON.stringify(
        sheet({
          gist: sentence(GIST_WORDS + 9),
          problem: { text: sentence(BLOCK_WORDS + 10), cite: null },
          results: {
            numbers: [],
            note: sentence(BLOCK_WORDS + 1),
            cite: null,
          },
        }),
      ),
    );
    assert.ok(verdict.ok);
    assert.equal(wordCount(verdict.answer.gist), GIST_WORDS);
    assert.ok(verdict.answer.gist.endsWith('…'));
    assert.equal(wordCount(verdict.answer.problem.text), BLOCK_WORDS);
    assert.equal(wordCount(verdict.answer.results.note ?? ''), BLOCK_WORDS);
  });

  test('a text at exactly its cap is untouched', () => {
    const text = sentence(BLOCK_WORDS);
    const verdict = parseGlanceAnswer(JSON.stringify(sheet({ limits: { text, cite: null } })));
    assert.ok(verdict.ok && verdict.answer.limits.text === text);
  });

  test('Results keeps two large numbers at most; five words to know, no more', () => {
    const verdict = parseGlanceAnswer(
      JSON.stringify(
        sheet({
          results: {
            numbers: [
              { value: '1', measures: 'a' },
              { value: '2', measures: 'b' },
              { value: '3', measures: 'c' },
            ],
            note: null,
            cite: null,
          },
          words: [...sheet()['words'], { term: 'Sixth', gloss: 'dropped' }],
        }),
      ),
    );
    assert.ok(verdict.ok);
    assert.deepEqual(
      verdict.answer.results.numbers.map((n) => n.value),
      ['1', '2'],
    );
    assert.deepEqual(
      verdict.answer.words.map((w) => w.term),
      ['ODE', 'Euler method', 'adjoint method', 'normalizing flow', 'Lipschitz'],
    );
  });

  test('anything else is rejected', () => {
    const base = sheet();
    const without = (key: string): Json => {
      const copy = { ...base };
      delete copy[key];
      return copy;
    };
    const bad: Array<[string, string]> = [
      ['prose around it', `Sure! ${JSON.stringify(base)}`],
      ['an array', '[]'],
      ['an extra key', JSON.stringify(sheet({ stands_on: 6 }))],
      ['a missing key', JSON.stringify(without('limits'))],
      ['an empty gist', JSON.stringify(sheet({ gist: '  ' }))],
      ['a cite that is not a handle', JSON.stringify(sheet({ idea: { text: 'x', cite: '[b1]' } }))],
      ['a cite left out', JSON.stringify(sheet({ idea: { text: 'x' } }))],
      [
        'a block with an extra key',
        JSON.stringify(sheet({ idea: { text: 'x', cite: null, p: 3 } })),
      ],
      [
        'a value over its bound',
        JSON.stringify(
          sheet({
            results: {
              numbers: [{ value: 'x'.repeat(VALUE_CHARS + 1), measures: 'm' }],
              note: null,
              cite: null,
            },
          }),
        ),
      ],
      [
        'Results with no number and no note',
        JSON.stringify(sheet({ results: { numbers: [], note: null, cite: null } })),
      ],
      ['four words to know', JSON.stringify(sheet({ words: sheet()['words'].slice(0, 4) }))],
      [
        'a term over its bound',
        JSON.stringify(
          sheet({
            words: sheet()['words'].map((w: Json, i: number) =>
              i ? w : { ...w, term: 't'.repeat(41) },
            ),
          }),
        ),
      ],
    ];
    for (const [why, text] of bad) assert.equal(parseGlanceAnswer(text).ok, false, why);
  });
});

describe('the glance request', () => {
  test('the committed example fits the contract', () => {
    const example = readExample('glance');
    assert.equal(validateRequest(example), true, JSON.stringify(validateRequest.errors));
    assert.ok(validateRunRequest(example).ok);
  });

  test('a glance run is paired with glance-v1 only, and carries the glance question', () => {
    const wrongPrompt = validateRunRequest({
      ...readExample('glance'),
      prompt_version: 'summary-v1',
    });
    assert.ok(!wrongPrompt.ok && /glance-v1/.test(wrongPrompt.detail));
    const wrongQuestion = validateRunRequest({ ...readExample('glance'), question: 'Summarise.' });
    assert.ok(!wrongQuestion.ok && /glance question/.test(wrongQuestion.detail));
  });
});

describe('the glance-v1 prompt', () => {
  const request = readExample('glance') as RunRequest;

  test('asks for one JSON object with the design caps, no tools, and marks paper text as data', () => {
    const prompt = systemPrompt(request);
    assert.match(prompt, /ONE JSON object/);
    assert.match(prompt, /"gist"/);
    assert.ok(prompt.includes(`at most ${String(GIST_WORDS)} words`));
    assert.ok(prompt.includes(`at most ${String(BLOCK_WORDS)} words`));
    assert.match(prompt, /exactly 5 objects/);
    assert.match(prompt, /No tool is available/);
    assert.match(prompt, /\$dh\/dt = f\(h, t\)\$/);
    assert.ok(prompt.includes(request.datamark));
    assert.doesNotMatch(prompt, /get_passage/);
  });

  test('the digest is in the system prompt with its handles; the user turn is the question', () => {
    const prompt = systemPrompt(request);
    assert.match(prompt, /\[b1\] \(p\. 1 · Abstract · abstract\)/);
    assert.equal(userText(request), request.question);
  });
});

/** The `done` frame's data: the last event of a run's stream. */
const done = (events: Array<{ event: string; data: Json }>): Json => events.at(-1)!.data;

describe('a glance run through the service (faux brain)', () => {
  let tools: ToolServer;
  let agent: Agent;
  let next = 1700;

  before(async () => {
    tools = await startToolServer(() => ({
      status: 404,
      body: { detail: 'No tools in a glance run.', code: 'not_found', retryable: false },
    }));
    agent = await startAgent({ apiOrigin: tools.origin, brain: defaultBrain });
  });

  after(async () => {
    await agent?.close();
    await tools?.close();
  });

  function glanceRequest(marker = ''): Json {
    const body = structuredClone(readExample('glance'));
    next++;
    body['run_id'] = runId(next);
    body['request_id'] = requestId(next);
    body['tool']['base_url'] = tools.baseUrl(body['run_id']);
    body['question'] = `${body['question']}${marker}`;
    return body;
  }

  test('the faux brain writes the canned sheet, citing digest handles; no tool is used', async () => {
    const result = await postRun(agent.url, glanceRequest());
    assert.equal(result.status, 200, result.text);
    assert.deepEqual(semanticProblems(result.events), []);
    const end = done(result.events);
    assert.equal(end['status'], 'complete');
    assert.equal(end['tool_calls'], 0);
    const verdict = parseGlanceAnswer(end['final_text']);
    assert.ok(verdict.ok);
    assert.equal(verdict.answer.gist, FAUX_GLANCE.gist);
    assert.equal(verdict.answer.problem.cite, 'b1');
    assert.equal(verdict.answer.how.cite, 'b2');
    assert.equal(verdict.answer.words.length, 5);
    assert.equal(result.events.filter((e) => e.event === 'usage').length, 1);
    const logged = agent.logs.filter(
      (l) => l.event === 'agent.run.done' && l['run_id'] === runId(next),
    );
    assert.equal(logged.at(-1)?.['glance_valid'], true);
  });

  test('[faux:glance-bad] ends error (no glance) with the text kept, and is not retried', async () => {
    const result = await postRun(agent.url, glanceRequest(' [faux:glance-bad]'));
    const end = done(result.events);
    assert.equal(end['status'], 'error');
    assert.equal(end['error']['code'], 'internal');
    assert.match(end['final_text'], /No glance is written/);
    assert.equal(end['retries'], 0);
    assert.equal(parseGlanceAnswer(end['final_text']).ok, false);
  });
});
