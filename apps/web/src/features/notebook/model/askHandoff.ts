/**
 * Ask about this's hand-off from the notebook to the reader (S5d, #209). The typed words go into
 * this tab's `sessionStorage` under a short key and the link carries only the key, so the words stay
 * out of the browser history and out of server and proxy logs; only where storage is blocked do
 * they travel in the URL (`ask_text`). The reader takes them ONCE (`takeAsk`): the stored copy is
 * removed as it is read, and the reader drops both parameters from its URL (`withoutAsk`). Pure:
 * the storage is passed in.
 */

/** The link's parameter holding the storage key. */
export const ASK_KEY_PARAM = 'ask';
/** The fallback parameter holding the words themselves (storage blocked). */
export const ASK_TEXT_PARAM = 'ask_text';
/** Most characters handed over: the question box takes 2,000, with room left for the question. */
export const ASK_MAX = 1600;

const PREFIX = 'papertree.notebook-ask.';

/** How the words travel: a storage key, or (storage blocked) the words. */
export type AskHandOff = { readonly key: string } | { readonly text: string };

/** The part of `Storage` the hand-off uses. */
export type AskStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const cut = (words: string): string =>
  words.length > ASK_MAX ? `${words.slice(0, ASK_MAX)}…` : words;

/**
 * Puts the words where the reader will find them.
 *
 * @param words - The typed words.
 * @param key - A fresh short id for this hand-off.
 * @param storage - This tab's `sessionStorage`, or null where it cannot be read.
 * @returns What the link carries.
 */
export function stashAsk(words: string, key: string, storage: AskStorage | null): AskHandOff {
  const text = cut(words);
  if (storage === null) return { text };
  try {
    storage.setItem(PREFIX + key, text);
    return { key };
  } catch {
    return { text }; // quota or a blocked store: the URL is the only way left
  }
}

/**
 * Takes the handed-over words, once.
 *
 * @param params - The reader's search parameters.
 * @param storage - This tab's `sessionStorage`, or null.
 * @returns The words, or null when there are none (or they were taken already).
 */
export function takeAsk(params: URLSearchParams, storage: AskStorage | null): string | null {
  const text = params.get(ASK_TEXT_PARAM);
  if (text !== null) return cut(text);
  const key = params.get(ASK_KEY_PARAM);
  if (key === null || storage === null) return null;
  try {
    const words = storage.getItem(PREFIX + key);
    storage.removeItem(PREFIX + key);
    return words;
  } catch {
    return null;
  }
}

/**
 * Whether the reader was opened with a hand-off.
 *
 * @param params - The reader's search parameters.
 * @returns True when either parameter is there.
 */
export function hasAsk(params: URLSearchParams): boolean {
  return params.has(ASK_KEY_PARAM) || params.has(ASK_TEXT_PARAM);
}

/**
 * The reader's query without the hand-off, for `router.replace`.
 *
 * @param params - The reader's search parameters.
 * @returns The rest of the query, without the `?` (empty when nothing is left).
 */
export function withoutAsk(params: URLSearchParams): string {
  const rest = new URLSearchParams(params);
  rest.delete(ASK_KEY_PARAM);
  rest.delete(ASK_TEXT_PARAM);
  return rest.toString();
}

/**
 * What the question box starts with: the words, quoted, and room to ask.
 *
 * @param words - The handed-over words.
 * @returns The draft.
 */
export function askDraft(words: string): string {
  return `From my notes: “${words}”\n\n`;
}
