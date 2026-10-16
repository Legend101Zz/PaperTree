/**
 * RFIX R6 — which part broke when pdf.js could not open a document.
 */
import { describe, expect, it } from 'vitest';

import { classifyPdfFailure, PdfEngineError } from '../src/components/reader/pdfError';

function named(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('classifyPdfFailure', () => {
  it('blames the file for a bad or missing PDF', () => {
    expect(classifyPdfFailure(named('InvalidPDFException', 'Invalid PDF structure.'))).toBe(
      'document',
    );
    expect(classifyPdfFailure(named('MissingPDFException', 'Missing PDF'))).toBe('document');
    expect(classifyPdfFailure(named('PasswordException', 'No password given'))).toBe('document');
  });

  it('blames the engine when the worker or a script could not be loaded', () => {
    expect(
      classifyPdfFailure(
        new Error(
          'Setting up fake worker failed: "Failed to fetch dynamically imported module: http://x/pdf.worker.min.mjs".',
        ),
      ),
    ).toBe('engine');
    expect(classifyPdfFailure(new TypeError('Failed to fetch'))).toBe('engine');
    expect(classifyPdfFailure(new Error('Loading chunk 123 failed.'))).toBe('engine');
    expect(classifyPdfFailure(new PdfEngineError('The PDF engine could not be loaded.'))).toBe(
      'engine',
    );
  });

  it('does not let a document exception be mistaken for an engine one by its words', () => {
    expect(
      classifyPdfFailure(named('InvalidPDFException', 'worker said: Invalid PDF structure.')),
    ).toBe('document');
  });

  it('keeps the file as the default for anything else', () => {
    expect(classifyPdfFailure(new Error('something odd'))).toBe('document');
    expect(classifyPdfFailure('nope')).toBe('document');
    expect(classifyPdfFailure(undefined)).toBe('document');
  });
});
