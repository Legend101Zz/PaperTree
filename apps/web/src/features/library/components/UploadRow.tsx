/**
 * UploadRow: upload progress as a quiet row under the library header (#195), replacing v0.1's
 * dropzone list and its row separators (#175). One line per file: name, state, a thin progress
 * rule and Cancel; a finished upload leaves at once, because its spine is already on the shelf.
 */
'use client';

import { Button } from '@papertree/ui';

import { ProgressMeter } from '@/components/library/primitives';

import { formatBytes, type UploadItemState, type UploadQueue } from '../hooks/useUploadQueue';

import type { ReactNode } from 'react';

const STATE_LABEL: Record<UploadItemState, string> = {
  queued: 'Waiting to upload',
  uploading: 'Uploading',
  done: 'Uploaded - queued for reading',
  failed: 'Upload failed',
  cancelled: 'Cancelled',
};

/** 44 px both ways (the touch audit reads the declaration). */
const TOUCH = { minWidth: 44 } as const;

/** Props for `UploadRow`. */
export interface UploadRowProps {
  readonly queue: UploadQueue;
}

/**
 * The uploads in progress and the files that were refused. Renders only the live region when
 * there is nothing to show.
 *
 * @example
 * const queue = useUploadQueue({ onUpload });
 * <UploadRow queue={queue} />
 */
export function UploadRow({ queue }: UploadRowProps): ReactNode {
  const { items, rejections, announcement, cancel, dismiss } = queue;
  return (
    <div className="pt-uploads" data-uploads="">
      <p role="status" aria-live="polite" className="pt-sr-only">
        {announcement}
      </p>
      {rejections.length > 0 ? (
        <ul className="pt-uploads__list" data-testid="upload-rejections">
          {rejections.map((rejection) => (
            <li key={rejection.id} className="pt-uploads__item pt-uploads__item--refused">
              <span className="pt-uploads__text">
                {rejection.fileName} {rejection.reason}
              </span>
              <Button
                variant="ghost"
                size="touch"
                style={TOUCH}
                onClick={() => dismiss(rejection.id)}
              >
                Dismiss<span className="pt-sr-only">{` ${rejection.fileName}`}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <ul className="pt-uploads__list" data-testid="upload-queue">
          {items.map((item) => {
            const inFlight = item.state === 'queued' || item.state === 'uploading';
            const percent =
              item.state === 'uploading' ? ` · ${String(Math.round(item.progress * 100))}%` : '';
            return (
              <li key={item.id} className="pt-uploads__item" data-upload-state={item.state}>
                <span className="pt-uploads__text">
                  <span className="pt-uploads__name">{item.fileName}</span>
                  {` · ${STATE_LABEL[item.state]}${percent}`}
                  {inFlight ? ` · ${formatBytes(item.sizeBytes)}` : ''}
                  {item.error === undefined ? null : (
                    <span className="pt-uploads__note" data-failed={item.state === 'failed'}>
                      {item.error}
                    </span>
                  )}
                </span>
                {inFlight ? (
                  <ProgressMeter
                    {...(item.state === 'queued' ? {} : { value: item.progress })}
                    label={`Upload progress, ${item.fileName}`}
                    className="pt-uploads__bar"
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="touch"
                  style={TOUCH}
                  onClick={() => (inFlight ? cancel : dismiss)(item.id)}
                >
                  {inFlight ? 'Cancel' : 'Dismiss'}
                  <span className="pt-sr-only">
                    {inFlight ? ` upload of ${item.fileName}` : ` ${item.fileName}`}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
