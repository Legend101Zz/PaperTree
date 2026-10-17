import { describe, expect, it, vi } from 'vitest';

import { buildExchanges } from './exchange';
import { fromStored, mergeStored, type ThreadMessage } from './messages';
import { GOLDEN } from '../../../../test/fixtures/attention-thread';

import type { Message } from '@/lib/api/types';

const [ask1, answer1, ask2, answer2] = GOLDEN.messages as [Message, Message, Message, Message];

/** The live copy of a stored message, as the controller held it before the stored read. */
function live(message: Message, over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    ...fromStored(message, message.role === 'assistant' ? 'Explain this passage.' : ''),
    key: `live-${String(message.ordinal)}`,
    // The SSE `citations` event has no locator and the live message no coverage.
    citations: message.citations.map(({ locator: _l, ...rest }) => rest),
    coverage: null,
    createdAt: null,
    ...over,
  };
}

describe('mergeStored: the live stream and the stored thread', () => {
  it('a settled first answer takes the stored copy under its live key; the stored ask appears', () => {
    const shown = live(answer1);
    const merged = mergeStored([shown], [ask1, answer1]);
    expect(merged.map((m) => m.key)).toEqual([`s:${ask1.message_id}`, 'live-1']);
    expect(merged[0]?.text).toBe('Explain this passage.');
    expect(merged[1]?.coverage?.citations).toBe(11);
    expect(merged[1]?.createdAt).toBe(answer1.created_at);
    // The markers on screen were drawn from the live citations: they are kept, so no tab changes
    // under the reader (#252); the stored locators show the next time the thread is opened.
    expect(merged[1]?.citations).toHaveLength(shown.citations.length);
    merged[1]?.citations.forEach((c, i) => expect(c).toBe(shown.citations[i]));
  });

  it('the stored verdict reaches the live markers: "not verified" is never lost (#252)', () => {
    const shown = live(answer1); // the live citations say supported: true
    const verdicts = {
      ...answer1,
      citations: answer1.citations.map((c) => ({ ...c, supported: false })),
    };
    const merged = mergeStored([shown], [ask1, verdicts]);
    // Same objects where nothing changed is not required; same passages, numbers and tabs are.
    expect(merged[1]?.citations.map((c) => [c.citation_id, c.supported, c.locator])).toEqual(
      shown.citations.map((c) => [c.citation_id, false, undefined]),
    );
    const before = buildExchanges([fromStored(ask1, ''), shown], null)[0]?.model;
    const after = buildExchanges(merged, null)[0]?.model;
    expect(before?.trace.map((r) => r.status)).toEqual(['cited', 'cited', 'cited', 'cited']);
    expect(after?.trace.map((r) => [r.n, r.page, r.para, r.status])).toEqual(
      before?.trace.map((r) => [r.n, r.page, r.para, 'not-verified']),
    );
    expect([...(after?.markers.values() ?? [])].every((m) => m.notVerified)).toBe(true);
  });

  it('warns in development, and only there, when the live and stored citations differ', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shown = live(answer1);
    const fewer = { ...answer1, citations: answer1.citations.slice(0, 2) };
    mergeStored([shown], [ask1, fewer]);
    expect(warn).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'development');
    const merged = mergeStored([shown], [ask1, fewer]);
    expect(warn).toHaveBeenCalledTimes(1);
    // The markers on screen still do not move.
    expect(merged[1]?.citations.map((c) => c.citation_id)).toEqual(
      shown.citations.map((c) => c.citation_id),
    );
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it('a settled answer that showed no citations live takes the stored ones (#252)', () => {
    const stopped = live(answer1, { citations: [], stopped: true, status: 'aborted' });
    const merged = mergeStored([stopped], [ask1, { ...answer1, status: 'aborted' }]);
    expect(merged[1]?.citations[0]?.locator?.para_index).toBe(1);
    expect(merged[1]?.stopped).toBe(true);
  });

  it('keeps the live message while either copy is still streaming', () => {
    const streaming = live(answer1, { status: 'streaming', text: 'The passage' });
    expect(mergeStored([streaming], [ask1, answer1])[1]).toBe(streaming);
    const stale = { ...answer1, status: 'streaming' as const, content: 'The' };
    const done = live(answer1);
    expect(mergeStored([done], [ask1, stale])[1]).toBe(done);
  });

  it('never shows a message twice: a follow-up asked after the read follows it', () => {
    const followAsk = live(ask2, { messageId: null });
    const followAnswer = live(answer2, { status: 'streaming', messageId: 'msg_new' });
    const merged = mergeStored(
      [live(ask1), live(answer1), followAsk, followAnswer],
      [ask1, answer1],
    );
    expect(merged.map((m) => m.key)).toEqual(['live-0', 'live-1', 'live-2', 'live-3']);
  });

  it('matches a live ask by its server id once the run event named it', () => {
    const merged = mergeStored([live(answer1), live(ask2), live(answer2)], GOLDEN.messages);
    expect(merged.map((m) => m.key)).toEqual([
      `s:${ask1.message_id}`,
      'live-1',
      'live-2',
      'live-3',
    ]);
  });

  it('drops an answer a retry replaced, and keeps the reader’s Stop', () => {
    const failed: Message = { ...answer2, message_id: 'msg_failed', status: 'error', ordinal: 3 };
    const retried: Message = { ...answer2, ordinal: 4 };
    const merged = mergeStored(
      [live(answer1), live(ask2), live(answer2, { stopped: true })],
      [ask1, answer1, ask2, failed, retried],
    );
    expect(merged.map((m) => m.messageId)).not.toContain('msg_failed');
    expect(merged).toHaveLength(4);
    expect(merged[3]?.stopped).toBe(true);
  });

  it('reads a stored failure as the panel’s failure', () => {
    const aborted = fromStored({ ...answer1, status: 'aborted', error: null }, 'q');
    expect(aborted.failure).toEqual({ code: 'aborted', retryable: true });
    const failed = fromStored(
      { ...answer1, status: 'error', error: { code: 'timeout', retryable: true, message: 'x' } },
      'q',
    );
    expect(failed.failure).toEqual({ code: 'timeout', retryable: true });
    expect(fromStored(answer1, 'q').failure).toBeNull();
  });
});

describe('mergeStored: a read that lands before the run event names the ids (review 1.5)', () => {
  it('leaves out the stored copy of the turn in flight, so it is never shown twice', () => {
    const askInFlight = live(ask2, { key: 'm9', messageId: null });
    const answerInFlight = live(answer2, {
      key: 'm10',
      messageId: null,
      status: 'streaming',
      text: 'The paper',
      citations: [],
    });
    const serverMid = [ask1, answer1, ask2, { ...answer2, status: 'streaming' as const }];
    const merged = mergeStored(
      [fromStored(ask1, ''), fromStored(answer1, 'q'), askInFlight, answerInFlight],
      serverMid,
    );
    expect(merged.map((m) => m.key)).toEqual([
      `s:${ask1.message_id}`,
      `s:${answer1.message_id}`,
      'm9',
      'm10',
    ]);
  });

  it('keeps the stored generation, which the passage key is built from', () => {
    expect(fromStored(answer1, 'q').generation).toBe(answer1.generation);
  });
});
