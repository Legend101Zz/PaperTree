/**
 * Topic runs (v0.2 S2b2, #242): the answer's contract (zod), the request's input lines, the
 * `topic-v1` prompt, and the real service under the faux brain (`[faux:topic-existing]`,
 * `[faux:topic-new]`, `[faux:topic-bad]`; no tools; a bad answer ends `error`, never a retry).
 * No live model: whether a real one keeps to the JSON object is the slice's one live smoke.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { RunRequest } from '../src/contract.ts';
import { validateRunRequest } from '../src/contract.ts';
import { defaultBrain } from '../src/faux.ts';
import { systemPrompt, userText } from '../src/prompts.ts';
import { parseTopicAnswer, parseTopicInput, TOPIC_NAME_MAX } from '../src/topic.ts';

import { readExample, validateRequest, semanticProblems } from './support/contract.ts';
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

const EXISTING = ['Transformers & attention', 'Vision & detection'];
const answer = (extra: Json = {}): string =>
  JSON.stringify({ topic_name: 'Vision & detection', is_new: false, reason: 'Images.', ...extra });

describe('the topic answer (zod)', () => {
  test("an existing topic comes back in the reader's own spelling", () => {
    const verdict = parseTopicAnswer(answer({ topic_name: 'vision & DETECTION' }), EXISTING);
    assert.ok(verdict.ok);
    assert.deepEqual(verdict.answer, {
      topic_name: 'Vision & detection',
      is_new: false,
      reason: 'Images.',
    });
  });

  test('a new name is accepted when it is not an existing topic', () => {
    const verdict = parseTopicAnswer(
      answer({ topic_name: ' Diffusion   models ', is_new: true }),
      EXISTING,
    );
    assert.ok(verdict.ok && verdict.answer.topic_name === 'Diffusion models');
  });

  test('a Markdown fence around the object is tolerated', () => {
    assert.ok(parseTopicAnswer('```json\n' + answer() + '\n```', EXISTING).ok);
  });

  test('anything else is rejected', () => {
    const bad: Array<[string, string]> = [
      ['prose around it', `Sure! ${answer()}`],
      ['two objects', `${answer()}\n${answer()}`],
      ['an extra key', answer({ confidence: 0.9 })],
      ['a missing reason', JSON.stringify({ topic_name: 'Vision & detection', is_new: false })],
      ['is_new as a string', answer({ is_new: 'false' })],
      ['an empty name', answer({ topic_name: '  ', is_new: true })],
      [
        'a name over the bound',
        answer({ topic_name: 'N'.repeat(TOPIC_NAME_MAX + 1), is_new: true }),
      ],
      ['an empty reason', answer({ reason: ' ' })],
      ['is_new false for an unknown name', answer({ topic_name: 'Nobody has this' })],
      ['is_new true for an existing name', answer({ is_new: true })],
      ['an array', '[]'],
    ];
    for (const [why, text] of bad) assert.equal(parseTopicAnswer(text, EXISTING).ok, false, why);
  });

  test('a name of exactly the bound is accepted; a long reason is clipped, not refused', () => {
    const name = 'N'.repeat(TOPIC_NAME_MAX);
    const verdict = parseTopicAnswer(
      answer({ topic_name: name, is_new: true, reason: 'r'.repeat(500) }),
      [],
    );
    assert.ok(verdict.ok && verdict.answer.reason.length === 200);
  });
});

describe('the topic request', () => {
  test('the committed example fits the contract, and its question reads back', () => {
    const example = readExample('topic');
    assert.equal(validateRequest(example), true, JSON.stringify(validateRequest.errors));
    assert.ok(validateRunRequest(example).ok);
    assert.deepEqual(parseTopicInput(example['question']), {
      category: 'cs.LG',
      topics: EXISTING,
    });
  });

  test('"Category: none" is no category, and a question without the lines is refused', () => {
    assert.deepEqual(parseTopicInput('Category: none\nExisting topics: []'), {
      category: null,
      topics: [],
    });
    assert.equal(parseTopicInput('What topic is this?'), null);
    const body = { ...readExample('topic'), question: 'What topic is this?' };
    assert.equal(validateRunRequest(body).ok, false);
  });

  test('a topic run is paired with topic-v1 only', () => {
    const body = { ...readExample('topic'), prompt_version: 'summary-v1' };
    const result = validateRunRequest(body);
    assert.ok(!result.ok && /topic-v1/.test(result.detail));
  });
});

describe('the topic-v1 prompt', () => {
  const request = readExample('topic') as RunRequest;

  test('asks for one JSON object, no tools, and marks paper text as data', () => {
    const prompt = systemPrompt(request);
    assert.match(prompt, /ONE JSON object/);
    assert.match(prompt, /"topic_name"/);
    assert.match(prompt, /No tool is available/);
    assert.ok(prompt.includes(`at most ${String(TOPIC_NAME_MAX)} characters`));
    assert.ok(prompt.includes(request.datamark));
    assert.doesNotMatch(prompt, /get_passage|\[b1\]/);
  });

  test('the abstract goes in the user turn, datamarked and inside the untrusted tags', () => {
    const turn = userText(request);
    assert.ok(turn.startsWith(request.question));
    assert.match(turn, /<untrusted_document trust="untrusted">/);
    assert.ok(turn.includes(`${request.datamark} We ${request.datamark} present`));
  });

  test('no abstract is said, not guessed', () => {
    const none = { ...request, seed: { ...request.seed!, quote: '' } };
    assert.match(userText(none), /Abstract excerpt: \(none found\)/);
  });
});

/** The `done` frame's data: the last event of a run's stream. */
const done = (events: Array<{ event: string; data: Json }>): Json => events.at(-1)!.data;

describe('a topic run through the service (faux brain)', () => {
  let tools: ToolServer;
  let agent: Agent;
  let next = 1200;

  before(async () => {
    tools = await startToolServer(() => ({
      status: 404,
      body: { detail: 'No tools in a topic run.', code: 'not_found', retryable: false },
    }));
    agent = await startAgent({ apiOrigin: tools.origin, brain: defaultBrain });
  });

  after(async () => {
    await agent?.close();
    await tools?.close();
  });

  function topicRequest(marker: string, topics: readonly string[] = EXISTING): Json {
    const body = structuredClone(readExample('topic'));
    next++;
    body['run_id'] = runId(next);
    body['request_id'] = requestId(next);
    body['tool']['base_url'] = tools.baseUrl(body['run_id']);
    body['question'] = `Category: cs.LG\nExisting topics: ${JSON.stringify(topics)}\n${marker}`;
    return body;
  }

  test('[faux:topic-existing] answers with the first existing topic; no tool is used', async () => {
    const result = await postRun(agent.url, topicRequest('[faux:topic-existing]'));
    assert.equal(result.status, 200, result.text);
    assert.deepEqual(semanticProblems(result.events), []);
    assert.equal(done(result.events)['status'], 'complete');
    assert.equal(done(result.events)['tool_calls'], 0);
    const verdict = parseTopicAnswer(done(result.events)['final_text'], EXISTING);
    assert.ok(verdict.ok && verdict.answer.topic_name === EXISTING[0] && !verdict.answer.is_new);
    assert.equal(result.events.filter((e) => e.event === 'usage').length, 1);
  });

  test('[faux:topic-new] answers with a new name', async () => {
    const result = await postRun(agent.url, topicRequest('[faux:topic-new]'));
    assert.equal(done(result.events)['status'], 'complete');
    const verdict = parseTopicAnswer(done(result.events)['final_text'], EXISTING);
    assert.ok(verdict.ok && verdict.answer.is_new);
  });

  test('[faux:topic-bad] ends error (no suggestion) with the text kept, and is not retried', async () => {
    const result = await postRun(agent.url, topicRequest('[faux:topic-bad]'));
    const end = done(result.events);
    assert.equal(end['status'], 'error');
    assert.equal(end['error']['code'], 'internal');
    assert.match(end['final_text'], /A topic nobody has/);
    assert.equal(end['retries'], 0);
    assert.equal(result.events.filter((e) => e.event === 'usage').length, 1);
    const logged = agent.logs.filter(
      (l) => l.event === 'agent.run.done' && l['run_id'] === runId(next),
    );
    assert.equal(logged.at(-1)?.['topic_valid'], false);
  });

  test('with no marker the faux agent suggests nothing (the e2e stack must not race the arXiv rule)', async () => {
    const result = await postRun(agent.url, topicRequest(''));
    assert.equal(done(result.events)['status'], 'error');
    assert.equal(parseTopicAnswer(done(result.events)['final_text'], EXISTING).ok, false);
  });
});
