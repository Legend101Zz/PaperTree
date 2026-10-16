/**
 * The golden thread of #202: the real stored explain thread of frame 04 ("Attention Is All You
 * Need", thr_01M508X9PC9K9HKHSVB2J9W1A1), read through the S4a API. Where it came from is in the
 * JSON's `_source`. Typed here so the specs read it as the wire's `ThreadDetail`.
 */
import raw from './attention-thread.json';

import type { ThreadDetail } from '@/features/explain/api/threads';
import { fromStored, type ThreadMessage } from '@/features/explain/model/messages';

export const GOLDEN = raw as unknown as ThreadDetail;

/** The golden thread's messages as the panel holds them once stored (each answer with its ask). */
export function goldenMessages(): ThreadMessage[] {
  let ask = '';
  return GOLDEN.messages.map((m) => {
    if (m.role === 'user') ask = m.content;
    return fromStored(m, m.role === 'user' ? '' : ask);
  });
}
