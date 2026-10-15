/**
 * reader/pdfError — which part broke when pdf.js could not open a document.
 *
 * Two very different failures arrive as the same rejected promise: the FILE is bad
 * (`InvalidPDFException`, `MissingPDFException`, a password), or the ENGINE never started (the
 * worker script 404s or 503s, a chunk fails to load, the network drops). Telling a reader their
 * paper "may be damaged" when the server is missing a script blames the wrong thing and sends them
 * to re-upload a perfectly good file.
 */

export type PdfFailureKind = 'document' | 'engine';

const DOCUMENT_EXCEPTIONS = new Set([
  'InvalidPDFException',
  'MissingPDFException',
  'PasswordException',
  'FormatError',
]);

/** What pdf.js and the browser say when a script, worker or request could not be fetched. */
const ENGINE_MESSAGE =
  /fake worker|worker|dynamically imported module|importing a module script|failed to fetch|networkerror|load failed|loading chunk|chunkloaderror|script error|unexpected server response|unexpectedresponse/iu;

export class PdfEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdfEngineError';
  }
}

export function classifyPdfFailure(cause: unknown): PdfFailureKind {
  if (cause instanceof PdfEngineError) return 'engine';
  const name = typeof cause === 'object' && cause !== null ? (cause as { name?: unknown }).name : undefined;
  if (typeof name === 'string' && DOCUMENT_EXCEPTIONS.has(name)) return 'document';
  const message =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  if (ENGINE_MESSAGE.test(message)) return 'engine';
  return 'document';
}
