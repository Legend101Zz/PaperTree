import { useEffect, useState } from 'react';

import { loadDocument, pdfSourceFor, type PaperRef } from '@/lib/paperSource';

import { failureOf, type Failure } from '../model/failure';

import type { IndexedDocument } from '@papertree/anchoring';

/** While a paper is still being read, try again this often. */
const RETRY_MS = 4000;

/** The loads' results, failures and retries. */
export interface PaperSource {
  readonly pdfSource: string | ArrayBuffer | null;
  readonly pdfFailure: Failure | null;
  readonly doc: IndexedDocument | null;
  readonly docFailure: Failure | null;
  readonly retryDoc: () => void;
  readonly retryPdf: () => void;
}

/**
 * The parse and the PDF, loaded independently: Source works from the PDF alone while the parse is
 * still coming, so neither waits on the other. `paper` must be referentially stable (the workspace
 * memoises it on its key), or every render would refetch.
 * @param paper The paper, referentially stable.
 * @returns The parse, the PDF, their failures and their retries.
 */
export function usePaperSource(paper: PaperRef): PaperSource {
  const [pdfSource, setPdfSource] = useState<string | ArrayBuffer | null>(null);
  const [pdfFailure, setPdfFailure] = useState<Failure | null>(null);
  const [doc, setDoc] = useState<IndexedDocument | null>(null);
  const [docFailure, setDocFailure] = useState<Failure | null>(null);
  const [docAttempt, setDocAttempt] = useState(0);
  const [pdfAttempt, setPdfAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDocument(paper).then(
      (indexed) => {
        if (cancelled) return;
        setDoc(indexed);
        setDocFailure(null);
      },
      (error: unknown) => {
        if (!cancelled) setDocFailure(failureOf(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [paper, docAttempt]);

  useEffect(() => {
    let cancelled = false;
    pdfSourceFor(paper).then(
      (source) => {
        if (cancelled) return;
        setPdfSource(source);
        setPdfFailure(null);
      },
      (error: unknown) => {
        if (!cancelled) setPdfFailure(failureOf(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [paper, pdfAttempt]);

  // Still being read: try again on our own, so the reader need not reload.
  useEffect(() => {
    const waiting = docFailure?.kind === 'not_parsed' || pdfFailure?.kind === 'not_parsed';
    if (!waiting) return undefined;
    const timer = setTimeout(() => {
      if (docFailure?.kind === 'not_parsed') setDocAttempt((n) => n + 1);
      if (pdfFailure?.kind === 'not_parsed') setPdfAttempt((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [docFailure, pdfFailure]);

  return {
    pdfSource,
    pdfFailure,
    doc,
    docFailure,
    retryDoc: () => setDocAttempt((n) => n + 1),
    retryPdf: () => setPdfAttempt((n) => n + 1),
  };
}
