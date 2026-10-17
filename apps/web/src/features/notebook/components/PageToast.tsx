'use client';

/**
 * The notebook screen's one toast (S5c, #208; moved out of `NotebookView` by S5e, #210): of the
 * notices the page may have (the lasso's, the ink fold note, a send to the board), the first with
 * something to say is shown, so two toasts never stack over the page.
 */
import { Toast } from '@papertree/ui';

import type { ReactNode } from 'react';

/** One notice the page may show. */
export interface PageNotice {
  /** A new key is a new toast (its timer starts again). */
  readonly key: string | number;
  readonly message: string;
  readonly action?: { readonly label: string; readonly onAction: () => void } | undefined;
  readonly onDismiss: () => void;
}

/**
 * The first notice, as a toast.
 *
 * @param props - The notices, and the room to keep free at the foot.
 * @param props.notices - In order of precedence; null where there is none.
 * @param props.bottomInset - Px kept clear at the bottom (the phone's bar, S5e).
 * @returns The toast, or nothing.
 */
export function PageToast({
  notices,
  bottomInset,
}: {
  readonly notices: readonly (PageNotice | null)[];
  readonly bottomInset?: number;
}): ReactNode {
  const n = notices.find((x) => x !== null) ?? null;
  if (n === null) return null;
  return (
    <Toast
      key={n.key}
      message={n.message}
      {...(n.action === undefined ? {} : { action: n.action })}
      onDismiss={n.onDismiss}
      {...(bottomInset === undefined ? {} : { bottomInset })}
    />
  );
}
