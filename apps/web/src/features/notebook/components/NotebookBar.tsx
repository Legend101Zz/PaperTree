'use client';

/**
 * The notebook page's top bar (S5c, #208, frame 05; moved out of `NotebookView` by S5d to keep the
 * screen under its size): Back to the paper with the paper's title and page, Send page to board
 * and Open board. On a tablet (S5e, #210, frame 05b) it names the page instead, since the side
 * panel and its title are not beside the page there, and its controls are 44 px touch targets.
 */
import { Button } from '@papertree/ui';
import { ArrowLeft, LayoutDashboard, Pin } from 'lucide-react';
import Link from 'next/link';

import { titleVoice } from '../model/page';

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
  /** The tablet bar names the page (null while it loads); the desktop bar names the paper. */
  readonly pageTitle?: string | null;
}

function PageTitle({ title }: { readonly title: string }): ReactNode {
  const t = titleVoice(title);
  return (
    <span className="pt-nb__title">
      {t.lead}
      {t.voice === null ? t.words : <span data-voice={t.voice}>{t.words}</span>}
    </span>
  );
}

/** The bar above the desk. */
export function NotebookBar(props: NotebookBarProps): ReactNode {
  const tablet = props.pageTitle !== undefined;
  return (
    <header className="pt-nb__bar">
      <Link className="pt-nb__back" href={props.backHref}>
        <ArrowLeft size={20} aria-hidden />
        Back to the paper
        {tablet || props.paperTitle === null ? null : (
          <>
            <span aria-hidden="true">·</span>
            <cite className="pt-nb__paper">{props.paperTitle}</cite>
            {props.page === null ? null : <span className="pt-nb__where">p. {props.page}</span>}
          </>
        )}
      </Link>
      {tablet && props.pageTitle ? <PageTitle title={props.pageTitle} /> : null}
      <span className="pt-nb__actions">
        <Button
          size={tablet ? 'touch' : 'md'}
          leadingIcon={<Pin size={18} />}
          onClick={props.onSend}
          disabled={props.sendDisabled}
        >
          Send page to board
        </Button>
        <Link
          className={`pt-button pt-button--secondary pt-button--${tablet ? 'touch' : 'md'}`}
          href={props.boardHref}
        >
          <LayoutDashboard size={18} aria-hidden />
          Open board
        </Link>
      </span>
    </header>
  );
}
