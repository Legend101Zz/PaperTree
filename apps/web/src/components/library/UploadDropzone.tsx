'use client';

/**
 * library/UploadDropzone — upload with progress.
 *
 * THE DEFECT THIS REPLACES. `dashboard/UploadModal.tsx` + `dashboard/PaperList.tsx:32-46` upload by
 * awaiting one `POST` with the whole PDF in it. While that request is in flight the user gets a
 * spinner on a button and nothing else: no bytes-sent, no cancel, no per-file outcome when they
 * picked several, and no distinction between "still uploading" and "uploaded, now parsing". A
 * 40 MB scan over hotel wifi is four minutes of a spinner that cannot be told apart from a hang.
 *
 * THREE THINGS ARE THEREFORE STRUCTURAL HERE:
 *
 *   1. **Progress is a prop, not a guess.** `onUpload` receives `onProgress`; the caller wires it
 *      to `XMLHttpRequest.upload.onprogress` or axios' `onUploadProgress`. This component refuses
 *      to fake a progress bar on a timer — a bar that is lying is worse than a spinner that is not.
 *   2. **Every upload is cancellable.** `onUpload` receives an `AbortSignal`, and unmounting aborts
 *      everything in flight.
 *   3. **"Uploaded" is not "ready".** The terminal state of an upload is `done`, whose label says
 *      the paper is now QUEUED FOR READING. The parse is a separate job with its own five states
 *      (`types.ts`), shown on the card.
 *
 * NOT A DRAG-ONLY AFFORDANCE. Drag-and-drop does not exist on a phone, and a dropzone whose only
 * real control is a `<div onClick>` that pokes a hidden input is unreachable by keyboard. The
 * control here is a real `<input type="file">` filling the zone, wrapped in its `<label>`: it is in
 * the tab order, it opens the picker on Enter/Space because the browser does that for file inputs,
 * and it accepts drops natively. Drag handlers are a bonus layer on top, never the only path.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FileText, RotateCcw, Upload, X } from 'lucide-react';
import { ProgressMeter, TOUCH_TARGET, pointerActivate } from './primitives';

export type UploadItemState = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

export interface UploadItem {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  /** 0..1. Stays at 0 while `queued`; the caller may never report it, which is allowed. */
  readonly progress: number;
  readonly state: UploadItemState;
  readonly error?: string;
}

export interface UploadContext {
  /** Call with 0..1 as bytes go out. */
  readonly onProgress: (fraction: number) => void;
  /** Aborted on cancel and on unmount. */
  readonly signal: AbortSignal;
}

export interface UploadDropzoneProps {
  readonly onUpload: (file: File, context: UploadContext) => Promise<void>;
  /** Fired once per file that reached the server. The library refetches on this. */
  readonly onUploaded?: (file: File) => void;
  readonly multiple?: boolean;
  /** Rejected before any bytes leave, with the reason shown. Omit for no limit. */
  readonly maxBytes?: number;
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

/**
 * `file.type` is empty for a surprising share of drops (and for anything dragged out of a zip
 * viewer), so the extension is checked as well. This is a courtesy filter, not a security control —
 * the server re-checks, because a renamed `.pdf` is trivial.
 */
function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

const STATE_LABEL: Record<UploadItemState, string> = {
  queued: 'Waiting to upload',
  uploading: 'Uploading',
  done: 'Uploaded — queued for reading',
  failed: 'Upload failed',
  cancelled: 'Cancelled',
};

export function UploadDropzone({ onUpload, onUploaded, multiple = true, maxBytes }: UploadDropzoneProps) {
  const inputId = useId();
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [rejections, setRejections] = useState<readonly Rejection[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const queueRef = useRef<{ id: string; file: File }[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const drainingRef = useRef(false);
  const mountedRef = useRef(true);
  const seqRef = useRef(0);

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      // Unmounting mid-upload must not leave a request writing into a dead component. This is the
      // whole reason `signal` is part of the contract rather than optional.
      // `forEach`, not `for…of`: `apps/web/tsconfig.json` has carried no `target` for most of this
      // epic, which means ES5, which means iterating a Map needs `downlevelIteration`. It gained
      // `"target": "ES2022"` mid-branch; this stays because the loop reads no worse either way and
      // does not depend on that setting surviving.
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
          patch(next.id, { state: 'done', progress: 1 });
          setAnnouncement(`${next.file.name} uploaded. Queued for reading.`);
          onUploaded?.(next.file);
        } catch (error) {
          const aborted = controller.signal.aborted;
          patch(next.id, {
            state: aborted ? 'cancelled' : 'failed',
            error: aborted ? 'Cancelled' : error instanceof Error ? error.message : 'Upload failed',
          });
          setAnnouncement(
            aborted ? `${next.file.name} cancelled.` : `${next.file.name} failed to upload.`,
          );
        } finally {
          controllersRef.current.delete(next.id);
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [onUpload, onUploaded, patch]);

  const enqueue = useCallback(
    (files: readonly File[]) => {
      const accepted: { id: string; file: File }[] = [];
      const refused: Rejection[] = [];

      for (const file of files) {
        seqRef.current += 1;
        const id = `upl-${String(seqRef.current)}`;
        if (!isPdf(file)) {
          refused.push({ id, fileName: file.name, reason: 'Not a PDF' });
        } else if (maxBytes !== undefined && file.size > maxBytes) {
          refused.push({
            id,
            fileName: file.name,
            reason: `Larger than ${formatBytes(maxBytes)}`,
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
        accepted.length === 1 ? `Uploading ${accepted[0]?.file.name ?? ''}.` : `Uploading ${String(accepted.length)} files.`,
      );
      void drain();
    },
    [drain, maxBytes],
  );

  const cancel = useCallback((id: string) => {
    // Two cases: in flight (abort the request) and still queued (drop it before it starts).
    const controller = controllersRef.current.get(id);
    if (controller !== undefined) {
      controller.abort();
      return;
    }
    queueRef.current = queueRef.current.filter((entry) => entry.id !== id);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, state: 'cancelled', error: 'Cancelled' } : item)),
    );
  }, []);

  return (
    <section aria-labelledby={`${inputId}-heading`} className="flex flex-col gap-3">
      <h2 id={`${inputId}-heading`} className="sr-only">
        Add papers
      </h2>

      <div
        data-drag-active={dragActive ? 'true' : 'false'}
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
          // `focus-within` — not `hover` — is what changes the ring, so the zone looks focused for
          // a keyboard user exactly as it looks targeted for a mouse user.
          className="relative flex min-h-[160px] min-w-[44px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 p-6 text-center focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600 data-[drag=true]:border-blue-600 dark:border-gray-600"
          data-drag={dragActive ? 'true' : 'false'}
          style={{ touchAction: 'manipulation' }}
        >
          <Upload className="h-8 w-8 text-gray-400" aria-hidden="true" />
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {multiple ? 'Choose PDFs' : 'Choose a PDF'}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            or drop {multiple ? 'them' : 'it'} here
            {maxBytes === undefined ? '' : ` · up to ${formatBytes(maxBytes)} each`}
          </span>
          <input
            id={inputId}
            type="file"
            accept="application/pdf,.pdf"
            multiple={multiple}
            // Transparent and full-bleed rather than `hidden`: a `display:none` input is not
            // focusable, which is how the v1 modal ended up needing a `<div onClick>` proxy.
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={(event) => {
              const { files } = event.target;
              if (files !== null) enqueue(Array.from(files));
              // Reset so re-picking the same file fires `change` again.
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {/* Politely announced, because upload outcomes arrive minutes after the interaction. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {rejections.length > 0 ? (
        <ul className="list-none space-y-1" data-testid="upload-rejections">
          {rejections.map((rejection) => (
            <li key={rejection.id} className="text-xs text-red-700 dark:text-red-300">
              {rejection.fileName}: {rejection.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {items.length > 0 ? (
        <ul className="list-none space-y-2" data-testid="upload-queue">
          {items.map((item) => {
            const pct = Math.round(item.progress * 100);
            const inFlight = item.state === 'queued' || item.state === 'uploading';
            return (
              <li
                key={item.id}
                data-upload-state={item.state}
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
              >
                <FileText className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900 dark:text-white">{item.fileName}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {STATE_LABEL[item.state]}
                    {item.state === 'uploading' ? ` · ${String(pct)}%` : ''}
                    {item.state === 'queued' || item.state === 'uploading'
                      ? ` · ${formatBytes(item.sizeBytes)}`
                      : ''}
                    {item.error === undefined ? '' : ` · ${item.error}`}
                  </p>
                  <ProgressMeter
                    // Queued files have made no progress and none is being reported, which is the
                    // textbook indeterminate case.
                    {...(item.state === 'queued' ? {} : { value: item.progress })}
                    label={`Upload progress, ${item.fileName}`}
                    className="mt-1"
                  />
                </div>

                {inFlight ? (
                  <button
                    type="button"
                    aria-label={`Cancel upload of ${item.fileName}`}
                    className={`${TOUCH_TARGET} inline-flex shrink-0 items-center justify-center rounded-lg text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-gray-300`}
                    {...pointerActivate<HTMLButtonElement>(() => {
                      cancel(item.id);
                    })}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}

                {item.state === 'failed' || item.state === 'cancelled' ? (
                  <button
                    type="button"
                    aria-label={`Retry upload of ${item.fileName}`}
                    className={`${TOUCH_TARGET} inline-flex shrink-0 items-center justify-center rounded-lg text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-300`}
                    {...pointerActivate<HTMLButtonElement>(() => {
                      // The `File` is gone once the item settles — the browser will not let us keep
                      // it alive across a re-pick — so retry re-opens the picker rather than
                      // pretending it can resend bytes it no longer holds.
                      document.getElementById(inputId)?.click();
                    })}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
