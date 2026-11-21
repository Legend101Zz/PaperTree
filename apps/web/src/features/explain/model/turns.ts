/**
 * Small pure helpers of the controller: the fixed asks, local message keys, a blank assistant
 * message, and the wording of a status. No state of its own beyond the key counter.
 */
import { EMPTY_PLATE } from '@/features/diagram';

import type { ThreadMessage } from '@/features/explain/model/messages';

export const DEFAULT_EXPLAIN_QUESTION = 'Explain this passage.';
/** What an image thread asks when the reader typed nothing (the server's own default). */
export const DEFAULT_IMAGE_QUESTION = 'Explain this figure.';
/** A Redraw's ask: it names the exchange it opens in the thread menu (#217). */
export const REDRAW_QUESTION = 'Redraw the diagram.';

let counter = 0;
/**
 * A new local message key, stable across the message's whole life.
 *
 * @returns The key.
 */
export const nextKey = (): string => `m${String((counter += 1))}`;

/**
 * An assistant message that has not started: streaming, empty, asking `question`.
 *
 * @param question The ask it answers.
 * @param diagram True for a diagram answer: it starts with an empty plate.
 * @param extra Live facts it carries from the start (its level, `quick`, a redraw's plate).
 * @returns The message.
 */
export function blankAssistant(
  question: string,
  diagram = false,
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  return {
    ...(diagram ? { diagram: EMPTY_PLATE } : {}),
    key: nextKey(),
    role: 'assistant',
    text: '',
    messageId: null,
    runId: null,
    status: 'streaming',
    stopped: false,
    label: null,
    failure: null,
    citations: [],
    usage: null,
    question,
    createdAt: new Date().toISOString(),
    generation: null,
    ...extra,
  };
}

/**
 * Whether a message is still being written.
 *
 * @param message A panel message.
 * @returns True while it streams.
 */
export function isStreaming(message: ThreadMessage): boolean {
  return message.status === 'streaming';
}

/**
 * The newest plate of the thread that has a server id: what a Redraw with nothing else redraws.
 *
 * @param messages The thread's messages.
 * @returns Its server id, or null.
 */
export function newestPlate(messages: readonly ThreadMessage[]): string | null {
  return messages.findLast((m) => m.diagram != null && m.messageId !== null)?.messageId ?? null;
}

/**
 * The label shown while the assistant works, from an SSE `status`; never a tool name or an id.
 *
 * @param status The status event's data.
 * @returns The label, or null when nothing is to be shown (the writing phase).
 */
export function statusLabel(status: {
  readonly phase: 'thinking' | 'tool' | 'retrying' | 'writing';
  readonly label?: string;
  readonly attempt?: number;
}): string | null {
  if (status.phase === 'writing') return null;
  if (status.label !== undefined && status.label.length > 0) return status.label;
  if (status.phase === 'thinking') return 'Thinking';
  if (status.phase === 'tool') return 'Reading the paper';
  return status.attempt !== undefined
    ? `The AI service hiccuped. Trying again (attempt ${String(status.attempt)})`
    : 'The AI service hiccuped. Trying again';
}
