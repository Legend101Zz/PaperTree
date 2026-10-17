'use client';

/**
 * The notebook page's top bar (S5c, #208, frame 05; moved out of `NotebookView` by S5d to keep the
 * screen under its size): Back to the paper with the paper's title and page, Send page to board
 * and Open board.
 */
import { Button } from '@papertree/ui';
import { ArrowLeft, LayoutDashboard, Pin } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

/** Props for `NotebookBar`. */
export interface NotebookBarProps {
  /** The reader, at the passage the page came from when it is known. */
  readonly backHref: string;
  readonly paperTitle: string | null;
  /** The paper's page the question came from; null when unknown. */
  readonly page: number | null;
  readonly boardHref: string;
  readonly onSend: () => void;
  readonly sendDisabled: boolean;
}

/** The bar above the desk. */
export function NotebookBar(props: NotebookBarProps): ReactNode {
  return (
    <header className="pt-nb__bar">
      <Link className="pt-nb__back" href={props.backHref}>
        <ArrowLeft size={20} aria-hidden />
        Back to the paper
        {props.paperTitle === null ? null : (
          <>
            <span aria-hidden="true">·</span>
            <cite className="pt-nb__paper">{props.paperTitle}</cite>
            {props.page === null ? null : <span className="pt-nb__where">p. {props.page}</span>}
          </>
        )}
      </Link>
      <span className="pt-nb__actions">
        <Button
          leadingIcon={<Pin size={18} />}
          onClick={props.onSend}
          disabled={props.sendDisabled}
        >
          Send page to board
        </Button>
        <Link className="pt-button pt-button--secondary pt-button--md" href={props.boardHref}>
          <LayoutDashboard size={18} aria-hidden />
          Open board
        </Link>
      </span>
    </header>
  );
}
