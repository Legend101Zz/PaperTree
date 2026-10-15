'use client';

import { useEffect, useRef, useState } from 'react';

import type { EdgeKind } from '@/lib/api/types';

import { EDGE_KINDS } from './model';

export interface KindPickerProps {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly onPick: (kind: EdgeKind, label: string | null) => void;
  readonly onCancel: () => void;
}

/** "How are these connected?" — the seven kinds as buttons, an optional label, Escape to cancel. */
export function KindPicker({ fromLabel, toLabel, onPick, onCancel }: KindPickerProps) {
  const first = useRef<HTMLButtonElement>(null);
  const [label, setLabel] = useState('');
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <div className="pt-cv-scrim" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="pt-cv-dialog" role="dialog" aria-modal="true" aria-labelledby="pt-cv-kind-title">
        <h2 id="pt-cv-kind-title" className="pt-cv-dialog__title">
          How are these connected?
        </h2>
        <p className="pt-cv-dialog__sub">
          <strong>{fromLabel}</strong> to <strong>{toLabel}</strong>
        </p>
        <div className="pt-cv-kinds">
          {EDGE_KINDS.map((k, i) => (
            <button
              key={k.kind}
              ref={i === 0 ? first : undefined}
              type="button"
              className="pt-btn pt-btn--outline pt-cv-kind"
              data-kind={k.kind}
              title={k.hint}
              onClick={() => onPick(k.kind, label.trim() === '' ? null : label.trim())}
            >
              {k.label}
            </button>
          ))}
        </div>
        <label className="pt-cv-field">
          <span>Label on the link (optional)</span>
          <input
            className="pt-field"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Shows on the link instead of the kind"
          />
        </label>
        <div className="pt-cv-dialog__actions">
          <button type="button" className="pt-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
