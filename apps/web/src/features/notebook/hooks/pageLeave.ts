/**
 * The notes being typed when the page is left (S5c, #208). A `NoteEditor` registers here while it
 * is open, so the saver's `pagehide` handler can make every open editor commit FIRST and then send
 * everything owed in one planned flush (`model/leave.ts`), and so `beforeunload` can see a note too
 * long for any keepalive request before it is lost.
 */

/** An open editor: commit its words, or read them. */
export interface OpenEditor {
  /** Commit what was typed (idempotent: an editor commits once). */
  readonly commit: () => void;
  /** The words typed so far. */
  readonly text: () => string;
}

const open = new Set<OpenEditor>();

/**
 * Registers an open editor until the returned function is called.
 *
 * @param editor - The editor's commit and text.
 * @returns A function that unregisters it.
 */
export function registerEditor(editor: OpenEditor): () => void {
  open.add(editor);
  return () => {
    open.delete(editor);
  };
}

/** Commits every open editor (the page is being left). */
export function commitOpenEditors(): void {
  for (const editor of [...open]) editor.commit();
}

/**
 * The words in every open editor, for the leave warning.
 *
 * @returns One string per open editor.
 */
export function openEditorTexts(): string[] {
  return [...open].map((e) => e.text());
}
