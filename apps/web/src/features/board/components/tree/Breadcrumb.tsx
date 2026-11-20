'use client';

/**
 * board/components/tree/Breadcrumb — the path of a focused card (P4 step 9, V3-24): "path ›
 * Passage › question › question", each crumb a button that moves the focus there. Esc leaves the
 * focus (the board's Escape order).
 */
import { Fragment, type ReactNode } from 'react';

import { useBranch } from '../BranchContext';
import { breadcrumbOf } from '../../model/ui';

/** The breadcrumb of the focused card, or nothing when no card is focused. */
export function Breadcrumb(): ReactNode {
  const branch = useBranch();
  const id = branch.control.ui.focusId;
  if (id === null || !branch.tree.byId.has(id)) return null;
  const crumbs = breadcrumbOf(branch.tree, id);
  return (
    <nav className="pt-crumbs" aria-label="Path">
      <span className="pt-crumbs__lead">path</span>
      {crumbs.map((crumb, i) => (
        <Fragment key={crumb.id}>
          {i > 0 ? (
            <svg
              viewBox="0 0 20 20"
              width="14"
              height="14"
              aria-hidden="true"
              className="pt-crumbs__sep"
            >
              <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : null}
          <button
            type="button"
            className="pt-crumbs__crumb"
            aria-current={crumb.id === id ? 'location' : undefined}
            onClick={() => branch.control.focus(crumb.id)}
          >
            {crumb.label}
          </button>
        </Fragment>
      ))}
      <span className="pt-crumbs__esc">
        <kbd aria-hidden="true">Esc</kbd> leaves focus
      </span>
    </nav>
  );
}
