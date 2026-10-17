/**
 * BookSpread: the opened book's two pages (#200, frame 02). Left, on patterned endpaper: the Ex
 * libris bookplate, or the chosen plate (the paper's own figure, tipped in with its caption), and
 * under it "Use Figure 1 (p. 3) as the plate" when the parser found a caption-matched Figure 1, or
 * "Use the typographic cover" once a plate is chosen. Right: `BookDetails`. A red silk ribbon runs
 * down the gutter. Fetches what it shows when it opens (`useBookFacts`, `useDisplayName`).
 */
'use client';

import { PaperText } from '@papertree/ui';
import { Crop } from 'lucide-react';
import { forwardRef, useEffect, useRef, type ReactNode } from 'react';

import { useBookFacts, useDisplayName, usePlateChoice } from '../hooks/useBookData';
import { figureOneOffer, plateCaption } from '../model/book';
import { BookDetails } from './BookDetails';
import { Bookplate } from './Bookplate';

import type { BookFigure } from '../model/types';
import type { LibraryBook } from '@/features/library';

/** Props for `BookSpread`. */
export interface BookSpreadProps {
  readonly book: LibraryBook;
  readonly cloth: string;
  readonly titleId: string;
  readonly onRead: () => void;
  readonly onSummary: () => void;
  readonly onPutBack: () => void;
}

/** The plate offer, or the way back to the typographic cover. */
function PlateChoice({
  book,
  offer,
}: {
  readonly book: LibraryBook;
  readonly offer: BookFigure | null;
}): ReactNode {
  const { choose, clear } = usePlateChoice(book.id);
  const busy = choose.isPending || clear.isPending;
  const failed = choose.isError || clear.isError;
  // The pressed button is replaced by the other one once the cover changes: focus follows it, so
  // it never falls out of the dialog.
  const host = useRef<HTMLDivElement>(null);
  const chosen = (book.plate ?? null) !== null;
  const before = useRef(chosen);
  useEffect(() => {
    if (before.current === chosen) return;
    before.current = chosen;
    host.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [chosen]);
  let button: ReactNode = null;
  if ((book.plate ?? null) !== null) {
    button = (
      <button
        type="button"
        className="pt-spread__choice"
        disabled={busy}
        onClick={() => clear.mutate()}
      >
        Use the typographic cover
      </button>
    );
  } else if (offer !== null && offer.anchor !== null) {
    const anchor = offer.anchor;
    button = (
      <button
        type="button"
        className="pt-spread__choice"
        data-plate-offer=""
        disabled={busy}
        onClick={() => choose.mutate(anchor)}
      >
        <Crop size={18} strokeWidth={1.5} aria-hidden="true" />
        {`Use ${offer.label ?? 'Figure 1'} (p. ${String(offer.pageIndex + 1)}) as the plate`}
      </button>
    );
  }
  return (
    <div className="pt-spread__choices" ref={host}>
      {button}
      {failed ? (
        <p role="alert" className="pt-spread__error">
          The cover was not changed. Try again.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The two pages. Forwarded ref: the opening motion animates this element.
 *
 * @example
 * <BookSpread book={book} cloth="transformers" titleId="t" onRead={read} onSummary={sum}
 *   onPutBack={back} />
 */
export const BookSpread = forwardRef<HTMLDivElement, BookSpreadProps>(function BookSpread(
  { book, cloth, titleId, onRead, onSummary, onPutBack },
  ref,
) {
  const { figures, abstract, summary } = useBookFacts(book.id, true);
  const name = useDisplayName();
  const plate = book.plate ?? null;
  const offer = figures.data === undefined ? null : figureOneOffer(figures.data);
  return (
    <div
      ref={ref}
      className="pt-spread"
      style={{ ['--cloth' as string]: `var(--pt-cloth-${cloth})` }}
    >
      <div className="pt-spread__left pt-endpaper">
        {plate === null ? (
          <Bookplate
            book={book}
            cloth={cloth}
            displayName={name.loaded ? name.displayName : undefined}
            declined={name.declined}
            onSaveName={(value) => name.save.mutateAsync(value)}
            onDecline={name.decline}
            onReopen={name.reopen}
          />
        ) : (
          <figure className="pt-spread__plate" data-plate="">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed crop URL of the API */}
            <img
              src={plate.assetUrl}
              alt={`${plate.label ?? 'The chosen figure'}, from the paper`}
            />
            <figcaption>
              <PaperText as="span" className="pt-spread__plate-caption">
                {plateCaption(plate)}
              </PaperText>
            </figcaption>
          </figure>
        )}
        <PlateChoice book={book} offer={offer} />
      </div>
      <span className="pt-spread__ribbon" aria-hidden="true" />
      <div className="pt-spread__right">
        <BookDetails
          book={book}
          cloth={cloth}
          titleId={titleId}
          figures={figures.data ?? null}
          summary={summary.data?.state ?? null}
          abstract={
            abstract.data === undefined
              ? null
              : { text: abstract.data.text, pageIndex: abstract.data.page_index }
          }
          onRead={onRead}
          onSummary={onSummary}
          onPutBack={onPutBack}
        />
      </div>
    </div>
  );
});
