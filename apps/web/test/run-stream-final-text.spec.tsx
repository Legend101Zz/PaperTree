/**
 * v0.3 W6 (live = stored): the explain run stream replaces the streamed text with `done.final_text`
 * when the agent repaired or removed a ```mermaid fence after the stream ended, and leaves it
 * alone when `final_text` is null. `useRunStream` is driven with a scripted SSE generator and the
 * real explain reducer.
 */
import { act, renderHook } from '@testing-library/react';
import { useReducer, useRef } from 'react';
import { describe, expect, it } from 'vitest';

import { useRunStream } from '@/features/explain/hooks/useRunStream';
import { buildAnswer } from '@/features/explain/model/answer';
import { threadHandles } from '@/features/explain/model/passages';
import { explainReducer, INITIAL_STATE, type ExplainState } from '@/features/explain/model/state';
import type { SseEvent } from '@/lib/api/types';

const FENCE = 'flowchart TD\n  a["One"] --> b["Two"]\n  b --> c["Three"]';
const BROKEN = 'flowchart TD\n  a --> --> b\n  b --> c';
const wrap = (fence: string | null): string =>
  `## TL;DR\nShort.\n\n## How it works\nSee:${fence === null ? '' : `\n\`\`\`mermaid\n${fence}\n\`\`\``}\nAfter.`;

function* script(streamed: string, finalText: string | null): Generator<SseEvent> {
  yield {
    event: 'run',
    data: {
      run_id: 'run_1',
      thread_id: 'thr_1',
      user_message_id: 'u1',
      message_id: 'm1',
      generation: 1,
    },
  };
  yield { event: 'text', data: { delta: streamed } };
  yield { event: 'citations', data: { items: [] } };
  yield {
    event: 'done',
    data: { status: 'complete', error: null, message_id: 'm1', final_text: finalText },
  };
}

async function* open(events: Generator<SseEvent>): AsyncGenerator<SseEvent> {
  for (const event of events) yield event;
}

function mount() {
  return renderHook(() => {
    const [state, dispatch] = useReducer(explainReducer, { ...INITIAL_STATE, epoch: 1 });
    const stateRef = useRef<ExplainState>(state);
    stateRef.current = state;
    const epochRef = useRef(1);
    const threadAbort = useRef<AbortController | null>(null);
    const stream = useRunStream({ dispatch, stateRef, epochRef, threadAbort });
    return { state, stream };
  });
}

const answerOf = (state: ExplainState) => {
  const message = state.messages.find((m) => m.role === 'assistant');
  if (message === undefined) throw new Error('no answer');
  return message;
};

describe('done.final_text', () => {
  it('replaces the streamed text with the stored (repaired) one', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.stream.startTurn(1, 'Why?', true, () =>
        open(script(wrap(BROKEN), wrap(FENCE))),
      );
    });
    const message = answerOf(result.current.state);
    expect(message.status).toBe('complete');
    expect(message.text).toBe(wrap(FENCE));
    expect(message.text).not.toContain('--> -->');
  });

  it('takes a dropped fence out of the text', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.stream.startTurn(1, 'Why?', true, () =>
        open(script(wrap(BROKEN), wrap(null))),
      );
    });
    const message = answerOf(result.current.state);
    expect(message.text).not.toContain('mermaid');
    const blocks = buildAnswer(message, threadHandles([])).blocks;
    expect(blocks.some((b) => b.k === 'mermaid')).toBe(false);
  });

  it('leaves the streamed text as it is when final_text is null', async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.stream.startTurn(1, 'Why?', true, () => open(script(wrap(FENCE), null)));
    });
    expect(answerOf(result.current.state).text).toBe(wrap(FENCE));
  });
});
