/**
 * The image ask (v0.3, #348), offline: the run kind, its contract, its prompt, and the hard guard
 * that a model without image input is never sent a picture. The picture goes through the REAL Pi
 * session (`prompt(text, {images})`) to the faux model, which counts the pictures it was handed.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { MAX_IMAGE_BYTES, validateRunRequest } from '../src/contract.ts';
import type { RunRequest } from '../src/contract.ts';
import { createLogger } from '../src/log.ts';
import {
  acceptsImages,
  DEFAULT_EFFORTS,
  DEFAULT_MODELS,
  FLASH_MODEL_ID,
  M3_MODEL_ID,
  readPolicy,
  RUN_KINDS,
} from '../src/models.ts';
import { systemPrompt, userText } from '../src/prompts.ts';
import { BootError } from '../src/app.ts';
import { createPaperSession, IMAGE_PLACEHOLDER, NoVisionModelError } from '../src/session.ts';
import { createPaperTools } from '../src/tools.ts';

import { readExample, semanticProblems } from './support/contract.ts';
import {
  type Agent,
  postRun,
  requestId,
  runId,
  startAgent,
  startToolServer,
  threadId,
  type ToolServer,
} from './support/harness.ts';

type Json = Record<string, any>;

let tools: ToolServer;
let agent: Agent;
let n = 5_000;

before(async () => {
  tools = await startToolServer(() => ({ status: 404, body: {} }));
  agent = await startAgent({ apiOrigin: tools.origin });
});
after(async () => {
  await agent?.close();
  await tools?.close();
});

/** The committed image example with a fresh run id (and the tool base url that goes with it). */
function image(patch: (body: Json) => void = () => {}): Json {
  const body = readExample('image');
  n++;
  body['run_id'] = runId(n);
  body['request_id'] = requestId(n);
  body['tool']['base_url'] = tools.baseUrl(body['run_id']);
  patch(body);
  return body;
}

const asRequest = (body: Json): RunRequest => body as unknown as RunRequest;

describe('the image run kind', () => {
  test('is a run kind of its own: Flash, effort medium, an env var for each', () => {
    assert.ok(RUN_KINDS.includes('image'));
    assert.equal(DEFAULT_MODELS.image, FLASH_MODEL_ID);
    assert.equal(DEFAULT_EFFORTS.image, 'medium');
    const policy = readPolicy({
      PAPERTREE_MODEL_IMAGE: M3_MODEL_ID,
      PAPERTREE_MODEL_EFFORT_IMAGE: 'high',
    });
    assert.equal(policy.image.id, M3_MODEL_ID);
    assert.equal(policy.image.effort, null, 'M3 keeps Pi budget-based thinking');
    const flash = readPolicy({ PAPERTREE_MODEL_EFFORT_IMAGE: 'high' });
    assert.equal(flash.image.id, FLASH_MODEL_ID);
    assert.equal(flash.image.effort, 'high');
    assert.equal(flash.ask.effort, 'medium', 'the other kinds keep their own efforts');
  });

  test('both live models take images, so the shipped policy passes the guard', () => {
    assert.equal(acceptsImages({ input: ['text', 'image'] }), true);
    assert.equal(acceptsImages({ input: ['text'] }), false);
    assert.equal(acceptsImages({}), false);
  });
});

describe('the request contract for pictures', () => {
  test('the committed example is valid, and an image run takes image-v1', () => {
    const checked = validateRunRequest(image());
    assert.equal(checked.ok, true, JSON.stringify(checked));
    const wrong = validateRunRequest(image((b) => void (b['prompt_version'] = 'ask-v1')));
    assert.equal(wrong.ok, false);
  });

  test('an image run needs a picture, and no other kind may carry one', () => {
    const none = validateRunRequest(image((b) => void delete b['images']));
    assert.equal(none.ok, false);
    const empty = validateRunRequest(image((b) => void (b['images'] = [])));
    assert.equal(empty.ok, false);
    const explain = readExample('explain');
    explain['images'] = readExample('image')['images'];
    const carried = validateRunRequest(explain);
    assert.equal(carried.ok, false, 'an explain run with a picture is refused');
    const ask = { ...explain, kind: 'ask', prompt_version: 'ask-v1' };
    assert.equal(validateRunRequest(ask).ok, false);
  });

  test('PNG and JPEG only, well-formed base64, the right magic bytes, a size cap, at most two', () => {
    const png = readExample('image')['images'][0];
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    const ok = (images: unknown[]): boolean =>
      validateRunRequest(image((b) => void (b['images'] = images))).ok;
    assert.equal(ok([png]), true);
    assert.equal(ok([png, png]), true);
    assert.equal(ok([png, png, png]), false, 'three pictures');
    assert.equal(
      ok([{ media_type: 'image/jpeg', data_base64: jpeg.toString('base64') }]),
      true,
      'a JPEG',
    );
    assert.equal(ok([{ ...png, media_type: 'image/gif' }]), false, 'a GIF is not accepted');
    assert.equal(ok([{ ...png, media_type: 'image/jpeg' }]), false, 'PNG bytes claiming JPEG');
    assert.equal(ok([{ ...png, data_base64: 'not base64 at all!!' }]), false);
    assert.equal(ok([{ ...png, data_base64: png.data_base64.slice(0, -1) }]), false, 'padding');
    assert.equal(ok([{ ...png, extra: 1 }]), false, 'no unknown fields');
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_IMAGE_BYTES),
    ]);
    const tooBig = validateRunRequest(
      image(
        (b) =>
          void (b['images'] = [{ media_type: 'image/png', data_base64: big.toString('base64') }]),
      ),
    );
    assert.equal(tooBig.ok, false);
  });
});

describe('the image prompt', () => {
  test('is the tutor shape about the figure, with the caption and mention as labelled passages', () => {
    const request = asRequest(image());
    const prompt = systemPrompt(request);
    assert.match(prompt, /The reader selected a figure/);
    assert.match(prompt, /## TL;DR/);
    assert.match(prompt, /Never try to read small text/);
    assert.match(prompt, /\[b1\] \(p\. 2 · caption · the figure's caption\)/);
    assert.match(prompt, /where the paper first mentions the figure/);
    assert.match(prompt, /The figure is on p\. 2/);
    assert.equal(prompt.includes(request.images![0]!.data_base64), false, 'no bytes in the prompt');
  });

  test('with no passages it says so and the caption rides in the user turn instead', () => {
    const request = asRequest(image((b) => void (b['seed']['passages'] = [])));
    assert.match(systemPrompt(request), /No caption or paragraph came with the picture/);
    const turn = userText(request);
    assert.match(turn, /Figure 2\. Residual learning/);
    assert.match(turn, /<untrusted_document trust="untrusted">/);
  });

  test('the user turn names the page, adds a selected text first turn only, never the bytes', () => {
    const request = asRequest(
      image((b) => void (b['seed']['quote'] = 'Shortcut connections skip one or more layers.')),
    );
    const turn = userText(request);
    assert.match(turn, /^Explain this figure\./);
    assert.match(turn, /The attached image is the figure I selected \(page 2\)\./);
    assert.match(turn, /The text I selected with it:[\s\S]*Shortcut connections/);
    assert.equal(turn.includes(request.images![0]!.data_base64), false);
    const followUp = userText({
      ...request,
      history: { session_id: threadId(1), entries: [] },
    });
    assert.doesNotMatch(followUp, /The text I selected/);
  });
});

describe('an image run through the real Pi session', () => {
  test('the faux model is handed the picture, the answer is a tutor answer, the history is bytes-free', async () => {
    const body = image();
    const result = await postRun(agent.url, body);
    assert.deepEqual(semanticProblems(result.events), []);
    const done = result.events.at(-1)!.data;
    assert.equal(done['status'], 'complete');
    const seen = agent.app.faux!.seen(String(body['run_id']));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.images, 1, 'the model was shown the crop');
    const text = String(done['final_text']);
    for (const heading of ['## TL;DR', '## In plain words', '## How it works', '## In the paper']) {
      assert.ok(text.includes(heading), heading);
    }
    assert.match(text, /shown 1 picture\(s\) of the figure on page 2/);
    assert.match(text, /\[b1\]/, 'it rests on the caption by its handle');
    assert.deepEqual(done['markers'], ['b1']);
    // The stored conversation keeps the turn and not the bytes.
    const entries = JSON.stringify(done['entries']);
    assert.equal(entries.includes(body['images'][0]['data_base64']), false, 'no base64 in entries');
    assert.equal(entries.includes('"type":"image"'), false);
    assert.ok(entries.includes(IMAGE_PLACEHOLDER));
  });

  test('a follow-up gets the picture again on ITS turn, and the history has none of the old one', async () => {
    const first = image();
    const firstResult = await postRun(agent.url, first);
    const entries = firstResult.events.at(-1)!.data['entries'] as unknown[];
    n++;
    const follow = image((b) => {
      b['question'] = 'Why does the shortcut help?';
      b['history'] = { session_id: threadId(n), entries };
    });
    const result = await postRun(agent.url, follow);
    assert.equal(result.events.at(-1)!.data['status'], 'complete');
    const seen = agent.app.faux!.seen(threadId(n));
    assert.equal(seen.at(-1)!.images, 1, 'one picture: the new turn’s, not the stored one');
    assert.match(String(result.events.at(-1)!.data['final_text']), /1 earlier turn\(s\)/);
  });
});

const textOnly = (model: any) => ({ ...model, input: ['text'] });

describe('a model without image input is never sent a picture', () => {
  const quiet = createLogger({ write: () => {} });
  const probe = async (model: any, sessionId: string) =>
    createPaperSession({
      modelRuntime: agent.app.modelRuntime,
      model,
      maxOutputTokens: 256,
      maxRetries: 0,
      thinkingLevel: 'low',
      systemPrompt: 'probe',
      tools: createPaperTools({
        baseUrl: 'http://127.0.0.1:9/internal/agent/runs/run_x',
        token: 't',
        requestId: 'r',
        runId: 'run_x',
        log: quiet,
        callIndex: () => undefined,
        maxToolCalls: 1,
        onResult() {},
        onFatal() {},
      }),
      sessionId,
      entries: [],
    });
  const crop = {
    type: 'image' as const,
    data: readExample('image')['images'][0]['data_base64'] as string,
    mimeType: 'image/png',
  };

  test('the session throws before any request is made, and a plain prompt still works', async () => {
    const faux = agent.app.faux!;
    const session = await probe(textOnly(faux.model), 'no-vision-probe');
    faux.load('no-vision-probe', [{ text: ['plain text is fine'] }]);
    await assert.rejects(() => session.prompt('what is this?', [crop]), NoVisionModelError);
    assert.equal(faux.requests('no-vision-probe'), 0, 'no model request was made with a picture');
    await session.prompt('and without a picture?');
    assert.equal(faux.requests('no-vision-probe'), 1, 'the same session still answers text');
    assert.equal(faux.seen('no-vision-probe')[0]!.images, 0);
    session.dispose();
  });

  test('a vision model is handed the picture by the same call', async () => {
    const faux = agent.app.faux!;
    const session = await probe(faux.model, 'vision-probe');
    faux.load('vision-probe', [{ text: ['I can see it'] }]);
    await session.prompt('what is this?', [crop]);
    assert.equal(faux.seen('vision-probe')[0]!.images, 1);
    session.dispose();
  });

  test('the agent refuses to boot with a text-only model for the image ask', async () => {
    await assert.rejects(
      () => startAgent({ apiOrigin: tools.origin, modelOverride: textOnly }),
      (error: unknown) => {
        assert.ok(error instanceof BootError);
        assert.match(error.message, /does not accept images/);
        return true;
      },
    );
  });
});
