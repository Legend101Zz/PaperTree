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
    // The SSE `citations` event has no locator.
    citations: message.citations.map(({ locator: _l, ...rest }) => rest),
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
    expect(merged[1]?.createdAt).toBe(answer1.created_at);
    // The stored copy holds every citation the run minted, with its locator.
    expect(merged[1]?.citations).toEqual(answer1.citations);
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

describe('stored answers at other levels (v0.3)', () => {
  const at = (over: Partial<Message>): Message => ({ ...answer1, ...over });
  const rootMsg = at({ message_id: 'msg_r', ordinal: 1, level: 'familiar', relevel_of: null });
  const expert = at({
    message_id: 'msg_x',
    ordinal: 2,
    level: 'expert',
    relevel_of: 'msg_r',
    content: 'Expert.',
  });
  const simple = at({
    message_id: 'msg_n',
    ordinal: 3,
    level: 'new',
    relevel_of: 'msg_r',
    content: 'Simple.',
  });

  it('keeps every level of a question: an answer followed by its sibling is not a replaced retry', () => {
    const merged = mergeStored([], [ask1, rootMsg, expert, simple]);
    expect(merged.map((m) => [m.role, m.level ?? null, m.relevelOf ?? null])).toEqual([
      ['user', null, null],
      ['assistant', 'familiar', null],
      ['assistant', 'expert', 'msg_r'],
      ['assistant', 'new', 'msg_r'],
    ]);
  });

  it('a retried sibling replaces the attempt it retried; a retried root still does too', () => {
    const retry = at({
      message_id: 'msg_x2',
      ordinal: 3,
      level: 'expert',
      relevel_of: 'msg_r',
      content: 'Expert again.',
    });
    const merged = mergeStored([], [ask1, rootMsg, expert, retry]);
    expect(merged.filter((m) => m.role === 'assistant').map((m) => m.text)).toEqual([
      rootMsg.content,
      'Expert again.',
    ]);
    const rootRetry = at({
      message_id: 'msg_r2',
      ordinal: 2,
      level: 'familiar',
      relevel_of: null,
      content: 'Retried.',
    });
    expect(
      mergeStored([], [ask1, rootMsg, rootRetry])
        .filter((m) => m.role === 'assistant')
        .map((m) => m.text),
    ).toEqual(['Retried.']);
  });

  it('keeps the level the reader asked for until the server names one (an older API sends none)', () => {
    const liveSibling = live(expert, { level: 'expert', relevelOf: 'msg_r', messageId: 'msg_x' });
    const stored = { ...expert, level: null, relevel_of: null };
    const merged = mergeStored([liveSibling], [ask1, rootMsg, stored as Message]);
    const sib = merged.find((m) => m.messageId === 'msg_x');
    expect(sib?.level).toBe('expert');
    expect(sib?.relevelOf).toBe('msg_r');
  });
});
