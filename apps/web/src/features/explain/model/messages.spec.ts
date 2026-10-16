import { describe, expect, it } from 'vitest';

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
    const merged = mergeStored([live(answer1)], [ask1, answer1]);
    expect(merged.map((m) => m.key)).toEqual([`s:${ask1.message_id}`, 'live-1']);
    expect(merged[0]?.text).toBe('Explain this passage.');
    expect(merged[1]?.citations[0]?.locator?.para_index).toBe(1);
    expect(merged[1]?.coverage?.citations).toBe(11);
    expect(merged[1]?.createdAt).toBe(answer1.created_at);
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
