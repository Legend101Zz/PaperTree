/**
 * The eight recorded streams (contracts/agent/fixtures/*.sse) as faux scripts: for each, the run
 * request, what the model does (its turns), and what the API's tool routes answer.
 *
 * The MODEL side of each script is read back out of the recording — its text deltas, its per-message
 * usage, and (where the recording keeps entries) its thinking, tool calls and the tool texts it was
 * given. Everything else in the stream — the statuses and their labels, where `usage` falls, which
 * text reaches the caller, `done`'s status, error, counts, handles, markers and entries — is what
 * the agent must produce by itself. Where a recording keeps no entries (tool-budget, auth-error),
 * the model's tool calls are written here to match the recorded statuses.
 */
import type { FauxStep, FauxTurn, FauxUsage } from '../../src/faux.ts';

import { type FixtureName, readExample, readFixture } from './contract.ts';
import type { ToolAnswer, ToolHit } from './harness.ts';

export interface Scenario {
  readonly name: FixtureName;
  /** The request, with `tool.base_url` still to be pointed at the test's tool server. */
  readonly request: Record<string, any>;
  readonly steps: readonly FauxStep[];
  readonly tools: (hit: ToolHit) => ToolAnswer;
  /** DELETE the run once this many text events arrived (aborted-partial). */
  readonly cancelAfterTexts?: number;
}

const DATAMARK = '^7f3a91c2';

function usage(u: Record<string, number | null> | undefined): FauxUsage {
  if (!u) throw new Error('the recording has fewer usage events than the script needs');
  return {
    input: Number(u['input']),
    output: Number(u['output']),
    cacheRead: Number(u['cache_read']),
    cacheWrite: Number(u['cache_write']),
    reasoning: u['reasoning'] === null ? null : Number(u['reasoning']),
    cost: Number(u['cost_usd_est']),
  };
}

/** The recorded assistant message `index` in `entries`, as a turn (text comes from the deltas). */
function recordedTurn(entry: Record<string, any>, extra: Partial<FauxTurn>): FauxTurn {
  const content = entry['message']['content'] as Array<Record<string, any>>;
  const thinking = content.find((c) => c['type'] === 'thinking')?.['thinking'] as
    string | undefined;
  const toolCalls = content
    .filter((c) => c['type'] === 'toolCall')
    .map((c) => ({
      id: String(c['id']),
      name: String(c['name']),
      arguments: c['arguments'] as Record<string, unknown>,
    }));
  return {
    ...(thinking === undefined ? {} : { thinking }),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...extra,
  };
}

function toolText(entry: Record<string, any>): string {
  return String((entry['message']['content'] as Array<Record<string, any>>)[0]?.['text'] ?? '');
}

const call = (tool: string, args: Record<string, unknown>) => ({ name: tool, arguments: args });
const ok = (text: string, handles: string[]): ToolAnswer => ({
  status: 200,
  body: { text, handles },
});
const notFound: ToolAnswer = {
  status: 404,
  body: { detail: 'No such passage.', code: 'not_found', retryable: false },
};

/** An `ask` request with the explain example's seed (b1, b2), for the recordings that are asks. */
function askWithSeed(
  runId: string,
  requestId: string,
  question = 'Explain this passage.',
): Record<string, any> {
  const explain = readExample('explain');
  return {
    ...explain,
    run_id: runId,
    request_id: requestId,
    kind: 'ask',
    prompt_version: 'ask-v1',
    question,
    tool: {
      ...explain['tool'],
      base_url: explain['tool']['base_url'].replace(explain['run_id'], runId),
    },
  };
}

function header(handle: string, page: string, section: string, type = 'paragraph'): string {
  return `[${handle}] (${page} · ${section} · ${type})\n<paper_text channel="paper" trust="untrusted">\n${DATAMARK} passage ${DATAMARK} ${handle} ${DATAMARK}\n</paper_text>`;
}

export function scenario(name: FixtureName): Scenario {
  const fx = readFixture(name);
  const entries = fx.done.entries;
  const run = String(fx.events[0]?.data['run_id']);
  switch (name) {
    case 'explain-ok': {
      const request = readExample('explain');
      return {
        name,
        request,
        steps: [
          recordedTurn(entries[1]!, { usage: usage(fx.usages[0]) }),
          recordedTurn(entries[3]!, { text: fx.texts, usage: usage(fx.usages[1]) }),
        ],
        tools: (hit) =>
          hit.path.endsWith('/search') ? ok(toolText(entries[2]!), ['b3', 'b4']) : notFound,
      };
    }
    case 'followup-ok': {
      const request = readExample('followup');
      return {
        name,
        request,
        steps: [
          recordedTurn(entries[5]!, { usage: usage(fx.usages[0]) }),
          recordedTurn(entries[7]!, { text: fx.texts, usage: usage(fx.usages[1]) }),
        ],
        tools: (hit) =>
          hit.path.endsWith('/search') ? ok(toolText(entries[6]!), ['b5', 'b6']) : notFound,
      };
    }
    case 'summary-ok': {
      const request = readExample('summary');
      return {
        name,
        request,
        steps: [
          recordedTurn(entries[1]!, { usage: usage(fx.usages[0]) }),
          recordedTurn(entries[3]!, { usage: usage(fx.usages[1]) }),
          recordedTurn(entries[6]!, { text: fx.texts, usage: usage(fx.usages[2]) }),
        ],
        tools: (hit) => {
          if (hit.path.endsWith('/outline'))
            return ok(toolText(entries[2]!), ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']);
          if (hit.path.endsWith('/sections/b3'))
            return ok(toolText(entries[4]!), ['b8', 'b9', 'b10', 'b11', 'b12']);
          if (hit.path.endsWith('/sections/b6')) return ok(toolText(entries[5]!), ['b13', 'b14']);
          return notFound;
        },
      };
    }
    case 'tool-budget': {
      // 15 seed passages; the labels the recording shows for M1's get_section / get_passage come from them.
      const base = askWithSeed(
        run,
        'req_01K63AHD4F6J8M0P2R4T6W8Y0B',
        'How does YOLO do on VOC 2012, and against Fast R-CNN?',
      );
      const passages = Array.from({ length: 15 }, (_, i) => {
        const h = `b${String(i + 1)}`;
        const label =
          h === 'b12'
            ? 'p. 6 · 4. Experiments · heading'
            : h === 'b15'
              ? 'p. 7 · 4.2. VOC 2007 Error Analysis · paragraph'
              : 'p. 1 · Abstract · paragraph';
        return { handle: h, label, text: `${DATAMARK} seed ${DATAMARK} ${h} ${DATAMARK}` };
      });
      const request = { ...base, seed: { ...base['seed'], passages } };
      return {
        name,
        request,
        steps: [
          {
            toolCalls: [
              call('search_passages', { query: 'mAP on VOC 2012' }),
              call('get_section', { handle: 'b12' }),
              call('get_passage', { handle: 'b15' }),
            ],
            usage: usage(fx.usages[0]),
          },
          {
            toolCalls: [
              call('search_passages', { query: 'Fast R-CNN combined' }),
              call('get_section', { handle: 'b18' }),
              call('get_passage', { handle: 'b21' }),
            ],
            usage: usage(fx.usages[1]),
          },
          {
            toolCalls: [
              call('search_passages', { query: 'Picasso dataset' }),
              call('get_section', { handle: 'b24' }),
              call('get_passage', { handle: 'b25' }),
            ],
            usage: usage(fx.usages[2]),
          },
          {
            toolCalls: [call('search_passages', { query: 'one more search' })],
            usage: usage(fx.usages[3]),
          },
          { text: ['THIS TURN MUST NEVER BE REQUESTED'] },
        ],
        tools: (hit) => {
          const q = hit.query.get('q') ?? '';
          if (hit.path.endsWith('/search') && q === 'mAP on VOC 2012')
            return ok(
              [
                header('b16', 'p. 6', '4.1. Comparison'),
                header('b17', 'p. 6', '4.1. Comparison'),
              ].join('\n\n'),
              ['b16', 'b17'],
            );
          if (hit.path.endsWith('/sections/b12')) {
            return ok(
              [
                header('b18', 'p. 7', '4.3. Combining Fast R-CNN and YOLO', 'heading'),
                header('b19', 'p. 7', '4.3. Combining Fast R-CNN and YOLO'),
                header('b20', 'p. 7', '4.3. Combining Fast R-CNN and YOLO'),
                header('b21', 'p. 8', '4.4. VOC 2012 Results'),
              ].join('\n\n'),
              ['b18', 'b19', 'b20', 'b21'],
            );
          }
          if (hit.path.endsWith('/passages/b15'))
            return ok(header('b15', 'p. 7', '4.2. VOC 2007 Error Analysis'), []);
          if (hit.path.endsWith('/search') && q === 'Fast R-CNN combined')
            return ok(
              [
                header('b22', 'p. 7', '4.3. Combining Fast R-CNN and YOLO'),
                header('b23', 'p. 7', '4.3. Combining Fast R-CNN and YOLO'),
              ].join('\n\n'),
              ['b22', 'b23'],
            );
          if (hit.path.endsWith('/sections/b18'))
            return ok(header('b24', 'p. 8', '4.5. Generalizability', 'heading'), ['b24']);
          if (hit.path.endsWith('/passages/b21'))
            return ok(header('b21', 'p. 8', '4.4. VOC 2012 Results'), []);
          if (hit.path.endsWith('/search') && q === 'Picasso dataset')
            return ok(
              [
                header('b25', 'p. 8', '4.5. Generalizability'),
                header('b26', 'p. 8', '4.5. Generalizability'),
              ].join('\n\n'),
              ['b25', 'b26'],
            );
          if (hit.path.endsWith('/sections/b24'))
            return ok(header('b25', 'p. 8', '4.5. Generalizability'), []);
          return notFound;
        },
      };
    }
    case 'stall-timeout': {
      const request = askWithSeed(run, 'req_01K63AJE5G7K9N1Q3S5V7X9Z1C');
      // The recording's idle is 20 s; this replay uses a short one so the suite stays fast.
      return {
        name,
        request: { ...request, limits: { ...request['limits'], idle_ms: 600 } },
        steps: [{ text: fx.texts, stallAfterDeltas: fx.texts.length }],
        tools: () => notFound,
      };
    }
    case 'auth-error': {
      return {
        name,
        request: askWithSeed(run, 'req_01K63AKF6H8M0P2R4T6W8Y0A2D'),
        steps: [
          {
            stopReason: 'error',
            errorMessage:
              '401 {"type":"error","error":{"type":"authentication_error","message":"login fail: Please carry the API secret key in the \'X-Api-Key\' field of the request header"},"request_id":"0705c5d1"}',
          },
          { text: ['THIS TURN MUST NEVER BE REQUESTED'] },
        ],
        tools: () => notFound,
      };
    }
    case 'aborted-partial': {
      const explain = readExample('explain');
      const request = {
        ...explain,
        run_id: run,
        request_id: 'req_01K63AMG7J9N1Q3S5V7X9Z1B3E',
        kind: 'ask',
        prompt_version: 'ask-v1',
        seed: null,
        question: 'What is the confidence score?',
        tool: {
          ...explain['tool'],
          base_url: explain['tool']['base_url'].replace(explain['run_id'], run),
        },
      };
      return {
        name,
        request,
        steps: [
          recordedTurn(entries[1]!, { usage: usage(fx.usages[0]) }),
          { text: fx.texts, stallAfterDeltas: fx.texts.length },
        ],
        tools: (hit) =>
          hit.path.endsWith('/search') ? ok(toolText(entries[2]!), ['b7']) : notFound,
        cancelAfterTexts: fx.texts.length,
      };
    }
    case 'upstream-503-retry-ok': {
      return {
        name,
        request: askWithSeed(run, 'req_01K63ANH8K0P2R4T6W8Y0A2C4F'),
        steps: [
          {
            stopReason: 'error',
            errorMessage:
              '503 {"type":"error","error":{"type":"overloaded_error","message":"busy"}}',
          },
          { text: fx.texts, usage: usage(fx.usages[1]) },
        ],
        tools: () => notFound,
      };
    }
  }
}
