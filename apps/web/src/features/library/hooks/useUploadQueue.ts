/**
 * useUploadQueue: the library's uploads, one at a time, with real progress, Cancel and a sentence
 * for every refusal (#195; the queue logic of v0.1's UploadDropzone, unchanged in behaviour).
 * Add papers, the drop-anywhere target and the empty library all feed `enqueue`; `UploadRow`
 * draws the queue under the header.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeUploadError } from '@/components/ui/errors';

/** Where one upload is. */
export type UploadItemState = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

/** One file in the queue. */
export interface UploadItem {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  /** 0..1. Stays at 0 while `queued`. */
  readonly progress: number;
  readonly state: UploadItemState;
  readonly error?: string;
}

/** A file refused before any bytes left, with the reason as the end of a sentence. */
export interface UploadRejection {
  readonly id: string;
  readonly fileName: string;
  readonly reason: string;
}

/** What a re-read of the library found after a cancelled upload. */
export type CancelOutcome = 'not-added' | 'in-library' | 'unknown';

/** The sentence each cancel outcome owes the person. */
export const CANCEL_COPY: Record<CancelOutcome, string> = {
  'not-added': 'Nothing was added to your library.',
  'in-library':
    'It had already uploaded; it is in your library. Delete it if you did not mean to add it.',
  unknown:
    'Cancelled. We could not check your library just now, so reload to see whether it was added.',
};

/** What `onUpload` receives for one file. */
export interface UploadContext {
  /** Call with 0..1 as bytes go out. */
  readonly onProgress: (fraction: number) => void;
  /** Aborted on cancel and on unmount. */
  readonly signal: AbortSignal;
}

/** Options for `useUploadQueue`. */
export interface UploadQueueOptions {
  readonly onUpload: (file: File, context: UploadContext) => Promise<void>;
  /**
   * After a Cancel, asks the library whether the server kept the file anyway (the abort can land
   * after the whole body arrived). Omit and the row says only that nothing was added.
   */
  readonly onCancelled?: (file: File) => Promise<CancelOutcome>;
  /** Rejected before any bytes leave, with the reason shown. Omit for no limit. */
  readonly maxBytes?: number;
}

/** The queue, its sentences and its actions. */
export interface UploadQueue {
  readonly items: readonly UploadItem[];
  readonly rejections: readonly UploadRejection[];
  /** The last thing worth saying to a screen reader. */
  readonly announcement: string;
  readonly enqueue: (files: readonly File[]) => void;
  readonly cancel: (id: string) => void;
  readonly dismiss: (id: string) => void;
}

const MEGABYTE = 1024 * 1024;

/**
 * "340 KB", "2.2 MB".
 *
 * @param bytes - A file size.
 * @returns The size in words.
 */
export function formatBytes(bytes: number): string {
  if (bytes < MEGABYTE) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/**
 * Split chosen files into those to upload and those refused before any bytes leave: not a PDF (a
 * courtesy check; the server re-checks the bytes, 415), or over the size limit.
 *
 * @param files - What was chosen or dropped.
 * @param maxBytes - The size limit, if any.
 * @param nextId - Mints a queue id.
 * @returns The accepted files with ids, and the refusals with their reasons.
 */
export function screenFiles(
  files: readonly File[],
  maxBytes: number | undefined,
  nextId: () => string,
): { accepted: { id: string; file: File }[]; refused: UploadRejection[] } {
  const accepted: { id: string; file: File }[] = [];
  const refused: UploadRejection[] = [];
  for (const file of files) {
    const id = nextId();
    const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!pdf) {
      refused.push({
        id,
        fileName: file.name,
        reason: 'is not a PDF. Choose a file that ends in .pdf.',
      });
    } else if (maxBytes !== undefined && file.size > maxBytes) {
      const reason = `is larger than ${formatBytes(maxBytes)}. Choose a smaller PDF.`;
      refused.push({ id, fileName: file.name, reason });
    } else {
      accepted.push({ id, file });
    }
  }
  return { accepted, refused };
}

/**
 * The upload queue.
 *
 * THE StrictMode FREEZE (#141): `mountedRef` is set to true on EVERY mount, because StrictMode's
 * mount → cleanup → mount must end mounted; a ref left false dropped every later update and froze
 * a row on "Waiting to upload".
 *
 * @param options - The upload call, the cancel re-read and the size limit.
 * @returns The queue.
 */
export function useUploadQueue({
  onUpload,
  onCancelled,
  maxBytes,
}: UploadQueueOptions): UploadQueue {
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [rejections, setRejections] = useState<readonly UploadRejection[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const queueRef = useRef<{ id: string; file: File }[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const drainingRef = useRef(false);
  const mountedRef = useRef(false);
  const seqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    if (!mountedRef.current) return;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const say = useCallback((text: string) => {
    if (mountedRef.current) setAnnouncement(text);
  }, []);

  const uploadOne = useCallback(
    async ({ id, file }: { id: string; file: File }) => {
      const controller = new AbortController();
      controllersRef.current.set(id, controller);
      patch(id, { state: 'uploading', progress: 0 });
      try {
        await onUpload(file, {
          onProgress: (fraction) => patch(id, { progress: Math.max(0, Math.min(1, fraction)) }),
          signal: controller.signal,
        });
        // The server row is already on the shelf (`onUpload` puts it there before it resolves),
        // so the spine says what happens next and this row goes at once (#141).
        if (mountedRef.current) setItems((prev) => prev.filter((item) => item.id !== id));
        say(`${file.name} uploaded. Queued for reading.`);
      } catch (error) {
        const aborted = controller.signal.aborted;
        patch(id, {
          state: aborted ? 'cancelled' : 'failed',
          error: aborted ? 'Checking your library...' : describeUploadError(error),
        });
        if (aborted) {
          // The abort may have landed after the server had the whole body: re-read, then say so.
          let outcome: CancelOutcome = 'not-added';
          if (onCancelled !== undefined) {
            outcome = await onCancelled(file).catch((): CancelOutcome => 'unknown');
          }
          patch(id, { error: CANCEL_COPY[outcome] });
        }
        say(aborted ? `${file.name} cancelled.` : `${file.name} failed to upload.`);
      } finally {
        controllersRef.current.delete(id);
      }
    },
    [onUpload, onCancelled, patch, say],
  );

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      for (let next = queueRef.current.shift(); next; next = queueRef.current.shift()) {
        await uploadOne(next);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [uploadOne]);

  const enqueue = useCallback(
    (files: readonly File[]) => {
      const { accepted, refused } = screenFiles(files, maxBytes, () => {
        seqRef.current += 1;
        return `upl-${String(seqRef.current)}`;
      });
      if (refused.length > 0) setRejections((prev) => [...prev, ...refused]);
      if (accepted.length === 0) return;
      setItems((prev) => [
        ...prev,
        ...accepted.map(({ id, file }) => ({
          id,
          fileName: file.name,
          sizeBytes: file.size,
          progress: 0,
          state: 'queued' as const,
        })),
      ]);
      queueRef.current.push(...accepted);
      say(
        accepted.length === 1
          ? `Uploading ${accepted[0]?.file.name ?? ''}.`
          : `Uploading ${String(accepted.length)} files.`,
      );
      void drain();
    },
    [drain, maxBytes, say],
  );

  const cancel = useCallback((id: string) => {
    // In flight (abort the request) or still queued (drop it before it starts).
    const controller = controllersRef.current.get(id);
    if (controller !== undefined) {
      controller.abort();
      return;
    }
    queueRef.current = queueRef.current.filter((entry) => entry.id !== id);
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, state: 'cancelled', error: CANCEL_COPY['not-added'] } : item,
      ),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setRejections((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return { items, rejections, announcement, enqueue, cancel, dismiss };
}
