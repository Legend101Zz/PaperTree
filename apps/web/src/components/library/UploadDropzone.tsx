'use client';

/**
 * library/UploadDropzone — upload with real progress, cancel and sentences for every refusal.
 *
 * THREE THINGS ARE STRUCTURAL HERE:
 *
 *   1. **Progress is a prop, not a guess.** `onUpload` receives `onProgress`; the caller wires it to
 *      `XMLHttpRequest.upload.onprogress` (`papersApi.uploadWithProgress`). This component refuses
 *      to fake a bar on a timer.
 *   2. **Every upload is cancellable.** `onUpload` receives an `AbortSignal`; Cancel aborts the
 *      request and the item reads "Cancelled". The abort can land after the server already had the
 *      whole body, so the item then asks `onCancelled` (the library re-reads `GET /papers`) and says
 *      which is true: nothing was added, it is already in the library, or it could not be checked.
 *      Unmounting aborts everything in flight.
 *   3. **"Uploaded" is not "ready".** A finished upload's row is dropped at once (the server row is
 *      already in the library list, so the paper's own card says what is happening); the parse is a
 *      separate job shown on that card.
 *
 * THE StrictMode FREEZE (#141). `mountedRef` used to be set to `false` in the effect cleanup and
 * never set back. React StrictMode runs mount -> cleanup -> mount in development, so the ref stayed
 * `false` for the whole life of the component and `patch()` silently dropped every update: a row
 * sat on "Waiting to upload" for ever, even after the server answered 202. The effect now sets the
 * ref to `true` on every mount, so the re-mount restores it.
 *
 * NOT A DRAG-ONLY AFFORDANCE. The control is a real `<input type="file">` filling the zone inside
 * its `<label htmlFor>`: it is in the tab order, opens the picker on Enter/Space and accepts drops
 * natively. The drag handlers are a bonus layer on top.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { describeUploadError } from '@/components/ui/errors';
import { ProgressMeter, TOUCH_TARGET, pointerActivate } from './primitives';

export type UploadItemState = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

export interface UploadItem {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  /** 0..1. Stays at 0 while `queued`. */
  readonly progress: number;
  readonly state: UploadItemState;
  readonly error?: string;
}

/** What a re-read of the library found after a cancelled upload. */
export type CancelOutcome = 'not-added' | 'in-library' | 'unknown';

export const CANCEL_COPY: Record<CancelOutcome, string> = {
  'not-added': 'Nothing was added to your library.',
  'in-library':
    'It had already uploaded; it is in your library. Delete it if you did not mean to add it.',
  unknown:
    'Cancelled. We could not check your library just now, so reload to see whether it was added.',
};

export interface UploadContext {
  /** Call with 0..1 as bytes go out. */
  readonly onProgress: (fraction: number) => void;
  /** Aborted on cancel and on unmount. */
  readonly signal: AbortSignal;
}

export interface UploadDropzoneProps {
  readonly onUpload: (file: File, context: UploadContext) => Promise<void>;
  /**
   * After a Cancel, asks the library whether the server nonetheless kept the file (the abort can
   * land after the whole body arrived). Omit and the row says only that it was cancelled.
   */
  readonly onCancelled?: (file: File) => Promise<CancelOutcome>;
  /** Fired once per file that reached the server. The library refetches on this. */
  readonly onUploaded?: (file: File) => void;
  readonly multiple?: boolean;
  /** Rejected before any bytes leave, with the reason shown. Omit for no limit. */
  readonly maxBytes?: number;
  /** A shorter zone, for a library that already has papers in it. */
  readonly compact?: boolean;
}

interface Rejection {
  readonly id: string;
  readonly fileName: string;
  readonly reason: string;
}

const MEGABYTE = 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < MEGABYTE) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/** A courtesy filter; the server re-checks the bytes (415). */
function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

const STATE_LABEL: Record<UploadItemState, string> = {
  queued: 'Waiting to upload',
  uploading: 'Uploading',
  done: 'Uploaded - queued for reading',
  failed: 'Upload failed',
  cancelled: 'Cancelled',
};

export function UploadDropzone({
  onUpload,
  onUploaded,
  onCancelled,
  multiple = true,
  maxBytes,
  compact = false,
}: UploadDropzoneProps) {
  const inputId = useId();
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [rejections, setRejections] = useState<readonly Rejection[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const queueRef = useRef<{ id: string; file: File }[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const drainingRef = useRef(false);
  const mountedRef = useRef(false);
  const seqRef = useRef(0);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    // Set on EVERY mount: StrictMode's mount -> cleanup -> mount must end with `true`.
    mountedRef.current = true;
    const controllers = controllersRef.current;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      timers.clear();
      controllers.forEach((controller) => {
        controller.abort();
      });
      controllers.clear();
    };
  }, []);

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    if (!mountedRef.current) return;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      for (;;) {
        const next = queueRef.current.shift();
        if (next === undefined) break;

        const controller = new AbortController();
        controllersRef.current.set(next.id, controller);
        patch(next.id, { state: 'uploading', progress: 0 });

        try {
          await onUpload(next.file, {
            onProgress: (fraction) => {
              patch(next.id, { progress: Math.max(0, Math.min(1, fraction)) });
            },
            signal: controller.signal,
          });
          // The server row is already in the library list (`onUpload` upserts it before it
          // resolves), so the paper's own card now says what is happening and this transient
          // row goes at once instead of sitting above the card it became (#141).
          const doneId = next.id;
          if (mountedRef.current) setItems((prev) => prev.filter((item) => item.id !== doneId));
          if (mountedRef.current) {
            setAnnouncement(`${next.file.name} uploaded. Queued for reading.`);
          }
          onUploaded?.(next.file);
        } catch (error) {
          const aborted = controller.signal.aborted;
          patch(next.id, {
            state: aborted ? 'cancelled' : 'failed',
            error: aborted ? 'Checking your library...' : describeUploadError(error),
          });
          if (aborted) {
            // The abort may have landed after the server had the whole body: re-read, then say so.
            let outcome: CancelOutcome = 'not-added';
            if (onCancelled !== undefined) {
              try {
                outcome = await onCancelled(next.file);
              } catch {
                outcome = 'unknown';
              }
            }
            patch(next.id, { error: CANCEL_COPY[outcome] });
          }
          if (mountedRef.current) {
            setAnnouncement(
              aborted ? `${next.file.name} cancelled.` : `${next.file.name} failed to upload.`,
            );
          }
        } finally {
          controllersRef.current.delete(next.id);
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [onUpload, onUploaded, onCancelled, patch]);

  const enqueue = useCallback(
    (files: readonly File[]) => {
      const accepted: { id: string; file: File }[] = [];
      const refused: Rejection[] = [];

      for (const file of files) {
        seqRef.current += 1;
        const id = `upl-${String(seqRef.current)}`;
        if (!isPdf(file)) {
          refused.push({
            id,
            fileName: file.name,
            reason: 'is not a PDF. Choose a file that ends in .pdf.',
          });
        } else if (maxBytes !== undefined && file.size > maxBytes) {
          refused.push({
            id,
            fileName: file.name,
            reason: `is larger than ${formatBytes(maxBytes)}. Choose a smaller PDF.`,
          });
        } else {
          accepted.push({ id, file });
        }
      }

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
      setAnnouncement(
        accepted.length === 1
          ? `Uploading ${accepted[0]?.file.name ?? ''}.`
          : `Uploading ${String(accepted.length)} files.`,
      );
      void drain();
    },
    [drain, maxBytes],
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
  }, []);

  return (
    <section aria-labelledby={`${inputId}-heading`} className="flex flex-col gap-3">
      <h2 id={`${inputId}-heading`} className="sr-only">
        Add papers
      </h2>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => {
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          enqueue(Array.from(event.dataTransfer.files));
        }}
      >
        <label
          htmlFor={inputId}
          className="pt-s3-drop"
          data-drag={dragActive ? 'true' : 'false'}
          style={{ touchAction: 'manipulation', minHeight: compact ? 96 : undefined }}
        >
          <Upload className="h-6 w-6" style={{ color: 'var(--pt-accent)' }} aria-hidden="true" />
          <span className="text-sm font-medium">{multiple ? 'Choose PDFs' : 'Choose a PDF'}</span>
          <span className="pt-s3-muted pt-s3-small">
            or drop {multiple ? 'them' : 'it'} here
            {maxBytes === undefined ? '' : ` (up to ${formatBytes(maxBytes)} each)`}
          </span>
          <input
            id={inputId}
            type="file"
            accept="application/pdf,.pdf"
            multiple={multiple}
            // Transparent and full-bleed rather than `hidden`: a `display:none` input is not
            // focusable.
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            style={{ minWidth: 44, minHeight: 44 }}
            onChange={(event) => {
              const { files } = event.target;
              if (files !== null) enqueue(Array.from(files));
              // Reset so re-picking the same file fires `change` again.
              event.target.value = '';
            }}
          />
        </label>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {rejections.length > 0 ? (
        <ul className="list-none space-y-2 p-0" data-testid="upload-rejections">
          {rejections.map((rejection) => (
            <li key={rejection.id} className="pt-s3-alert pt-s3-alert--error">
              {rejection.fileName} {rejection.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {items.length > 0 ? (
        <ul className="list-none space-y-2 p-0" data-testid="upload-queue">
          {items.map((item) => {
            const pct = Math.round(item.progress * 100);
            const inFlight = item.state === 'queued' || item.state === 'uploading';
            return (
              <li
                key={item.id}
                data-upload-state={item.state}
                className="pt-s3-panel flex items-center gap-3"
                style={{ padding: 12 }}
              >
                <FileText
                  className="h-5 w-5 shrink-0"
                  style={{ color: 'var(--pt-ink-muted)' }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.fileName}</p>
                  <p className="pt-s3-muted pt-s3-small">
                    {STATE_LABEL[item.state]}
                    {item.state === 'uploading' ? ` - ${String(pct)}%` : ''}
                    {inFlight ? ` - ${formatBytes(item.sizeBytes)}` : ''}
                  </p>
                  {item.error !== undefined ? (
                    <p
                      className={
                        item.state === 'failed'
                          ? 'pt-s3-small mt-1'
                          : 'pt-s3-muted pt-s3-small mt-1'
                      }
                      style={item.state === 'failed' ? { color: 'var(--pt-s3-bad)' } : undefined}
                    >
                      {item.error}
                    </p>
                  ) : null}
                  {inFlight || item.state === 'done' ? (
                    <ProgressMeter
                      {...(item.state === 'queued' ? {} : { value: item.progress })}
                      label={`Upload progress, ${item.fileName}`}
                      className="mt-2"
                    />
                  ) : null}
                </div>

                {inFlight ? (
                  <button
                    type="button"
                    className={`pt-s3-btn pt-s3-btn--small ${TOUCH_TARGET}`}
                    {...pointerActivate<HTMLButtonElement>(() => {
                      cancel(item.id);
                    })}
                  >
                    Cancel
                    <span className="sr-only">{` upload of ${item.fileName}`}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Dismiss ${item.fileName}`}
                    className={`pt-s3-btn pt-s3-btn--quiet ${TOUCH_TARGET}`}
                    {...pointerActivate<HTMLButtonElement>(() => {
                      dismiss(item.id);
                    })}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
